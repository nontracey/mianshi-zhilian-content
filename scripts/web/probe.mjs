// scripts/web/probe.mjs
// 搜索后端可达性探测：并发小请求测延迟，返回按可用性 + 延迟排序的列表。
// 用于 auto 模式自动选最优后端。

import { envConfig } from "../llm/env-config.mjs";
import { search } from "./search.mjs";

// 探测缓存：避免每次 fact check 都重测
let probeCache = { at: 0, results: [] };
const PROBE_CACHE_MS = Number(envConfig.getEnv("FACT_CHECK_PROBE_CACHE_MS", "600000")) || 600000;

// 简单查询用于探测，每个后端跑一次
const PROBE_QUERY = "JVM garbage collection";

async function probeOne(backend) {
  const start = Date.now();
  try {
    // 探测时不要求拿满 num，1 条够判断可达
    const results = await search(PROBE_QUERY, { backend, num: 1, timeoutMs: 8000 });
    if (!Array.isArray(results) || !results.length) {
      return { backend, ok: false, latencyMs: Date.now() - start, reason: "empty results" };
    }
    return { backend, ok: true, latencyMs: Date.now() - start, sampleCount: results.length };
  } catch (error) {
    return { backend, ok: false, latencyMs: Date.now() - start, reason: error.message };
  }
}

// 按配置 + 可达性决定探测列表
function backendsToProbe() {
  const apiKey = envConfig.getEnv("FACT_CHECK_API_KEY") || envConfig.getEnv("GOOGLE_API_KEY");
  const bingKey = envConfig.getEnv("BING_API_KEY");
  const cx = envConfig.getEnv("FACT_CHECK_CX");
  const candidates = [];
  if (apiKey && cx) candidates.push("google-cse");
  if (apiKey || bingKey) candidates.push("bing");
  // 国内零配置首选
  candidates.push("baidu", "sogou", "duckduckgo");
  return candidates;
}

export async function probeBackends(force = false) {
  if (!force && probeCache.results.length && Date.now() - probeCache.at < PROBE_CACHE_MS) {
    return probeCache.results;
  }
  const candidates = backendsToProbe();
  const results = await Promise.all(candidates.map(probeOne));
  // 排序：可用的在前，按延迟升序
  const sorted = results.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return a.latencyMs - b.latencyMs;
  });
  probeCache = { at: Date.now(), results: sorted };
  return sorted;
}

export function clearProbeCache() {
  probeCache = { at: 0, results: [] };
}

export function probeSnapshot() {
  return { age: Date.now() - probeCache.at, results: probeCache.results };
}
