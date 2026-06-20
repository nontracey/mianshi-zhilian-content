// scripts/llm/discover-local.mjs
// 本地模型自动发现：Ollama /api/tags + vLLM /v1/models。
// 启动时若 LLM_AUTODISCOVER_LOCAL=true，自动拉本地模型加入池。
// 每个发现的模型自动设 tier=local、autoScale=false、maxConcurrency=1。
// 模型名含 -vl/-vision/qwen2-vl 等自动加 image modality。

import { envConfig } from "./env-config.mjs";

const VISION_NAME_PATTERNS = /-vl$|-vision$|-vl-|qwen2.?vl|qwen2.?vision|llava|internvl|cogvlm|minicpm-v/i;

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeOpenAiCompatibleModels(baseUrl, timeoutMs = 5000) {
  const started = Date.now();
  const data = await fetchJson(`${String(baseUrl).replace(/\/$/, "")}/models`, timeoutMs);
  if (!data) return null;
  return { latencyMs: Date.now() - started, data };
}

// Ollama: GET /api/tags → { models: [{ name, details: { parameter_size, quantization_level } }] }
export async function discoverOllama(baseUrl = "http://127.0.0.1:11434") {
  const data = await fetchJson(`${baseUrl}/api/tags`);
  if (!data || !Array.isArray(data.models)) return [];
  return data.models.map((m) => {
    const name = String(m.name).replace(/:latest$/, "");
    const isVision = VISION_NAME_PATTERNS.test(name);
    return {
      provider: "ollama",
      id: m.name,
      name: `Ollama ${name}`,
      baseUrl: `${baseUrl}/v1`,
      apiKeyOptional: true,
      local: true,
      tier: "local",
      modality: isVision ? ["text", "json", "image"] : ["text", "json"],
      imageUnderstanding: isVision ? "native" : "none",
      maxContext: 32768, // Ollama 默认 32k 上下文，用户可调
      maxOutputTokens: 8192,
      maxConcurrency: 1,
      autoScale: { enabled: false, min: 1, max: 1 },
      details: m.details ?? {},
    };
  });
}

// vLLM / 任意 OpenAI 兼容本地网关: GET /v1/models → { data: [{ id }] }
export async function discoverVllm(baseUrl = "http://127.0.0.1:8000") {
  const data = await fetchJson(`${baseUrl.replace(/\/$/, "")}/v1/models`);
  if (!data || !Array.isArray(data.data)) return [];
  return data.data.map((m) => {
    const id = String(m.id);
    const isVision = VISION_NAME_PATTERNS.test(id);
    return {
      provider: "vllm",
      id,
      name: `vLLM ${id}`,
      baseUrl: baseUrl.replace(/\/$/, ""),
      apiKeyOptional: true,
      local: true,
      tier: "local",
      modality: isVision ? ["text", "json", "image"] : ["text", "json"],
      imageUnderstanding: isVision ? "native" : "none",
      maxContext: 32768,
      maxOutputTokens: 8192,
      maxConcurrency: 1,
      autoScale: { enabled: false, min: 1, max: 1 },
    };
  });
}

// 统一入口：按配置发现所有本地模型
export async function discoverLocalModels() {
  const enabled = /^(1|true|yes|on)$/i.test(envConfig.getEnv("LLM_AUTODISCOVER_LOCAL", "false"));
  if (!enabled) return { models: [], sources: [] };

  const sources = String(envConfig.getEnv("LLM_AUTODISCOVER_ENDPOINTS", "ollama:http://127.0.0.1:11434"))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const out = [];
  for (const source of sources) {
    const splitAt = source.indexOf(":");
    if (splitAt <= 0) continue;
    const kind = source.slice(0, splitAt);
    const baseUrl = source.slice(splitAt + 1);
    if (!baseUrl) continue;
    const fullUrl = /^https?:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`;
    try {
      if (kind === "ollama") {
        out.push(...await discoverOllama(fullUrl));
      } else if (kind === "vllm") {
        out.push(...await discoverVllm(fullUrl));
      }
    } catch {}
  }
  return { models: out, sources };
}

export async function probeLocalModels({ timeoutMs = 5000 } = {}) {
  const localModels = envConfig.listModels({ hasKey: true }).filter((model) => model.local);
  const results = [];
  for (const model of localModels) {
    const spec = `${model.provider}:${model.id}`;
    try {
      const probe = await probeOpenAiCompatibleModels(model.baseUrl, timeoutMs);
      if (probe) {
        envConfig.setLocalLatency(spec, probe.latencyMs);
        results.push({ spec, ok: true, latencyMs: probe.latencyMs });
      } else {
        results.push({ spec, ok: false, reason: "no /models response" });
      }
    } catch (error) {
      results.push({ spec, ok: false, reason: error.message });
    }
  }
  return results;
}
