// scripts/web/fetch.mjs
// URL 正文抓取：Node 原生 fetch + 正则去标签提正文（不引 cheerio）。
// 带浏览器 UA + Referer 头降低被墙概率。

import { envConfig } from "../llm/env-config.mjs";

const DEFAULT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function userAgent() {
  return envConfig.getEnv("FACT_CHECK_USER_AGENT") || DEFAULT_UA;
}

function timeoutMs() {
  return Number(envConfig.getEnv("FACT_CHECK_FETCH_TIMEOUT_MS", "15000")) || 15000;
}

function stripTags(html) {
  return String(html ?? "")
    // 移除 script/style/noscript/iframe
    .replace(/<(script|style|noscript|iframe|svg|head)[\s\S]*?<\/\1>/gi, " ")
    // 块级元素转换行
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|hr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // 去剩余标签
    .replace(/<[^>]+>/g, " ")
    // HTML 实体
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    // 收敛空白
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractMainText(html) {
  // 简易正文抽取：找最长的 <p> 段落群；失败回退全页 stripTags
  const paragraphs = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = re.exec(html))) {
    const text = stripTags(match[1]).trim();
    if (text.length >= 40) paragraphs.push(text);
  }
  if (paragraphs.length) {
    const combined = paragraphs.join("\n\n");
    if (combined.length >= 200) return combined.slice(0, 8000);
  }
  return stripTags(html).slice(0, 8000);
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).trim() : "";
}

export async function fetchAndExtract(url, opts = {}) {
  const ms = Number(opts.timeoutMs) || timeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": userAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": new URL(url).origin,
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    return {
      url,
      title: extractTitle(html),
      text: extractMainText(html),
      contentType: res.headers.get("content-type") ?? "",
      bytes: html.length,
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export { stripTags, extractMainText, extractTitle };
