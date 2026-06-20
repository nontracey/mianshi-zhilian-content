// scripts/llm/router.mjs（v3）
// 模型链 + 可用性窗口 + 自动降级 + 配额暂停闸。
//
// 关键改动:
//   ① 配额错误(QuotaError):不在链内降级,触发 pauseBus.pause(),阻塞所有 worker;
//      用户(或自动探活)resume 后,本次调用重跑(同一 spec)。
//   ② 可用性错误:仍走原降级逻辑(连续 N 次失败 → 切下一个 spec)。
//   ③ 全链耗尽(可用性):抛 ChainExhausted,本篇标记失败,不暂停整盘。
//   ④ skip 策略下:用户标记 skip 时,QuotaError 被回传给上层,worker 丢弃当前 topic。

import { openaiRunner } from "./openai-runner.mjs";
import { envConfig } from "./env-config.mjs";
import { pauseBus } from "./pause-bus.mjs";
import { QuotaError, probeSpec } from "./quota.mjs";
import { liveEvents } from "./live-events.mjs";
import { modelPool } from "./model-pool.mjs";

const AVAILABILITY_WINDOW_MS = 10 * 60 * 1000;
const DEGRADE_AFTER_DEFAULT = 3;

function parseChain(spec) {
  if (!spec) return [];
  if (Array.isArray(spec)) return spec.filter(Boolean);
  return String(spec)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function defaultChain() {
  return ["zhipu:glm-4.7-flash", "longcat:LongCat-2.0-Preview"];
}

function parseBackoffs() {
  const raw = envConfig.getEnv("QUOTA_PROBE_BACKOFF_MS", "60000,120000,300000,600000");
  return String(raw)
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export class ChainExhaustedError extends Error {
  constructor(message, lastErr) {
    super(message);
    this.name = "ChainExhaustedError";
    this.cause = lastErr;
  }
}

export class QuotaSkipped extends Error {
  constructor(spec) {
    super(`[router] 用户选择 skip,跳过本次调用 spec=${spec}`);
    this.name = "QuotaSkipped";
    this.quotaSkipped = true;
    this.spec = spec;
  }
}

export function createRouter(opts = {}) {
  const {
    specs,
    envKey,
    fallback = defaultChain(),
    degradeAfter = Number(envConfig.getEnv("LLM_DEGRADE_AFTER", DEGRADE_AFTER_DEFAULT)) || DEGRADE_AFTER_DEFAULT,
    onDegrade,
    onExhaust,
    label = "router",
  } = opts;

  const fromEnv = envKey ? parseChain(envConfig.getEnv(envKey)) : [];
  const chain = parseChain(specs).length ? parseChain(specs) : (fromEnv.length ? fromEnv : fallback);

  const failureTimestamps = new Map();

  function noteFailure(spec) {
    const now = Date.now();
    const arr = (failureTimestamps.get(spec) || []).filter((t) => now - t < AVAILABILITY_WINDOW_MS);
    arr.push(now);
    failureTimestamps.set(spec, arr);
    return arr.length;
  }

  function pruneWindow(spec) {
    const now = Date.now();
    const arr = (failureTimestamps.get(spec) || []).filter((t) => now - t < AVAILABILITY_WINDOW_MS);
    failureTimestamps.set(spec, arr);
    return arr.length;
  }

  function orderedChainForRun() {
    // 过期模型直接从活动链里剔除（到期即自动"移除"，无需手动改链）。
    // 若整条链都过期则保留原链，让 resolveSpec 抛清晰的"已过期"错，而不是误报"链为空"。
    const live = chain.filter((spec) => {
      const m = envConfig.findModel(spec);
      return !(m && envConfig.isModelExpired(m));
    });
    const base = live.length ? live : chain;
    return [...base].sort((a, b) => {
      const ma = envConfig.findModel(a);
      const mb = envConfig.findModel(b);
      if (ma?.local && mb?.local) {
        const la = envConfig.getLocalLatency(a) ?? Infinity;
        const lb = envConfig.getLocalLatency(b) ?? Infinity;
        if (la !== lb) return la - lb;
      }
      return 0;
    });
  }

  function shouldDegrade(currentIdx, activeChain) {
    if (currentIdx >= activeChain.length - 1) return false;
    const spec = activeChain[currentIdx];
    return pruneWindow(spec) >= degradeAfter;
  }

  async function handleQuotaPause(err) {
    pauseBus.pause({
      reason: `额度耗尽: ${err.spec} (HTTP ${err.status || "?"})`,
      spec: err.spec,
      error: err,
    });
    liveEvents.emitEvent("llm.pause", {
      spec: err.spec,
      reason: err.message,
      status: err.status,
      policy: pauseBus.policy,
    });
    if (pauseBus.policy === "auto-probe") {
      pauseBus.scheduleAutoProbe({
        envConfig,
        probeSpec: (s, opt) => probeSpec(s, { ...opt, envConfig }),
        backoffMs: parseBackoffs(),
      });
    }
    if (pauseBus.policy === "skip") {
      pauseBus.resume({ source: "skip" });
      throw new QuotaSkipped(err.spec);
    }
    await pauseBus.awaitResume();
    liveEvents.emitEvent("llm.resume", { spec: err.spec });
  }

  async function run(req) {
    if (chain.length === 0) {
      throw new Error("[router] 模型链为空,设置 REFINE_MODEL_CHAIN 或 JUDGE_MODEL_CHAIN");
    }
    let lastErr = null;
    let currentIdx = 0;

    const activeChain = orderedChainForRun();
    while (currentIdx < activeChain.length) {
      await pauseBus.awaitResume();

      const spec = activeChain[currentIdx];
      if (currentIdx === 0 && shouldDegrade(currentIdx, activeChain)) {
        failureTimestamps.set(spec, []);
        const next = activeChain[currentIdx + 1];
        onDegrade?.(spec, next);
        liveEvents.emitEvent("llm.degrade", { from: spec, to: next, reason: "window-exceeded" });
        currentIdx += 1;
        continue;
      }

      try {
        return await modelPool.run({ spec, kind: req.kind || label }, () => openaiRunner.run({ ...req, spec }));
      } catch (err) {
        if (err instanceof QuotaError || err.quotaFailure) {
          await handleQuotaPause(err);
          continue;
        }

        if (err.availabilityFailure || err.truncated) {
          lastErr = err;
          if (err.availabilityFailure) {
            noteFailure(spec);
          }
          if (currentIdx >= activeChain.length - 1) {
            onExhaust?.(err);
            throw new ChainExhaustedError(`[router] 模型链全部不可用 last=${spec} ${err.message}`, err);
          }
          const next = activeChain[currentIdx + 1];
          liveEvents.emitEvent("llm.degrade", { from: spec, to: next, reason: err.availabilityFailure ? "availability" : "truncated" });
          currentIdx += 1;
          continue;
        }

        throw err;
      }
    }
    throw new ChainExhaustedError("[router] 模型链耗尽,无可用模型", lastErr);
  }

  return {
    run,
    current: () => chain[0],
    chain: () => chain.slice(),
    label,
  };
}
