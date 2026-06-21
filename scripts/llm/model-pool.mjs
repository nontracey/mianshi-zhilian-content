// scripts/llm/model-pool.mjs
// 所有 LLM 调用的资源治理层。
//
// v3.3 升级：
// - 五层限流保留：global / kind / provider / account / model
// - account 队列 key 用 resolveSpec 返回的 accountId（多账号轮询）
// - autoScale.enabled=true 的模型用 AutoScalingSemaphore 替代固定信号量
// - 本地模型延迟优先：同 chain 多 local 模型时记 latency 选最快
// - 模型级 unhealthy 标记：连续超时 → 60s 隔离
// - 调用 fn 后 recordSuccess/recordError 喂给 autoscale
// - 账号失败（429/401）→ envConfig.markAccountFailure 触发冷却

import { envConfig } from "./env-config.mjs";
import { TaskQueue, AutoScalingSemaphore } from "./task-queue.mjs";
import { liveEvents } from "./live-events.mjs";

function num(key, fallback) {
  const raw = envConfig.getEnv(key);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitize(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function queueLimitFor({ spec, model, kind }) {
  const providerKey = sanitize(model.provider);
  const modelKey = sanitize(`${model.provider}_${model.id}`);
  const accountKey = sanitize(model.accountId || "default");
  const kindKey = sanitize(kind || "default");
  return {
    global: num("LLM_POOL_GLOBAL_CONCURRENCY", 28),
    kind: num(`LLM_POOL_KIND_${kindKey}`, model.kindConcurrency?.[kind] ?? 8),
    provider: num(`LLM_POOL_PROVIDER_${providerKey}`, model.providerConcurrency ?? model.maxProviderConcurrency ?? 8),
    account: num(`LLM_POOL_ACCOUNT_${accountKey}`, model.accountConcurrency ?? model.maxAccountConcurrency ?? 8),
    model: num(`LLM_POOL_MODEL_${modelKey}`, model.modelConcurrency ?? model.maxConcurrency ?? (model.local ? 1 : 8)),
    spec,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 通用 QPS 限流：每个声明了 qps 的模型一个令牌桶，限制每秒起始速率。未声明 qps 的模型不受影响。
class RateLimiter {
  constructor(qps) {
    this.qps = Math.max(0.001, Number(qps) || 1);
    this.tokens = this.qps;
    this.last = Date.now();
  }
  setQps(qps) {
    const next = Math.max(0.001, Number(qps) || this.qps);
    if (next !== this.qps) { this.qps = next; this.tokens = Math.min(this.tokens, next); }
  }
  async acquire() {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.qps, this.tokens + ((now - this.last) / 1000) * this.qps);
      this.last = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await sleep(Math.ceil(((1 - this.tokens) / this.qps) * 1000));
    }
  }
}
const rateLimiters = new Map(); // spec -> RateLimiter
function rateLimiterFor(spec, model) {
  if (!model.qps || model.qps <= 0) return null;
  let rl = rateLimiters.get(spec);
  if (!rl) { rl = new RateLimiter(model.qps); rateLimiters.set(spec, rl); }
  else rl.setQps(model.qps);
  return rl;
}

// 模型级 unhealthy 标记（连续 3 次超时 → 60s 隔离）
const modelUnhealthy = new Map(); // spec -> {until, consecutive}
const MODEL_UNHEALTHY_THRESHOLD = 3;
const MODEL_UNHEALTHY_DURATION_MS = 60_000;

function checkModelHealthy(spec) {
  const entry = modelUnhealthy.get(spec);
  if (!entry) return true;
  if (Date.now() < entry.until) return false;
  modelUnhealthy.delete(spec);
  return true;
}

function recordModelFailure(spec, kind) {
  const now = Date.now();
  const entry = modelUnhealthy.get(spec) ?? { until: 0, consecutive: 0 };
  entry.consecutive += 1;
  if (entry.consecutive >= MODEL_UNHEALTHY_THRESHOLD) {
    entry.until = now + MODEL_UNHEALTHY_DURATION_MS;
    liveEvents.emitEvent("llm.pool.unhealthy", { spec, kind, until: entry.until });
  }
  modelUnhealthy.set(spec, entry);
}

function recordModelSuccess(spec) {
  modelUnhealthy.delete(spec);
}

function modelHealthSnapshot() {
  const now = Date.now();
  return [...modelUnhealthy.entries()]
    .filter(([, entry]) => now < entry.until)
    .map(([spec, entry]) => ({ spec, remainingMs: entry.until - now, consecutive: entry.consecutive }));
}

class ModelPool {
  constructor() {
    this.queues = new Map(); // key -> TaskQueue | AutoScalingSemaphore
    this.pendingSnapshots = new Map(); // key -> snapshot restored before queue creation
  }

  // 取或创建队列。limit 可随 autoscale 动态调整。
  queue(key, limit, { autoScale = null } = {}) {
    const stableKey = String(key);
    let entry = this.queues.get(stableKey);
    if (!entry) {
      if (autoScale && autoScale.enabled) {
        const sem = new AutoScalingSemaphore({
          min: autoScale.min,
          max: Math.max(autoScale.min, autoScale.max),
          targetLatencyMs: autoScale.targetLatencyMs,
          errorBackoffMs: autoScale.errorBackoffMs,
          label: stableKey,
        });
        entry = { kind: "autoscale", sem };
      } else {
        entry = { kind: "fixed", sem: new TaskQueue({ concurrency: limit, label: stableKey }).semaphore };
      }
      this.queues.set(stableKey, entry);
      const restored = this.pendingSnapshots.get(stableKey);
      if (restored?.limit && entry.sem?.setLimit) {
        entry.sem.setLimit(restored.limit);
        this.pendingSnapshots.delete(stableKey);
      }
    } else if (entry.kind === "fixed") {
      entry.sem.setLimit(limit);
    } else if (entry.kind === "autoscale" && autoScale) {
      entry.sem.setBounds({
        min: autoScale.min,
        max: Math.max(autoScale.min, autoScale.max),
        targetLatencyMs: autoScale.targetLatencyMs,
        errorBackoffMs: autoScale.errorBackoffMs,
      });
    }
    return entry;
  }

  async run({ spec, kind = "llm" }, fn) {
    if (!checkModelHealthy(spec)) {
      const err = new Error(`[model-pool] ${spec} 当前被隔离（连续超时，稍后重试）`);
      err.modelUnhealthy = true;
      err.spec = spec;
      throw err;
    }
    const model = envConfig.resolveSpec(spec);
    // 通用 QPS 闸：在抢并发槽之前等令牌，避免限速等待时白占并发额度。未声明 qps 的模型直接放行。
    const rl = rateLimiterFor(spec, model);
    if (rl) await rl.acquire();
    const limits = queueLimitFor({ spec, model, kind });
    const queueKeys = [
      { key: "global", limit: limits.global, autoScale: null },
      { key: `kind:${kind}`, limit: limits.kind, autoScale: null },
      { key: `provider:${model.provider}`, limit: limits.provider, autoScale: null },
      { key: `account:${model.accountId || model.provider}`, limit: limits.account, autoScale: null },
      { key: `model:${spec}`, limit: limits.model, autoScale: model.autoScale },
    ];
    const entries = queueKeys.map((q) => ({ ...q, entry: this.queue(q.key, q.limit, { autoScale: q.autoScale }) }));
    const releases = [];
    const startedWait = Date.now();
    try {
      for (const { entry } of entries) releases.push(await entry.sem.acquire());
      const waitedMs = Date.now() - startedWait;
      if (waitedMs > 250) {
        liveEvents.emitEvent("llm.pool.wait", { spec, kind, waitedMs, limits, accountId: model.accountId });
      }
      liveEvents.emitEvent("llm.pool.start", { spec, kind, limits, accountId: model.accountId });
      const callStart = Date.now();
      try {
        const result = await fn(model);
        const durationMs = Date.now() - callStart;
        // 喂给 autoscale（仅 model 队列用 AutoScalingSemaphore）
        const modelEntry = entries[entries.length - 1];
        if (modelEntry.entry.kind === "autoscale") {
          modelEntry.entry.sem.recordSuccess(durationMs);
        }
        recordModelSuccess(spec);
        envConfig.markAccountSuccess(spec, model.accountId);
        if (model.local) envConfig.setLocalLatency(spec, durationMs);
        liveEvents.emitEvent("llm.pool.done", { spec, kind, durationMs, accountId: model.accountId, ok: true });
        return result;
      } catch (err) {
        const durationMs = Date.now() - callStart;
        const isQuota = err instanceof Error && (err.quotaFailure || err.status === 429);
        const isTimeout = err instanceof Error && (err.code === "ETIMEDOUT" || err.code === "UND_ERR_CONNECT_TIMEOUT" || /timeout/i.test(err.message || ""));
        const isAuth = err instanceof Error && (err.status === 401 || err.status === 403);
        // 喂给 autoscale：quota/timeout 视为可缩容信号
        const modelEntry = entries[entries.length - 1];
        if (modelEntry.entry.kind === "autoscale") {
          if (isQuota || isTimeout) modelEntry.entry.sem.recordError(isQuota ? "quota" : "timeout");
        }
        // 账号故障隔离
        if (isQuota || isAuth) {
          envConfig.markAccountFailure(spec, model.accountId);
        }
        // 模型连续失败隔离
        if (isTimeout) {
          recordModelFailure(spec, kind);
        } else if (!isQuota && !isAuth) {
          // 其他失败也算一次（但阈值更高才隔离）
          recordModelFailure(spec, kind);
        } else {
          recordModelSuccess(spec);
        }
        liveEvents.emitEvent("llm.pool.done", { spec, kind, durationMs, accountId: model.accountId, ok: false, error: err.message });
        throw err;
      }
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  snapshot() {
    return [...this.queues.entries()].map(([key, entry]) => ({
      key,
      ...entry.sem.snapshot(),
      queueKind: entry.kind,
    }));
  }

  healthSnapshot() {
    return {
      unhealthyModels: modelHealthSnapshot(),
      accountCooldowns: envConfig.accountCooldownSnapshot(),
      localLatencies: envConfig.localLatencySnapshot(),
    };
  }

  restoreSnapshot(snapshots = []) {
    let count = 0;
    for (const snap of snapshots) {
      if (!snap?.key || !snap.limit) continue;
      const entry = this.queues.get(snap.key);
      if (entry?.sem?.setLimit) entry.sem.setLimit(snap.limit);
      else this.pendingSnapshots.set(snap.key, snap);
      count += 1;
    }
    return count;
  }
}

export const modelPool = new ModelPool();
export { ModelPool };
