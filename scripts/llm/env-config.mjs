// scripts/llm/env-config.mjs
// 模型清单 + .env 加载 + 端点索引 + 多账号轮询 + 能力声明
//
// v3.3 升级：
// - 多账号 accounts: [{id, apiKeyEnv, apiKey, weight}]（单 apiKeyEnv 自动包成 default account）
// - spec 语法 provider:modelId[@accountId]，不写 @accountId = round-robin
// - 账号故障冷却：markAccountFailure 后 30s 内跳过该 account
// - 多模态 modality: ["text","json","image","audio"]（capabilities 别名，image 含义不变）
// - maxContext / maxOutputTokens / extraParams 模型级参数
// - autoScale: {enabled, min, max, targetLatencyMs}（仅 tier=free 默认开启）
// - imageUnderstanding: "native" | "mcp" | "none"（判官看图模式）
// - pricePerMtok: {input, output}（cost-tracker 用）
// - 新增 listModelsByCapability / listModelsByTier / pickFreeModels

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// ===== 内置模型清单 =====
// 本地精修器默认只放当前实际使用的免费/限额在线模型；其它端点走 LLM_CUSTOM_MODELS 显式加入。
// tier 取值：free | paid | local | weak | strong（weak/strong 当 paid 处理 autoscale；只有 free 默认开启 autoscale）。
const BUILTIN_MODELS = [
  {
    id: "glm-4.7-flash",
    name: "Z.AI GLM-4.7 Flash",
    provider: "zhipu",
    apiKeyEnv: "ZHIPU_API_KEY",
    baseUrl: "https://api.z.ai/api/paas/v4",
    tier: "free",
    modality: ["text", "json"],
    maxContext: 200000,
    maxOutputTokens: 131072,
    extraParams: { thinking: { type: "disabled" } },
    imageUnderstanding: "none",
    pricePerMtok: { input: 0, output: 0 },
  },
  {
    id: "LongCat-2.0-Preview",
    name: "LongCat 2.0 Preview",
    provider: "longcat",
    apiKeyEnv: "LONGCAT_API_KEY",
    baseUrl: "https://api.longcat.chat/openai",
    tier: "free",
    modality: ["text", "json"],
    maxContext: 1000000,
    maxOutputTokens: 131072,
    imageUnderstanding: "none",
    pricePerMtok: { input: 0, output: 0 },
  },
];

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

let _envCache = null;
function loadEnv() {
  if (_envCache) return _envCache;
  const out = {};
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    Object.assign(out, parseEnvFile(readFileSync(envPath, "utf8")));
  }
  Object.assign(out, process.env);
  _envCache = out;
  return out;
}

function getEnv(key, fallback) {
  const v = loadEnv()[key];
  if (v == null || v === "") return fallback;
  return v;
}

function num(key, fallback) {
  const raw = getEnv(key);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(key, fallback = false) {
  const raw = getEnv(key);
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function splitList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envSuffix(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function maybeBool(raw) {
  if (raw == null || raw === "") return undefined;
  if (/^(1|true|yes|on)$/i.test(String(raw))) return true;
  if (/^(0|false|no|off)$/i.test(String(raw))) return false;
  return undefined;
}

function maybeNum(raw) {
  if (raw == null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

// 解析模型有效期：纯日期 YYYY-MM-DD → 当天 23:59:59.999（本地时区，含当天全天）；其余按 Date.parse。无效/空 → null。
function parseExpiry(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// 通用：模型是否已过期停用（expiresAt 是 ms 时间戳）。
function isModelExpired(model, now = Date.now()) {
  return Boolean(model && model.expiresAt != null && now > model.expiresAt);
}

function parseJsonObject(raw, label) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    throw new Error("root is not object");
  } catch (error) {
    throw new Error(`[env-config] ${label} 不是合法 JSON object：${error.message}`);
  }
}

function compactObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

// ===== 模型归一化 =====
function normalizeAccounts(model) {
  if (Array.isArray(model.accounts) && model.accounts.length) {
    return model.accounts.map((acc, i) => ({
      id: String(acc.id ?? `acc${i + 1}`),
      apiKeyEnv: acc.apiKeyEnv ? String(acc.apiKeyEnv) : model.apiKeyEnv,
      apiKey: acc.apiKey ? String(acc.apiKey) : undefined,
      weight: Number(acc.weight ?? 1) || 1,
    }));
  }
  // 单 apiKeyEnv 兼容：包成 default account
  if (model.apiKeyEnv || model.apiKey || model.local || model.apiKeyOptional) {
    return [{
      id: "default",
      apiKeyEnv: model.apiKeyEnv,
      apiKey: model.apiKey,
      weight: 1,
    }];
  }
  return [];
}

function normalizeModality(model) {
  let modality = Array.isArray(model.modality)
    ? [...new Set(model.modality.map((m) => String(m).trim()).filter(Boolean))]
    : [];
  if (!modality.length) {
    modality = Array.isArray(model.capabilities)
      ? [...new Set(model.capabilities.map((c) => String(c).trim()).filter(Boolean))]
      : ["text", "json"];
  }
  if (!modality.includes("text")) modality.unshift("text");
  // 兼容旧字段 vision/image/supportsImage
  if (model.vision === true || model.image === true || model.supportsImage === true) {
    if (!modality.includes("image")) modality.push("image");
  }
  return modality;
}

function normalizeAutoScale(model) {
  const tier = model.tier || "paid";
  const isFree = tier === "free";
  const isLocal = tier === "local" || model.local === true;
  const defaults = {
    enabled: boolEnv("LLM_POOL_AUTOSCALE_ENABLED", isFree) && !isLocal,
    min: num("LLM_POOL_AUTOSCALE_MIN", 1),
    max: num("LLM_POOL_AUTOSCALE_MAX", isFree ? 8 : 1),
    targetLatencyMs: num("LLM_POOL_AUTOSCALE_TARGET_LATENCY_MS", 5000),
    errorBackoffMs: num("LLM_POOL_AUTOSCALE_ERROR_BACKOFF_MS", 30000),
  };
  if (model.autoScale && typeof model.autoScale === "object") {
    return {
      enabled: model.autoScale.enabled ?? defaults.enabled,
      min: model.autoScale.min ?? defaults.min,
      max: model.autoScale.max ?? defaults.max,
      targetLatencyMs: model.autoScale.targetLatencyMs ?? defaults.targetLatencyMs,
      errorBackoffMs: model.autoScale.errorBackoffMs ?? defaults.errorBackoffMs,
    };
  }
  return defaults;
}

function normalizeImageUnderstanding(model) {
  const v = String(model.imageUnderstanding ?? "").toLowerCase();
  if (v === "native" || v === "mcp" || v === "none") return v;
  // 自动推断：modality 含 image → native；否则 none（用户可显式覆盖为 mcp）
  const modality = normalizeModality(model);
  return modality.includes("image") ? "native" : "none";
}

function normalizeModel(model) {
  const tier = model.tier || (model.local ? "local" : "paid");
  const modality = normalizeModality(model);
  const out = {
    ...model,
    provider: String(model.provider ?? "").trim(),
    id: String(model.id ?? "").trim(),
    name: model.name || `${model.provider} ${model.id}`,
    tier,
    modality,
    capabilities: modality, // capabilities 作为 modality 别名保留
    accounts: normalizeAccounts(model),
    maxContext: Number(model.maxContext ?? 32768),
    maxOutputTokens: Number(model.maxOutputTokens ?? 16384),
    extraParams: model.extraParams && typeof model.extraParams === "object" ? model.extraParams : {},
    autoScale: normalizeAutoScale({ ...model, tier }),
    imageUnderstanding: normalizeImageUnderstanding(model),
    pricePerMtok: model.pricePerMtok && typeof model.pricePerMtok === "object"
      ? { input: Number(model.pricePerMtok.input ?? 0), output: Number(model.pricePerMtok.output ?? 0) }
      : null,
    local: tier === "local" || model.local === true,
    apiKeyOptional: Boolean(model.apiKeyOptional) || tier === "local",
    // 通用有效期：到期后所有"可用模型"列举/解析都排除它（精修器禁止使用）。
    expiresAt: parseExpiry(model.expiresAt),
    // 通用 QPS 限流：>0 时模型池按每秒令牌数限制起始速率；不填则不限。
    qps: Number.isFinite(Number(model.qps)) && Number(model.qps) > 0 ? Number(model.qps) : null,
  };
  // 旧字段保留（向后兼容）
  out.apiKeyEnv = model.apiKeyEnv;
  return out;
}

function parseJsonArray(raw, label) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.models)) return parsed.models;
    throw new Error("root is not array and has no models[]");
  } catch (error) {
    throw new Error(`[env-config] ${label} 不是合法模型 JSON：${error.message}`);
  }
}

function parseScalarCustomModels() {
  const aliases = splitList(getEnv("LLM_CUSTOM_MODELS") || getEnv("LLM_MODELS"));
  return aliases.map((alias) => {
    const suffix = envSuffix(alias);
    if (!suffix) return null;
    const key = (name) => getEnv(`LLM_MODEL_${suffix}_${name}`);
    const modality = splitList(key("MODALITY") || key("CAPABILITIES"));
    const accountAliases = splitList(key("ACCOUNTS"));
    const accounts = accountAliases.map((accountAlias) => {
      const accountSuffix = envSuffix(accountAlias);
      const accountKey = (name) => getEnv(`LLM_MODEL_${suffix}_ACCOUNT_${accountSuffix}_${name}`);
      return compactObject({
        id: accountKey("ID") || accountAlias,
        apiKeyEnv: accountKey("API_KEY_ENV"),
        apiKey: accountKey("API_KEY"),
        weight: maybeNum(accountKey("WEIGHT")),
      });
    });
    const autoScale = compactObject({
      enabled: maybeBool(key("AUTOSCALE_ENABLED")),
      min: maybeNum(key("AUTOSCALE_MIN")),
      max: maybeNum(key("AUTOSCALE_MAX")),
      targetLatencyMs: maybeNum(key("AUTOSCALE_TARGET_LATENCY_MS")),
      errorBackoffMs: maybeNum(key("AUTOSCALE_ERROR_BACKOFF_MS")),
    });
    const priceInput = maybeNum(key("PRICE_INPUT_PER_MTOK"));
    const priceOutput = maybeNum(key("PRICE_OUTPUT_PER_MTOK"));
    const extraParams = parseJsonObject(key("EXTRA_PARAMS_JSON"), `LLM_MODEL_${suffix}_EXTRA_PARAMS_JSON`);
    const model = compactObject({
      provider: key("PROVIDER") || alias,
      id: key("ID") || key("MODEL") || key("MODEL_ID"),
      name: key("NAME"),
      baseUrl: key("BASE_URL"),
      apiKeyEnv: key("API_KEY_ENV"),
      apiKey: key("API_KEY"),
      apiKeyOptional: maybeBool(key("API_KEY_OPTIONAL")),
      local: maybeBool(key("LOCAL")),
      tier: key("TIER"),
      modality,
      maxContext: maybeNum(key("MAX_CONTEXT")),
      maxOutputTokens: maybeNum(key("MAX_OUTPUT_TOKENS")),
      maxConcurrency: maybeNum(key("MAX_CONCURRENCY")),
      qps: maybeNum(key("QPS")),
      expiresAt: key("EXPIRES_AT"),
      imageUnderstanding: key("IMAGE_UNDERSTANDING"),
      extraParams,
      accounts,
      autoScale: Object.keys(autoScale).length ? autoScale : undefined,
      pricePerMtok: priceInput != null || priceOutput != null
        ? { input: priceInput ?? 0, output: priceOutput ?? 0 }
        : undefined,
    });
    return model;
  }).filter((model) => model && model.provider && model.id && model.baseUrl);
}

function loadCustomModels() {
  const out = [];
  out.push(...parseScalarCustomModels());
  const file = getEnv("LLM_MODELS_FILE");
  if (file) {
    const filePath = path.isAbsolute(file) ? file : path.join(ROOT, file);
    if (!existsSync(filePath)) throw new Error(`[env-config] LLM_MODELS_FILE 不存在：${filePath}`);
    out.push(...parseJsonArray(readFileSync(filePath, "utf8"), "LLM_MODELS_FILE"));
  }
  out.push(...parseJsonArray(getEnv("LLM_MODELS_JSON"), "LLM_MODELS_JSON"));
  return out
    .map(normalizeModel)
    .filter((model) => model.provider && model.id && model.baseUrl);
}

const runtimeModelPatches = new Map(); // spec -> patch applied after config load
const localLatencyMap = new Map(); // spec -> moving avg latency ms

function specForModel(model) {
  return `${model.provider}:${model.id}`;
}

function applyRuntimePatch(model) {
  const patch = runtimeModelPatches.get(specForModel(model));
  if (!patch) return model;
  const out = { ...model, ...patch };
  if (patch.modality) out.capabilities = patch.modality;
  return out;
}

let _modelsCache = null;
function models() {
  if (!_modelsCache) _modelsCache = [
    ...BUILTIN_MODELS.map(normalizeModel),
    ...loadCustomModels(),
  ].map(applyRuntimePatch);
  return _modelsCache;
}

function listModels({ hasKey = false, includeExpired = false } = {}) {
  const base = includeExpired ? models().slice() : models().filter((m) => !isModelExpired(m));
  if (!hasKey) return base;
  return base.filter((m) => {
    if (m.apiKeyOptional || m.local) return true;
    return m.accounts.some((acc) => {
      const key = acc.apiKey || (acc.apiKeyEnv ? getEnv(acc.apiKeyEnv) : "");
      return Boolean(key);
    });
  });
}

function listModelsByCapability(capability) {
  return models().filter((m) => (m.modality ?? []).includes(capability));
}

function listModelsByTier(tier) {
  return models().filter((m) => m.tier === tier);
}

// 从一个模型链 specs 里挑出 tier=free 的（图生成优先用免费模型）
function pickFreeModels(chain) {
  if (!Array.isArray(chain)) return [];
  return chain
    .map((spec) => ({ spec, model: findModel(spec) }))
    .filter((entry) => entry.model && entry.model.tier === "free")
    .map((entry) => entry.spec);
}

function modelHasKey(spec) {
  const model = findModel(spec);
  if (!model) return false;
  if (isModelExpired(model)) return false; // 过期模型视为不可用
  if (model.apiKeyOptional || model.local) return true;
  return (model.accounts ?? []).some((acc) => {
    const key = acc.apiKey || (acc.apiKeyEnv ? getEnv(acc.apiKeyEnv) : "");
    return Boolean(key);
  });
}

function pickUsableFreeModels(chain) {
  return pickFreeModels(chain).filter((spec) => modelHasKey(spec));
}

// ===== spec 解析 + 多账号轮询 =====
// spec 格式：provider:modelId[@accountId]
function parseSpec(spec) {
  if (!spec || typeof spec !== "string") return null;
  const colonIdx = spec.indexOf(":");
  if (colonIdx < 0) return null;
  const providerId = spec.slice(0, colonIdx);
  const rest = spec.slice(colonIdx + 1);
  const atIdx = rest.lastIndexOf("@");
  const modelId = atIdx >= 0 ? rest.slice(0, atIdx) : rest;
  const accountId = atIdx >= 0 ? rest.slice(atIdx + 1) : null;
  return { providerId, modelId, accountId };
}

function findModel(spec) {
  const parsed = parseSpec(spec);
  if (!parsed) return null;
  return models().find((m) => m.provider === parsed.providerId && m.id === parsed.modelId) || null;
}

// 账号轮询计数器：spec -> 下一个 account 索引
const accountCounters = new Map();
// 账号冷却：`spec|accountId` -> cooldownUntil timestamp
const accountCooldown = new Map();
const ACCOUNT_COOLDOWN_MS = 30_000;

function pickAccount(model, spec, requestedAccountId) {
  const accounts = model.accounts ?? [];
  if (!accounts.length) return null;
  if (requestedAccountId) {
    const found = accounts.find((acc) => acc.id === requestedAccountId);
    if (found) return found;
    throw new Error(`[env-config] 账号 ${requestedAccountId} 不存在于 ${spec}（可用：${accounts.map((a) => a.id).join(",")}）`);
  }
  // round-robin，跳过冷却中的账号
  const now = Date.now();
  const startIdx = accountCounters.get(spec) ?? 0;
  for (let offset = 0; offset < accounts.length; offset += 1) {
    const idx = (startIdx + offset) % accounts.length;
    const acc = accounts[idx];
    const cooldownKey = `${spec}|${acc.id}`;
    const cooldownUntil = accountCooldown.get(cooldownKey) ?? 0;
    if (now < cooldownUntil) continue;
    accountCounters.set(spec, (idx + 1) % accounts.length);
    return acc;
  }
  // 所有账号都在冷却 → 取冷却到期最早的
  let earliest = accounts[0];
  let earliestTime = Infinity;
  for (const acc of accounts) {
    const cooldownKey = `${spec}|${acc.id}`;
    const until = accountCooldown.get(cooldownKey) ?? 0;
    if (until < earliestTime) {
      earliestTime = until;
      earliest = acc;
    }
  }
  return earliest;
}

function resolveSpec(spec) {
  const parsed = parseSpec(spec);
  if (!parsed) throw new Error(`[env-config] 未知模型规格: ${spec}（格式: provider:modelId[@accountId]）`);
  const m = findModel(spec);
  if (!m) throw new Error(`[env-config] 未知模型规格: ${spec}`);
  // 过期硬闸：到期后禁止使用。标 availabilityFailure 让 router 自动降级到链上下一个模型，而不是整盘崩。
  if (isModelExpired(m)) {
    const until = new Date(m.expiresAt).toISOString().slice(0, 10);
    const err = new Error(`[env-config] 模型已过期停用 ${spec}（有效期至 ${until}），精修器禁止使用；如需续期改 .env 的 LLM_MODEL_<别名>_EXPIRES_AT`);
    err.availabilityFailure = true;
    err.expired = true;
    err.spec = spec;
    throw err;
  }
  const account = pickAccount(m, spec, parsed.accountId);
  if (!account) {
    throw new Error(`[env-config] ${spec} 无可用账号（请配置 apiKeyEnv 或 accounts）`);
  }
  const apiKey = account.apiKey
    || (account.apiKeyEnv ? getEnv(account.apiKeyEnv) : "")
    || (m.local || m.apiKeyOptional ? "local" : "");
  if (!apiKey && !m.apiKeyOptional) {
    throw new Error(
      `[env-config] 缺少 API key: 在 .env 里设置 ${account.apiKeyEnv}（对应 ${m.name} 账号 ${account.id}）`,
    );
  }
  return {
    ...m,
    apiKey,
    accountId: account.id,
    accountWeight: account.weight,
    modality: m.modality,
    maxContext: m.maxContext,
    maxOutputTokens: m.maxOutputTokens,
  };
}

function modelSupports(spec, capability) {
  const model = findModel(spec);
  if (!model) return false;
  return (model.modality ?? []).includes(capability);
}

function markAccountFailure(spec, accountId, durationMs = ACCOUNT_COOLDOWN_MS) {
  accountCooldown.set(`${spec}|${accountId}`, Date.now() + durationMs);
}

function markAccountSuccess(spec, accountId) {
  accountCooldown.delete(`${spec}|${accountId}`);
}

function accountCooldownSnapshot() {
  const now = Date.now();
  return [...accountCooldown.entries()]
    .filter(([, until]) => until > now)
    .map(([key, until]) => ({ key, remainingMs: until - now }));
}

function patchModel(spec, patch) {
  if (!spec || !patch || typeof patch !== "object") return null;
  const prior = runtimeModelPatches.get(spec) ?? {};
  const normalizedPatch = { ...prior, ...patch };
  if (patch.modality) normalizedPatch.capabilities = patch.modality;
  runtimeModelPatches.set(spec, normalizedPatch);
  const model = findModel(spec);
  if (model) {
    Object.assign(model, normalizedPatch);
    if (normalizedPatch.modality) model.capabilities = normalizedPatch.modality;
  }
  return model;
}

function setLocalLatency(spec, latencyMs) {
  const value = Number(latencyMs);
  if (!spec || !Number.isFinite(value) || value <= 0) return null;
  const prior = localLatencyMap.get(spec);
  const next = prior == null ? value : Math.round(prior * 0.7 + value * 0.3);
  localLatencyMap.set(spec, next);
  patchModel(spec, { localLatencyMs: next });
  return next;
}

function getLocalLatency(spec) {
  return localLatencyMap.get(spec) ?? findModel(spec)?.localLatencyMs ?? null;
}

function localLatencySnapshot() {
  return [...localLatencyMap.entries()].map(([spec, latencyMs]) => ({ spec, latencyMs }));
}

function reload() {
  _envCache = null;
  _modelsCache = null;
}

export const envConfig = {
  get MODELS() { return models(); },
  getEnv,
  listModels,
  listModelsByCapability,
  listModelsByTier,
  pickFreeModels,
  pickUsableFreeModels,
  modelHasKey,
  findModel,
  resolveSpec,
  modelSupports,
  isModelExpired,
  parseExpiry,
  parseSpec,
  markAccountFailure,
  markAccountSuccess,
  accountCooldownSnapshot,
  patchModel,
  setLocalLatency,
  getLocalLatency,
  localLatencySnapshot,
  reload,
};
