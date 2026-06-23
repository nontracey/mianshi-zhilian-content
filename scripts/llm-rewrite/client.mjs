// OpenAI 兼容 /chat/completions 客户端：限流退避重试 + 从回复里抠出 JSON。
import { DEFAULTS } from "./config.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callChat({ model, messages }) {
  const { baseUrl, apiKey, model: modelId, maxTokens } = model;
  let lastErr;
  for (let attempt = 0; attempt <= DEFAULTS.maxRetries; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), DEFAULTS.requestTimeoutMs);
      let res;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: modelId,
            messages,
            temperature: DEFAULTS.temperature,
            max_tokens: maxTokens,
            response_format: { type: "json_object" },
          }),
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      if (!res.ok) {
        // 4xx（非限流）通常是请求本身问题，不重试。
        const body = (await res.text()).slice(0, 300);
        const e = new Error(`HTTP ${res.status} ${body}`);
        e.fatal = true;
        throw e;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error("空回复");
      return { text, usage: data?.usage || null };
    } catch (err) {
      lastErr = err;
      if (err.fatal || attempt === DEFAULTS.maxRetries) break;
      await sleep(DEFAULTS.retryBaseMs * 2 ** attempt + Math.random() * 500);
    }
  }
  throw lastErr;
}

// 从模型回复里提取 JSON 对象（容忍 ```json 围栏 / 前后多余文字 / 常见坏转义）。
export function extractJson(text) {
  let s = String(text).trim();
  // 优先找外层 JSON 对象（最外层的 { }），避免被内部的 markdown 围栏误导
  const outerStart = s.indexOf("{");
  const outerEnd = s.lastIndexOf("}");
  if (outerStart >= 0 && outerEnd > outerStart) {
    const candidate = s.slice(outerStart, outerEnd + 1);
    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(repairJson(candidate)); } catch {}
  }
  // 备选：围栏内的 JSON（模型有时只返回 ```json ... ```）
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const inner = fence[1].trim();
    const fStart = inner.indexOf("{");
    const fEnd = inner.lastIndexOf("}");
    if (fStart >= 0 && fEnd > fStart) {
      const fc = inner.slice(fStart, fEnd + 1);
      try { return JSON.parse(fc); } catch {}
      try { return JSON.parse(repairJson(fc)); } catch {}
    }
  }
  const err = new Error("JSON 解析失败：未找到合法 JSON 对象");
  err.jsonParse = true;
  throw err;
}

// 修常见的 LLM 坏 JSON：非法反斜杠转义、尾随逗号、字符串内未转义双引号（推理模型常见）。
function repairJson(s) {
  // 1) 基础修复
  let r = s
    .replace(/\\(?!["\\/bfnrtu])/g, "\\\\") // \ 后面不是合法转义字符 → 补成 \\
    .replace(/,\s*([}\]])/g, "$1"); // 去掉 } ] 前的多余逗号
  // 2) 修复字符串内的未转义双引号（MiMo 等推理模型用 "" 做中文强调）
  r = fixUnescapedQuotes(r);
  return r;
}

function fixUnescapedQuotes(s) {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { out += c; esc = true; continue; }
    if (c !== '"') { out += c; continue; }
    if (!inStr) { inStr = true; out += c; continue; }
    // 在字符串内部遇到 "——判断是字符串结尾还是内容里的引号
    let j = i + 1;
    while (j < s.length && s[j] === " ") j++;
    const next = s[j];
    if (next === "," || next === "}" || next === "]" || next === ":" || next === undefined) {
      inStr = false; out += c; // 真正的字符串结尾
    } else {
      out += '\\"'; // 内容里的引号，转义
    }
  }
  return out;
}
