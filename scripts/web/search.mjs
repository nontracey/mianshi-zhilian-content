// scripts/web/search.mjs
// 内置搜索后端：Google CSE / Bing / Baidu / Sogou / DuckDuckGo。
// 全部用 Node 原生 fetch，不引第三方依赖。
//
// 国内可达性：
// - Google CSE: 需翻墙 + API key + CX
// - Bing API: 国内可达 + API key
// - Baidu HTML: 国内零配置首选（无 key，带浏览器 UA 绕基础反爬）
// - Sogou HTML: 国内备选（无 key）
// - DuckDuckGo HTML: 国外备选（无 key，国内通常被墙）

import { envConfig } from "../llm/env-config.mjs";
import { stripTags } from "./fetch.mjs";

const DEFAULT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function userAgent() {
  return envConfig.getEnv("FACT_CHECK_USER_AGENT") || DEFAULT_UA;
}

function numResults() {
  return Math.max(1, Math.min(10, Number(envConfig.getEnv("FACT_CHECK_NUM_RESULTS", "3")) || 3));
}

function timeoutMs() {
  return Number(envConfig.getEnv("FACT_CHECK_FETCH_TIMEOUT_MS", "15000")) || 15000;
}

async function fetchText(url, opts = {}) {
  const ms = Number(opts.timeoutMs) || timeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": userAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...(opts.headers ?? {}),
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: "", error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

// ===== Google Custom Search Engine =====
export async function searchGoogleCSE(query, opts = {}) {
  const apiKey = opts.apiKey || envConfig.getEnv("FACT_CHECK_API_KEY") || envConfig.getEnv("GOOGLE_API_KEY");
  const cx = opts.cx || envConfig.getEnv("FACT_CHECK_CX");
  if (!apiKey || !cx) throw new Error("searchGoogleCSE 需要 FACT_CHECK_API_KEY + FACT_CHECK_CX");
  const num = opts.num || numResults();
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${num}`;
  const { ok, text, status } = await fetchText(url);
  if (!ok) throw new Error(`Google CSE HTTP ${status}`);
  const data = JSON.parse(text);
  if (!Array.isArray(data.items)) return [];
  return data.items.slice(0, num).map((item) => ({
    title: stripTags(item.title || "").trim(),
    url: item.link,
    snippet: stripTags(item.snippet || "").trim(),
    source: "google-cse",
  }));
}

// ===== Bing API =====
export async function searchBing(query, opts = {}) {
  const apiKey = opts.apiKey || envConfig.getEnv("FACT_CHECK_API_KEY") || envConfig.getEnv("BING_API_KEY");
  if (!apiKey) throw new Error("searchBing 需要 FACT_CHECK_API_KEY 或 BING_API_KEY");
  const num = opts.num || numResults();
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${num}&mkt=zh-CN`;
  const { ok, text, status } = await fetchText(url, { headers: { "Ocp-Apim-Subscription-Key": apiKey } });
  if (!ok) throw new Error(`Bing HTTP ${status}`);
  const data = JSON.parse(text);
  const items = data.webPages?.value ?? [];
  return items.slice(0, num).map((item) => ({
    title: stripTags(item.name || "").trim(),
    url: item.url,
    snippet: stripTags(item.snippet || "").trim(),
    source: "bing",
  }));
}

// ===== Baidu HTML（无 key）=====
export async function searchBaidu(query, opts = {}) {
  const num = opts.num || numResults();
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${num}&ie=utf-8`;
  const { ok, text, status } = await fetchText(url);
  if (!ok || !text) throw new Error(`Baidu HTTP ${status}`);
  // 百度搜索结果解析：每个结果在 <div class="result" ...> 或 <div class="c-container" ...> 里
  const results = [];
  // 先抓所有 h3 + 紧跟的 a 链接
  const re = /<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(text)) && results.length < num) {
    const url = match[1];
    const title = stripTags(match[2]).trim();
    if (!url || !title) continue;
    // 抓 snippet：找该 h3 之后到下一个 h3 之间的文本
    const after = text.slice(match.index, match.index + 2000);
    const snippetMatch = after.match(/<span[^>]*class="content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || after.match(/<div[^>]*class="c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || after.match(/<div[^>]*class="c-span-last"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : "";
    results.push({ title, url, snippet, source: "baidu" });
  }
  return results;
}

// ===== Sogou HTML（无 key）=====
export async function searchSogou(query, opts = {}) {
  const num = opts.num || numResults();
  const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}&num=${num}`;
  const { ok, text, status } = await fetchText(url);
  if (!ok || !text) throw new Error(`Sogou HTTP ${status}`);
  const results = [];
  const re = /<h3[^>]*class="vr-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(text)) && results.length < num) {
    const url = match[1];
    const title = stripTags(match[2]).trim();
    if (!url || !title) continue;
    const after = text.slice(match.index, match.index + 2000);
    const snippetMatch = after.match(/<p[^>]*class="str-text-info[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || after.match(/<div[^>]*class="fz-mid[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : "";
    results.push({ title, url: url.startsWith("http") ? url : `https://www.sogou.com${url}`, snippet, source: "sogou" });
  }
  return results;
}

// ===== DuckDuckGo HTML（无 key，国外）=====
export async function searchDuckDuckGo(query, opts = {}) {
  const num = opts.num || numResults();
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { ok, text, status } = await fetchText(url, { headers: { "Referer": "https://duckduckgo.com/" } });
  if (!ok || !text) throw new Error(`DuckDuckGo HTTP ${status}`);
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(text)) && results.length < num) {
    let url = match[1];
    // DDG 用 redirect 链接：//duckduckgo.com/l/?uddg=<encoded>
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    const title = stripTags(match[2]).trim();
    if (!url || !title) continue;
    const after = text.slice(match.index, match.index + 1500);
    const snippetMatch = after.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : "";
    results.push({ title, url, snippet, source: "duckduckgo" });
  }
  return results;
}

// ===== 统一入口 =====
export async function search(query, opts = {}) {
  const backend = opts.backend || "baidu";
  const map = {
    "google-cse": searchGoogleCSE,
    "bing": searchBing,
    "baidu": searchBaidu,
    "sogou": searchSogou,
    "duckduckgo": searchDuckDuckGo,
  };
  const fn = map[backend];
  if (!fn) throw new Error(`未知搜索后端：${backend}`);
  return await fn(query, opts);
}

export const SEARCH_BACKENDS = ["google-cse", "bing", "baidu", "sogou", "duckduckgo"];
