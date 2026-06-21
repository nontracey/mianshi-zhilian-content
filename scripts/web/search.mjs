// scripts/web/search.mjs
// 内置搜索后端：Google CSE / Bing API / Bing HTML / Baidu / Sogou / DuckDuckGo。
// 全部用 Node 原生 fetch，不引第三方依赖。
//
// 国内可达性（优先级）：
// - Google CSE: 需翻墙 + API key + CX
// - Bing API: 国内可达 + API key
// - Bing HTML (cn.bing.com): 国内零配置首选（无 key，结构稳定，英中文均可）
// - Baidu HTML: 常被安全验证拦截（CAPTCHA），已降为备选
// - Sogou HTML: 国内备选（无 key，偶发 403）
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

// ===== Bing HTML (cn.bing.com, 无 key，国内零配置首选) =====
export async function searchBingHtml(query, opts = {}) {
  const num = opts.num || numResults();
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&count=${num * 2}`;
  const { ok, text, status } = await fetchText(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (!ok || !text) throw new Error(`BingHtml HTTP ${status}`);
  const results = [];
  // Bing 结果在 <li class="b_algo"> 内
  const re = /<li[^>]+class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(text)) !== null && results.length < num) {
    const block = m[1];
    const linkM = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkM) continue;
    const itemUrl = linkM[1];
    if (!itemUrl.startsWith("http")) continue;
    const title = stripTags(linkM[2]).trim();
    if (!title) continue;
    const snippetM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetM ? stripTags(snippetM[1]).trim().slice(0, 300) : "";
    results.push({ title, url: itemUrl, snippet, source: "bing-html" });
  }
  return results;
}

// ===== Baidu HTML（无 key，常被安全验证拦截，降为备选）=====
export async function searchBaidu(query, opts = {}) {
  const num = opts.num || numResults();
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${num}&ie=utf-8`;
  const { ok, text, status } = await fetchText(url);
  if (!ok || !text) throw new Error(`Baidu HTTP ${status}`);
  // 检测安全验证页面（CAPTCHA）：百度被触发时返回极短页面或含"安全验证"关键词
  if (text.length < 5000 || /百度安全验证|安全验证|mkdjump/i.test(text)) {
    throw new Error(`Baidu 安全验证拦截（CAPTCHA）`);
  }
  const results = [];
  // 多重 fallback 策略：h3>a、c-title、result 容器
  const re = /<h3[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(text)) && results.length < num) {
    const url = match[1];
    const title = stripTags(match[2]).trim();
    if (!url || !title || url.startsWith("https://www.baidu.com")) continue;
    const after = text.slice(match.index, match.index + 2000);
    const snippetMatch = after.match(/<span[^>]*class="content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || after.match(/<div[^>]*class="c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || after.match(/<p[^>]*class="[^"]*c-color-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
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
  const backend = opts.backend || "bing-html";
  const map = {
    "google-cse": searchGoogleCSE,
    "bing": searchBing,
    "bing-html": searchBingHtml,
    "baidu": searchBaidu,
    "sogou": searchSogou,
    "duckduckgo": searchDuckDuckGo,
  };
  const fn = map[backend];
  if (!fn) throw new Error(`未知搜索后端：${backend}`);
  return await fn(query, opts);
}

export const SEARCH_BACKENDS = ["google-cse", "bing", "bing-html", "baidu", "sogou", "duckduckgo"];
