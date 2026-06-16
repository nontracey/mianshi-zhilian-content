// scripts/llm/pause-bus.mjs
// 全局暂停闸门。任何 worker 在调 LLM 前先 awaitResume(),触发 pause() 后所有调用阻塞,
// 直到 resume() 被调用为止。配合 quota.mjs 实现"额度耗尽全局暂停"。
//
// 单例:整个 Node 进程一个 bus,因为我们就是单进程主驱动 + 多并发 worker。

import { EventEmitter } from "node:events";

const STATE_RUNNING = "running";
const STATE_PAUSED = "paused";

class PauseBus extends EventEmitter {
  constructor() {
    super();
    this.state = STATE_RUNNING;
    this.reason = null;
    this.pausedAt = null;
    this.specsAffected = new Set();
    this.policy = "manual"; // manual | auto-probe | skip
    this._waiters = []; // 数组,resume 时全部 resolve
    this._probeTimer = null;
    this._probeAttempt = 0;
  }

  setPolicy(policy) {
    if (!["manual", "auto-probe", "skip"].includes(policy)) {
      throw new Error(`[pause-bus] 未知 policy: ${policy}`);
    }
    this.policy = policy;
    this.emit("policy", policy);
  }

  isPaused() {
    return this.state === STATE_PAUSED;
  }

  isRunning() {
    return this.state === STATE_RUNNING;
  }

  // worker 调 LLM 前 await 这个;running 立即 resolve,paused 时阻塞。
  async awaitResume() {
    if (this.state === STATE_RUNNING) return;
    return new Promise((resolve) => {
      this._waiters.push(resolve);
    });
  }

  // 触发暂停。reason: 人类可读串(显示用);spec: 引发暂停的 model spec
  pause({ reason, spec, error } = {}) {
    if (this.state === STATE_PAUSED) {
      // 已暂停时累积 spec
      if (spec) this.specsAffected.add(spec);
      this.emit("update", { reason: reason ?? this.reason, spec });
      return;
    }
    this.state = STATE_PAUSED;
    this.reason = reason || "未知原因";
    this.pausedAt = Date.now();
    if (spec) this.specsAffected.add(spec);
    this._probeAttempt = 0;
    this.emit("pause", { reason: this.reason, spec, error });
  }

  // 用户/探活成功后调 resume。
  resume({ source = "manual" } = {}) {
    if (this.state === STATE_RUNNING) return;
    const waiters = this._waiters;
    const reason = this.reason;
    const specs = Array.from(this.specsAffected);
    const pausedFor = Date.now() - (this.pausedAt || Date.now());
    this.state = STATE_RUNNING;
    this.reason = null;
    this.pausedAt = null;
    this.specsAffected = new Set();
    this._waiters = [];
    this._clearProbeTimer();
    this.emit("resume", { source, pausedFor, reason, specs });
    waiters.forEach((r) => r());
  }

  // 安排自动探活;由 router 在暂停时调用。
  scheduleAutoProbe({ envConfig, probeSpec, backoffMs }) {
    if (this.policy !== "auto-probe") return;
    if (this.state !== STATE_PAUSED) return;
    this._clearProbeTimer();
    const wait = backoffMs[Math.min(this._probeAttempt, backoffMs.length - 1)];
    this._probeAttempt += 1;
    this.emit("probe-scheduled", { attempt: this._probeAttempt, waitMs: wait });
    this._probeTimer = setTimeout(async () => {
      const specs = Array.from(this.specsAffected);
      if (specs.length === 0) return;
      // 尝试每个被影响的 spec
      for (const spec of specs) {
        this.emit("probe-start", { spec, attempt: this._probeAttempt });
        const r = await probeSpec(spec, { envConfig });
        this.emit("probe-result", { spec, attempt: this._probeAttempt, ...r });
        if (r.ok) {
          this.resume({ source: "auto-probe" });
          return;
        }
      }
      // 全部还没恢复,继续下一轮退避
      if (this.state === STATE_PAUSED) {
        this.scheduleAutoProbe({ envConfig, probeSpec, backoffMs });
      }
    }, wait);
    if (typeof this._probeTimer.unref === "function") this._probeTimer.unref();
  }

  _clearProbeTimer() {
    if (this._probeTimer) {
      clearTimeout(this._probeTimer);
      this._probeTimer = null;
    }
  }

  describe() {
    return {
      state: this.state,
      reason: this.reason,
      policy: this.policy,
      pausedAt: this.pausedAt,
      specs: Array.from(this.specsAffected),
      probeAttempt: this._probeAttempt,
    };
  }
}

export const pauseBus = new PauseBus();
