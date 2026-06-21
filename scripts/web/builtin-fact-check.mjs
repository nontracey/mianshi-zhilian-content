// scripts/web/builtin-fact-check.mjs
// 内置事实核验后端：search → top-N → fetchAndExtract → 返回结构化结果。
//
// auto 模式优先级（probeBackends 排序后）：
//   google-cse → bing → baidu → sogou → duckduckgo
// 显式 backend 则强制走指定后端。
// 全失败 → status=unreachable，不阻塞精修。

import { envConfig } from "../llm/env-config.mjs";
import { search } from "./search.mjs";
import { fetchAndExtract } from "./fetch.mjs";
import { probeBackends } from "./probe.mjs";
import { buildDocBiasedQueries, isAuthoritative } from "./authoritative-sources.mjs";

function numResults() {
  return Math.max(1, Math.min(5, Number(envConfig.getEnv("FACT_CHECK_NUM_RESULTS", "3")) || 3));
}

function buildQuery(topic) {
  const tags = Array.isArray(topic.tags) ? topic.tags.slice(0, 3).join(" ") : "";
  return `${topic.title} ${topic.domain} ${tags}`.trim().slice(0, 120);
}

function preferDocs() {
  const raw = envConfig.getEnv("FACT_CHECK_PREFER_OFFICIAL_DOCS", "true");
  return /^(1|true|yes|on)$/i.test(raw);
}

async function searchWithFallback(query, preferredBackends) {
  for (const backend of preferredBackends) {
    try {
      const results = await search(query, { backend, num: numResults() });
      if (results.length) return { backend, results };
    } catch (error) {
      // 单个后端失败继续试下一个
    }
  }
  return null;
}

// 先官方文档：依次跑 buildDocBiasedQueries（site: 受限 → 关键词加权 → 兜底），按 url 去重合并，
// 权威源排前。任一查询成功即纳入；全空再退回单条通用查询。
async function searchDocsFirst(topic, preferredBackends) {
  const queries = buildDocBiasedQueries(topic);
  const seen = new Set();
  const merged = [];
  let usedBackend = null;
  for (const q of queries) {
    const hit = await searchWithFallback(q.query, preferredBackends);
    if (!hit) continue;
    usedBackend = usedBackend ?? hit.backend;
    for (const r of hit.results) {
      const key = (r.url || "").split("#")[0];
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...r, authoritative: r.authoritative ?? isAuthoritative(r.url, topic) });
    }
    // 已经攒够权威源就不必再发更多查询，省请求
    if (merged.filter((r) => r.authoritative).length >= numResults()) break;
  }
  if (!merged.length) return null;
  // 权威源排前，其余按原序
  merged.sort((a, b) => Number(b.authoritative) - Number(a.authoritative));
  return { backend: usedBackend, results: merged.slice(0, Math.max(numResults() * 2, 6)), query: queries[0].query };
}

async function fetchTopResults(results, max = 3) {
  const top = results.slice(0, max);
  const fetched = await Promise.all(
    top.map((item) => fetchAndExtract(item.url).then((doc) => (doc ? { ...item, ...doc } : item))),
  );
  return fetched;
}

function buildFindings(topic, query, searchResults, fetchedDocs) {
  // 内置版本不调 LLM 判断对错（避免额外开销），只把搜索摘要 + 抓取正文打包给判官用。
  // 判官 prompt 拿到 factEvidence 后自己对比 topic 内容 vs sources 判断 wrong/outdated。
  // authoritative=true 的来源（官方文档）才能触发 wrong/outdated；非权威源最多触发 suspicious。
  const findings = [];
  for (const doc of fetchedDocs) {
    if (!doc.text) continue;
    const auth = doc.authoritative ?? isAuthoritative(doc.url, topic);
    findings.push({
      claim: doc.title || doc.url,
      evidence: doc.text.slice(0, 1500),
      source: doc.url,
      authoritative: auth,
      verdict: "needs_judge",
    });
  }
  return findings;
}

export async function builtinFactCheck(topic, ref, opts = {}) {
  const explicitBackend = opts.backend && opts.backend !== "auto" ? opts.backend : null;
  const query = buildQuery(topic);

  let preferredBackends;
  if (explicitBackend) {
    preferredBackends = [explicitBackend];
  } else {
    const probe = await probeBackends();
    preferredBackends = probe.filter((entry) => entry.ok).map((entry) => entry.backend);
    if (!preferredBackends.length) {
      return {
        status: "unreachable",
        summary: `联网搜索全失败：${probe.map((p) => `${p.backend}=${p.ok ? "ok" : p.reason}`).join("; ")}`,
        findings: [],
        sources: [],
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // 默认"先官方文档"：site: 受限 + 关键词加权 + 权威源排前；关掉则退回单条通用查询。
  const searchResult = preferDocs()
    ? (await searchDocsFirst(topic, preferredBackends)) ?? (await searchWithFallback(query, preferredBackends))
    : await searchWithFallback(query, preferredBackends);
  if (!searchResult) {
    return {
      status: "unreachable",
      summary: `所有搜索后端都未返回结果：${preferredBackends.join(", ")}`,
      findings: [],
      sources: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const fetched = await fetchTopResults(searchResult.results, numResults());
  const findings = buildFindings(topic, query, searchResult.results, fetched).map((f) => ({
    ...f,
    authoritative: isAuthoritative(f.source, topic),
  }));
  const sources = fetched.map((doc) => ({
    title: doc.title || doc.url,
    url: doc.url,
    snippet: doc.snippet || (doc.text ?? "").slice(0, 200),
    backend: searchResult.backend,
    authoritative: doc.authoritative ?? isAuthoritative(doc.url, topic),
  }));

  const authCount = sources.filter((s) => s.authoritative).length;
  return {
    status: "checked",
    summary: `内置 ${searchResult.backend} 搜索 "${searchResult.query ?? query}"（优先官方文档），拿到 ${searchResult.results.length} 条结果，抓取 ${fetched.filter((d) => d.text).length} 篇正文，其中 ${authCount} 篇来自官方文档/权威站点。判官请优先以官方文档为准，对比 topic 内容判断 wrong/outdated；版本/默认值/复杂度/API 行为等以一手文档为最高证据。`,
    findings,
    sources,
    backend: searchResult.backend,
    query: searchResult.query ?? query,
    authoritativeCount: authCount,
    checkedAt: new Date().toISOString(),
  };
}
