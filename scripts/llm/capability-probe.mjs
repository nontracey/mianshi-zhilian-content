// scripts/llm/capability-probe.mjs
// 模型能力启动探测：声明 image 的模型发 1x1 测试图，确认真支持。
// 探测失败 → 自动降级为 mcp 或 none，避免中途崩。
// 结果缓存到 .quality-refine/capability-probe.json，7 天有效。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { envConfig } from "./env-config.mjs";
import { llmRunner } from "./runner.mjs";

const PROBE_CACHE_FILE = ".quality-refine/capability-probe.json";
const PROBE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// 1x1 PNG（base64）
const TEST_PNG_DATAURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

function loadCache() {
  try {
    if (existsSync(PROBE_CACHE_FILE)) {
      return JSON.parse(readFileSync(PROBE_CACHE_FILE, "utf8"));
    }
  } catch {}
  return { entries: {} };
}

function saveCache(cache) {
  try {
    mkdirSync(path.dirname(PROBE_CACHE_FILE), { recursive: true });
    writeFileSync(PROBE_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
}

// 探测单个 spec 是否真支持图像输入
async function probeImageCapability(spec) {
  try {
    const result = await llmRunner.runOnce({
      spec,
      systemPrompt: "Return only the word 'ok'.",
      userPrompt: "Describe this image in one word.",
      images: [{ dataUrl: TEST_PNG_DATAURL, detail: "low" }],
      sampling: { temperature: 0, max_tokens: 16 },
      timeoutMs: 30000,
      retry: 1,
    });
    // 不抛错即视为支持
    return { spec, ok: true, response: String(result.text ?? "").slice(0, 50) };
  } catch (error) {
    const msg = String(error.message ?? "");
    // 不支持的典型错误：400 + "image" / "vision" / "multimodal"
    const unsupported = /image|vision|multimodal|not\s+support/i.test(msg);
    return { spec, ok: false, unsupported, error: msg.slice(0, 200) };
  }
}

// 启动时对所有声明 image 的模型并发探测
export async function probeAllImageCapabilities(force = false) {
  const cache = loadCache();
  const now = Date.now();
  const imageModels = envConfig.listModelsByCapability("image");
  const toProbe = [];
  for (const model of imageModels) {
    const spec = `${model.provider}:${model.id}`;
    const entry = cache.entries[spec];
    if (force || !entry || now - entry.at > PROBE_TTL_MS) {
      toProbe.push(spec);
    }
  }
  if (!toProbe.length) return { probed: 0, results: [], cache };

  const results = await Promise.all(toProbe.map(probeImageCapability));
  for (const r of results) {
    cache.entries[r.spec] = { ...r, at: now };
  }
  saveCache(cache);
  return { probed: results.length, results, cache };
}

// 取某个 spec 的探测结果（用于降级决策）
export function getProbeResult(spec) {
  const cache = loadCache();
  const entry = cache.entries[spec];
  if (!entry || Date.now() - entry.at > PROBE_TTL_MS) return null;
  return entry;
}

// 启动时探测 + 自动降级：声明 image 但探测失败的模型，autoScale 字段 imageUnderstanding 降级
export async function probeAndDowngrade({ onDowngrade } = {}) {
  await probeAllImageCapabilities();
  const hasMcpVision = Boolean(envConfig.getEnv("VISION_JUDGE_MCP_TOOLS") || envConfig.getEnv("VISION_JUDGE_MCP_TOOL"));
  const downgraded = [];
  for (const model of envConfig.listModelsByCapability("image")) {
    const spec = `${model.provider}:${model.id}`;
    const r = getProbeResult(spec);
    if (r && !r.ok && r.unsupported) {
      const nextModality = (model.modality ?? []).filter((cap) => cap !== "image");
      envConfig.patchModel(spec, {
        modality: nextModality.length ? nextModality : ["text", "json"],
        imageUnderstanding: hasMcpVision ? "mcp" : "none",
      });
      downgraded.push(spec);
      onDowngrade?.(spec, r.error);
    }
  }
  return { downgraded };
}
