#!/usr/bin/env node
// Agnes MCP server for the local refiner.
// Tools:
// - visual_judge: judge rendered diagram artifacts with an Agnes vision-capable chat model.
// - image_generate: generate raster images with Agnes Image.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const DEFAULT_BASE_URL = "https://apihub.agnes-ai.com/v1";
const DEFAULT_IMAGE_MODEL = "agnes-image-2.1-flash";
const DEFAULT_VISION_MODEL = "agnes-1.5-flash";
const execFileAsync = promisify(execFile);

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const parsed = parseEnvFile(readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

loadDotEnv();

function env(name, fallback = "") {
  const value = process.env[name];
  return value == null || value === "" ? fallback : value;
}

function apiKey() {
  return env("AGNES_API_KEY");
}

function baseUrl() {
  return env("AGNES_BASE_URL", DEFAULT_BASE_URL).replace(/\/$/, "");
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message: error?.message || String(error) },
  };
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolText(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function stripCodeFence(text) {
  return String(text ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function parseJsonObject(text) {
  const direct = stripCodeFence(text);
  try {
    const parsed = JSON.parse(direct);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  const match = direct.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return null;
}

async function postJson(url, body) {
  if (!apiKey()) throw new Error("AGNES_API_KEY is empty");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Agnes HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Agnes returned non-JSON: ${text.slice(0, 300)}`);
  }
}

function boolEnv(name, fallback = false) {
  const raw = env(name);
  if (raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function decodeSvgDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/svg+xml")) return "";
  const [, payload = ""] = dataUrl.split(",", 2);
  if (!payload) return "";
  if (/;base64/i.test(dataUrl.slice(0, dataUrl.indexOf(",")))) {
    return Buffer.from(payload, "base64").toString("utf8");
  }
  return decodeURIComponent(payload);
}

async function renderSvgToPngDataUrl(svgText) {
  if (!boolEnv("AGNES_RENDER_SVG_TO_PNG", true)) return null;
  if (!/<svg\b/i.test(svgText)) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), "agnes-svg-"));
  const input = path.join(dir, "diagram.svg");
  const size = String(Number(env("AGNES_RENDER_SIZE", "1024")) || 1024);
  try {
    await writeFile(input, svgText, "utf8");
    await execFileAsync("qlmanage", ["-t", "-s", size, "-o", dir, input], {
      timeout: Number(env("AGNES_RENDER_TIMEOUT_MS", "15000")) || 15000,
    });
    const png = await readFile(`${input}.png`);
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function imageParts(artifacts = []) {
  const out = [];
  for (const artifact of artifacts.slice(0, 4)) {
    let url = artifact?.dataUrl || artifact?.url;
    const svgText = typeof artifact?.source === "string" && /<svg\b/i.test(artifact.source)
      ? artifact.source
      : decodeSvgDataUrl(url);
    if (svgText) {
      const pngUrl = await renderSvgToPngDataUrl(svgText);
      if (pngUrl) url = pngUrl;
    }
    if (url) out.push({ type: "image_url", image_url: { url, detail: "high" } });
  }
  return out;
}

function splitList(value) {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function visionModelChain() {
  const chain = splitList(env("AGNES_VISION_MODEL_CHAIN"));
  if (chain.length) return chain;
  return [env("AGNES_VISION_MODEL", DEFAULT_VISION_MODEL)].filter(Boolean);
}

async function visualJudge(args = {}) {
  const images = await imageParts(args.artifacts);
  if (!images.length) {
    return {
      backend: "agnes:visual_judge",
      visualFit: "not_checked",
      summary: "没有可供 Agnes 视觉判官读取的渲染图 artifact。",
      findings: [],
      candidateRanking: [],
    };
  }
  const schemaHint = {
    backend: "agnes:visual_judge",
    model: "Agnes 视觉模型名",
    visualFit: "pass | fail | not_checked",
    summary: "一句话总结",
    findings: [
      {
        cardTitle: "卡片标题",
        severity: "fail | warn | info",
        issue: "发现的问题",
        evidence: "看见的证据",
        requiredFix: "需要怎么修",
      },
    ],
    candidateRanking: [],
  };
  const prompt = `你是知识库图解视觉判官。请看随附图片，并结合 topic 与静态发现判断图解是否真的适合作为学习卡。

必须检查：
1. 内容是否贴合 topic，不能只是装饰图或通用模板。
2. 是否有重叠、裁切、显示不全、空白、文字过密、字号过小。
3. SVG/Mermaid/compareTable/code/text/none 哪种形态更合适。
4. caption/fallback/text 兜底是否足够。

topic:
${JSON.stringify(args.topic ?? {}, null, 2)}

cards:
${JSON.stringify(args.cards ?? [], null, 2)}

artifacts:
${JSON.stringify((args.artifacts ?? []).map((artifact) => ({
  cardTitle: artifact.cardTitle,
  kind: artifact.kind,
  path: artifact.path,
  source: typeof artifact.source === "string" ? artifact.source.slice(0, 4000) : undefined,
})), null, 2)}

staticFindings:
${JSON.stringify(args.staticFindings ?? [], null, 2)}

只返回 JSON，不要 markdown。JSON 形状：
${JSON.stringify(schemaHint, null, 2)}`;

  const errors = [];
  for (const model of visionModelChain()) {
    try {
      const data = await postJson(`${baseUrl()}/chat/completions`, {
        model,
        messages: [
          { role: "system", content: "You are a strict visual QA judge. Return JSON only." },
          { role: "user", content: [{ type: "text", text: prompt }, ...images] },
        ],
        temperature: 0.1,
        max_tokens: 1200,
      });
      const text = data?.choices?.[0]?.message?.content ?? "";
      const parsed = parseJsonObject(text);
      if (!parsed) {
        errors.push(`${model}: non-json ${String(text).slice(0, 180)}`);
        continue;
      }
      return {
        backend: parsed.backend || "agnes:visual_judge",
        model,
        visualFit: ["pass", "fail", "not_checked"].includes(parsed.visualFit) ? parsed.visualFit : "not_checked",
        summary: String(parsed.summary ?? ""),
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        candidateRanking: Array.isArray(parsed.candidateRanking) ? parsed.candidateRanking : [],
      };
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
    }
  }
  return {
    backend: "agnes:visual_judge",
    model: visionModelChain().join(","),
    visualFit: "not_checked",
    summary: `Agnes 视觉判官不可用：${errors.join(" | ").slice(0, 1200)}`,
    findings: [],
    candidateRanking: [],
  };
}

async function imageGenerate(args = {}) {
  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) throw new Error("prompt is required");
  const model = String(args.model || env("AGNES_IMAGE_MODEL", DEFAULT_IMAGE_MODEL));
  const size = String(args.size || "1024x1024");
  const n = Math.max(1, Math.min(4, Number(args.n || 1)));
  const image = Array.isArray(args.images)
    ? args.images.map((item) => item?.dataUrl || item?.url || item).filter(Boolean)
    : [];
  const body = {
    model,
    prompt,
    size,
    n,
    response_format: args.response_format || "b64_json",
    ...(image.length ? { image } : {}),
  };
  const data = await postJson(`${baseUrl()}/images/generations`, body);
  const images = Array.isArray(data?.data)
    ? data.data.map((item) => ({
      url: item.url,
      b64_json: item.b64_json,
      dataUrl: item.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined,
      revisedPrompt: item.revised_prompt,
    }))
    : [];
  return {
    backend: "agnes:image_generate",
    model,
    size,
    images,
    raw: images.length ? undefined : data,
  };
}

const tools = [
  {
    name: "visual_judge",
    description: "Use Agnes vision-capable model to judge rendered diagram artifacts.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        ref: { type: "string" },
        topic: { type: "object" },
        cards: { type: "array" },
        artifacts: { type: "array" },
        staticFindings: { type: "array" },
      },
    },
  },
  {
    name: "image_generate",
    description: "Generate raster images with Agnes Image.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        prompt: { type: "string" },
        size: { type: "string" },
        n: { type: "number" },
        model: { type: "string" },
        images: { type: "array" },
      },
      required: ["prompt"],
    },
  },
];

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    write(jsonRpcResult(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "agnes-image-server", version: "1.0.0" },
    }));
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    write(jsonRpcResult(id, { tools }));
    return;
  }
  if (method === "tools/call") {
    try {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name === "visual_judge") write(jsonRpcResult(id, toolText(await visualJudge(args))));
      else if (name === "image_generate") write(jsonRpcResult(id, toolText(await imageGenerate(args))));
      else throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      write(jsonRpcError(id, error));
    }
    return;
  }
  if (id != null) write(jsonRpcError(id, new Error(`Unknown method: ${method}`)));
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    await handle(JSON.parse(line));
  } catch (error) {
    write(jsonRpcError(null, error));
  }
});
