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
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch (e1) {
    try {
      return JSON.parse(repairJson(s));
    } catch {
      const err = new Error(`JSON 解析失败：${e1.message}`);
      err.jsonParse = true; // 标记为可 re-roll 重试的失败
      throw err;
    }
  }
}

// 修常见的 LLM 坏 JSON：非法反斜杠转义、对象/数组尾随逗号。其余结构性错误交给上层 re-roll 重试。
function repairJson(s) {
  return s
    .replace(/\\(?!["\\/bfnrtu])/g, "\\\\") // \ 后面不是合法转义字符 → 补成 \\
    .replace(/,\s*([}\]])/g, "$1"); // 去掉 } ] 前的多余逗号
}
