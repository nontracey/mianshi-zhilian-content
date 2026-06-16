// scripts/llm/openai-runner.mjs
// OpenAI 兼容 /chat/completions runner（v3）。
// 关键能力：
//   ① SSE 流式（stream:true）→ 每个 delta 触发 onProgress({ type:"token", tokens, lastLine }）
//   ② 非流式回退:provider 不支持 stream / 流式半路坏掉 → 自动切 stream:false 兜底
//   ③ 失败分类:走 quota.classifyHttpError → quota / availability / fatal
//   ④ schema strict（json_schema）+ 截断重试（max_tokens 翻倍上限 32k）
//   ⑤ reasoning 模型自动加 prefix + low effort,GLM-5.1 等不失控

import { envConfig } from "./env-config.mjs";
import { classifyHttpError, looksLikeQuotaText, QuotaError, AvailabilityError } from "./quota.mjs";

const DEFAULT_TIMEOUT_MS = 120000;
const REASONING_PROMPT_PREFIX =
  "Think briefly (1-3 short steps), then answer. Do not exhaust your token budget on chain-of-thought.\n\n";

// 同一 spec 已知 schemaMode 缓存:首次试 json_schema 失败后记下来,后续直接用 prompt。
const SCHEMA_MODE_CACHE = new Map(); // spec -> "json_schema" | "json_object" | "prompt"

// 已知不支持 response_format 的 provider/host 提前钉成 prompt 模式,免去 2 次失败探测。
// 火山方舟 ark coding v3 端点(volcengine)整族都不支持 response_format → 直接 prompt。
function initialSchemaModeFor(spec) {
  if (!spec) return "json_schema";
  if (spec.startsWith("volcengine:")) return "prompt";
  return "json_schema";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt) {
  const base = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
  return base + Math.floor(Math.random() * 250);
}

function safeParseJson(text) {
  if (!text) return undefined;
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}

function mergeSampling(modelMeta, override) {
  const base = modelMeta.reasoning
    ? { temperature: 0.2, top_p: 0.8, max_tokens: 16384, reasoning_effort: modelMeta.reasoningEffort || "low" }
    : { temperature: 0.3, top_p: 0.8, max_tokens: 16384 };
  return { ...base, ...(override || {}) };
}

function buildBody({ model, systemPrompt, userPrompt, schema, sampling, stream, schemaMode = "json_schema" }) {
  const messages = [
    { role: "system", content: model.reasoning ? REASONING_PROMPT_PREFIX + systemPrompt : systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const body = { model: model.id, messages, ...sampling };
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  if (schema) {
    if (schemaMode === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "result", schema, strict: true },
      };
    } else if (schemaMode === "json_object") {
      body.response_format = { type: "json_object" };
    } else if (schemaMode === "prompt") {
      // 不在 body 上加 response_format,改为往 prompt 头部塞 schema 描述。
      const schemaHint = "你必须返回严格符合下面 JSON Schema 的 JSON 对象。不要任何额外解释、不要 markdown 围栏,只返回纯 JSON。\n```\n" + JSON.stringify(schema) + "\n```";
      messages[0] = { role: "system", content: schemaHint + "\n\n" + messages[0].content };
    }
  }
  return body;
}

// 把 ReadableStream<Uint8Array> 解析成 SSE event 数组,逐个 yield
async function* iterateSSE(reader) {
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^\s/, ""));
      for (const data of dataLines) {
        if (data === "[DONE]") return;
        if (!data) continue;
        try {
          yield JSON.parse(data);
        } catch {
          // 忽略心跳/注释帧
        }
      }
    }
  }
}

function lastNonEmptyLine(text, maxLen = 80) {
  if (!text) return "";
  const lines = String(text).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t) {
      if (t.length <= maxLen) return t;
      return "…" + t.slice(-maxLen + 1);
    }
  }
  return "";
}

async function runStream({ url, body, headers, timeoutMs, signal, spec, onProgress, lastLineMax }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("stream timeout")), timeoutMs);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal || ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    clearTimeout(timer);
    throw classifyHttpError(spec, res.status, errBody);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/event-stream") && !ct.includes("application/x-ndjson")) {
    const data = await res.json().catch(() => null);
    clearTimeout(timer);
    if (!data) throw new Error(`[openai-runner] stream 请求返回非 SSE 也非 JSON spec=${spec}`);
    return { _nonStreamFallback: true, data, durationMs: Date.now() - t0 };
  }

  const reader = res.body.getReader();
  let textBuf = "";
  let finishReason = null;
  let usage = null;
  let actualModel = null;
  let outputTokens = 0;
  try {
    for await (const chunk of iterateSSE(reader)) {
      if (chunk.error) {
        const msg = chunk.error.message || JSON.stringify(chunk.error);
        if (looksLikeQuotaText(msg)) {
          throw new QuotaError(spec, 0, msg);
        }
        throw new AvailabilityError(spec, 0, msg, "stream-error-frame");
      }
      const choice = chunk.choices?.[0];
      if (choice) {
        const delta = choice.delta?.content || choice.message?.content || "";
        if (delta) {
          textBuf += delta;
          // 估算 token: 一个 delta 大致 = 1 token,不准但够实时显示
          outputTokens += 1;
          onProgress?.({
            type: "token",
            spec,
            text: textBuf,
            delta,
            tokens: outputTokens,
            lastLine: lastNonEmptyLine(textBuf, lastLineMax),
          });
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model) actualModel = chunk.model;
    }
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
  clearTimeout(timer);

  return {
    text: textBuf,
    finishReason,
    usage: usage || {},
    actualModel,
    durationMs: Date.now() - t0,
    estTokens: outputTokens,
  };
}

async function runOnce(req) {
  const {
    spec,
    systemPrompt,
    userPrompt,
    schema,
    sampling,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retry = 3,
    onProgress,
    signal,
    stream = (envConfig.getEnv("LLM_STREAM", "true") === "true"),
    lastLineMax = Number(envConfig.getEnv("SUBAGENT_LAST_LINE_MAX", "80")) || 80,
  } = req;

  if (!systemPrompt || !userPrompt) {
    throw new Error("[openai-runner] systemPrompt 和 userPrompt 必填");
  }

  const model = envConfig.resolveSpec(spec);
  const finalSampling = mergeSampling(model, sampling);
  const url = `${model.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${model.apiKey}`,
    Accept: stream ? "text/event-stream" : "application/json",
    ...(model.extraHeaders || {}),
  };

  let useStream = !!stream;
  let schemaMode = schema ? (SCHEMA_MODE_CACHE.get(spec) || initialSchemaModeFor(spec)) : "none";
  let lastErr = null;

  for (let attempt = 1; attempt <= retry; attempt++) {
    const body = buildBody({ model, systemPrompt, userPrompt, schema, sampling: finalSampling, stream: useStream, schemaMode });

    try {
      let result;
      if (useStream) {
        const r = await runStream({
          url, body, headers, timeoutMs, signal, spec, onProgress, lastLineMax,
        });
        if (r._nonStreamFallback) {
          result = parseNonStream(r.data, spec, model, finalSampling, r.durationMs);
        } else {
          result = packResult({
            text: r.text,
            finishReason: r.finishReason,
            usage: r.usage,
            actualModel: r.actualModel,
            spec,
            model,
            sampling: finalSampling,
            durationMs: r.durationMs,
            estTokens: r.estTokens,
          });
        }
      } else {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
        const t0 = Date.now();
        try {
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: signal || ctrl.signal,
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw classifyHttpError(spec, res.status, errBody);
          }
          const data = await res.json();
          result = parseNonStream(data, spec, model, finalSampling, Date.now() - t0);
        } finally {
          clearTimeout(timer);
        }
      }

      if (result.stopReason === "truncated") {
        const err = new Error(`[openai-runner] 输出被 max_tokens 截断 spec=${spec}`);
        err.truncated = true;
        err.spec = spec;
        lastErr = err;
        onProgress?.({ type: "retry", attempt, reason: "truncated", spec });
        if (attempt < retry) {
          finalSampling.max_tokens = Math.min(32768, (finalSampling.max_tokens || 16384) * 2);
          continue;
        }
        throw err;
      }

      return result;
    } catch (err) {
      // 配额错误:不重试不降级,抛给 router 走暂停
      if (err instanceof QuotaError || err.quotaFailure) {
        throw err;
      }

      // schema 不被 provider 支持:json_schema → json_object → prompt
      if (
        schema &&
        err.status === 400 &&
        /response_format(?:\.type)?[^"]*not\s+(?:valid|supported)|`json[_-]schema`\s+is\s+not\s+supported|`json[_-]object`\s+is\s+not\s+supported/i.test(err.message || "")
      ) {
        if (schemaMode === "json_schema") {
          schemaMode = "json_object";
          SCHEMA_MODE_CACHE.set(spec, schemaMode);
          onProgress?.({ type: "schema-fallback", spec, mode: "json_object" });
          continue;
        }
        if (schemaMode === "json_object") {
          schemaMode = "prompt";
          SCHEMA_MODE_CACHE.set(spec, schemaMode);
          onProgress?.({ type: "schema-fallback", spec, mode: "prompt" });
          continue;
        }
      }

      // 流式失败 + 提示不支持流 → 回退非流式重试
      if (useStream && (err.status === 400) && /stream|sse|not.?support/i.test(err.message || "")) {
        useStream = false;
        onProgress?.({ type: "fallback-non-stream", spec });
        continue;
      }

      if (err.availabilityFailure || err.name === "AbortError" || /timeout|abort/i.test(err.message || "")) {
        const e = err.availabilityFailure
          ? err
          : Object.assign(new Error(`[openai-runner] timeout/abort spec=${spec} ${err.message || ""}`), {
              availabilityFailure: true,
              spec,
            });
        lastErr = e;
        onProgress?.({ type: "retry", attempt, reason: e.reason || "availability", spec });
        if (attempt < retry) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw e;
      }

      throw err;
    }
  }

  throw lastErr || new Error(`[openai-runner] 未知错误 spec=${spec}`);
}

function parseNonStream(data, spec, model, sampling, durationMs) {
  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error(`[openai-runner] 响应无 choice spec=${spec}`);
  }
  const text = choice.message?.content || "";
  const usage = data.usage || {};
  return packResult({
    text,
    finishReason: choice.finish_reason,
    usage,
    actualModel: data.model,
    spec,
    model,
    sampling,
    durationMs,
  });
}

function packResult({ text, finishReason, usage, actualModel, spec, model, sampling, durationMs, estTokens }) {
  const stopReason =
    finishReason === "length"
      ? "truncated"
      : finishReason === "stop" || finishReason === "tool_calls" || finishReason === null
        ? "ok"
        : finishReason || "ok";
  return {
    text,
    parsed: safeParseJson(text),
    stopReason,
    durationMs,
    usage: {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens ?? estTokens,
      totalTokens: usage.total_tokens,
    },
    model: {
      requested: spec,
      actual: actualModel || model.id,
      provider: model.provider,
    },
    sampling,
  };
}

export const openaiRunner = { run: runOnce };
export { runOnce };
