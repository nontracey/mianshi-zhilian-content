// scripts/llm/quota.mjs
// 把"模型响应错误"分类成 quota / availability / fatal,供 router 决定走暂停 vs 重试 vs 抛错。
//
// 三类:
//   quota         — 配额/额度耗尽,需要全局暂停或自动探活
//   availability  — 短期不可用(限流、超时、5xx),走 router 重试 + 降级链
//   fatal         — 鉴权失败、参数错、404 等,直接抛(没救)

const QUOTA_KEYWORDS = [
  // EN
  /quota\s+exceeded/i,
  /insufficient[_\s]+(?:quota|balance|funds|credit)/i,
  /you\s+have\s+exceeded/i,
  /payment\s+required/i,
  /balance\s+(?:not\s+enough|insufficient|too\s+low)/i,
  /credit\s+exhausted/i,
  /usage\s+limit/i,
  /monthly\s+limit/i,
  /daily\s+limit/i,
  /rate\s+limit\s+(?:per\s+(?:day|month))/i, // 日/月维度的限流当配额
  // CN
  /额度(?:不足|耗尽|用完|超限|已用)/,
  /余额(?:不足|为零|不够)/,
  /欠费/,
  /配额(?:不足|耗尽|用完|超限)/,
  /限额(?:已达|耗尽|超限)/,
  /账户.*?(?:停用|冻结|欠费)/,
  /(?:今日|本月).*?限制/,
];

const AVAILABILITY_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 522, 524]);
const QUOTA_HTTP_STATUS = new Set([402]); // 明确配额
// 403 / 429 需要看 body 关键词来区分

export class QuotaError extends Error {
  constructor(spec, status, body) {
    super(`[quota] 额度耗尽 spec=${spec} status=${status} body=${body.slice(0, 200)}`);
    this.name = "QuotaError";
    this.quotaFailure = true;
    this.spec = spec;
    this.status = status;
    this.body = body;
  }
}

export class AvailabilityError extends Error {
  constructor(spec, status, body, reason) {
    super(`[availability] 可用性失败 spec=${spec} status=${status} reason=${reason} body=${body.slice(0, 200)}`);
    this.name = "AvailabilityError";
    this.availabilityFailure = true;
    this.spec = spec;
    this.status = status;
    this.body = body;
    this.reason = reason;
  }
}

export function classifyHttpError(spec, status, body = "") {
  const bodyText = String(body || "");

  if (QUOTA_HTTP_STATUS.has(status)) {
    return new QuotaError(spec, status, bodyText);
  }

  // 403 / 429 / 400 都可能携带配额关键词
  if ((status === 403 || status === 429 || status === 400) && QUOTA_KEYWORDS.some((re) => re.test(bodyText))) {
    return new QuotaError(spec, status, bodyText);
  }

  if (AVAILABILITY_HTTP_STATUS.has(status)) {
    return new AvailabilityError(spec, status, bodyText, `http ${status}`);
  }

  // 其它(401/404/400 非配额):fatal
  const err = new Error(`[fatal] http ${status} spec=${spec} body=${bodyText.slice(0, 500)}`);
  err.status = status;
  err.spec = spec;
  return err;
}

// 文本兜底:用于网络层错误(没有 status 时,例如 fetch reject)
export function looksLikeQuotaText(text) {
  if (!text) return false;
  return QUOTA_KEYWORDS.some((re) => re.test(text));
}

// 探活:发一个最小请求看 spec 是否恢复;返回 { ok, error?, latencyMs }
// 不走 router/openai-runner 的重试/降级,只是裸 fetch + 极小 prompt。
export async function probeSpec(spec, { envConfig, maxTokens = 4, timeoutMs = 30000, signal } = {}) {
  const model = envConfig.resolveSpec(spec);
  const url = `${model.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: model.id,
    messages: [
      { role: "system", content: "ping" },
      { role: "user", content: "1" },
    ],
    temperature: 0,
    max_tokens: maxTokens,
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error("probe timeout")), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: signal || ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const err = classifyHttpError(spec, res.status, errBody);
      return { ok: false, error: err, latencyMs: Date.now() - t0 };
    }
    // 不关心响应内容,只要 200 就算恢复
    await res.text().catch(() => "");
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e, latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}
