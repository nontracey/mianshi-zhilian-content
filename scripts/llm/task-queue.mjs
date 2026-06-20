// scripts/llm/task-queue.mjs
// 小型异步队列/信号量原语，供模型池和 MCP 工具使用。
// v3.3 新增 AutoScalingSemaphore：根据近 N 次请求的 latency + 错误率动态调整 limit
// （仅 tier=free 模型默认开启，避免本地 GPU / 付费 API 被打爆）。

export class AsyncSemaphore {
  constructor(limit, label = "semaphore") {
    this.limit = Math.max(1, Number(limit) || 1);
    this.label = label;
    this.active = 0;
    this.waiters = [];
  }

  setLimit(limit) {
    this.limit = Math.max(1, Number(limit) || 1);
    this.#drain();
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this.#drain();
  }

  #drain() {
    while (this.active < this.limit && this.waiters.length) {
      const resolve = this.waiters.shift();
      this.active += 1;
      resolve(() => this.release());
    }
  }

  snapshot() {
    return {
      label: this.label,
      limit: this.limit,
      active: this.active,
      queued: this.waiters.length,
    };
  }
}

export class TaskQueue {
  constructor({ concurrency = 1, label = "queue" } = {}) {
    this.semaphore = new AsyncSemaphore(concurrency, label);
    this.label = label;
  }

  async run(fn) {
    const release = await this.semaphore.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  snapshot() {
    return this.semaphore.snapshot();
  }
}

// 自适应信号量：根据成功/失败率动态调整并发上限。
// 触发扩容：连续 SUCCESS_FOR_GROW 次成功 且 avg latency < targetLatencyMs → limit+1（不超过 max）
// 触发缩容：连续 ERROR_FOR_SHRINK 次 429/timeout → limit-1（不低于 min）+ errorBackoffMs 退避
export class AutoScalingSemaphore extends AsyncSemaphore {
  constructor({ min = 1, max = 8, targetLatencyMs = 5000, errorBackoffMs = 30000, label = "autoscale" } = {}) {
    super(min, label);
    this.min = Math.max(1, Number(min) || 1);
    this.max = Math.max(this.min, Number(max) || this.min);
    this.targetLatencyMs = Number(targetLatencyMs) || 5000;
    this.errorBackoffMs = Number(errorBackoffMs) || 30000;
    this.recentLatencies = []; // 滑动窗口（最近 10 次）
    this.consecutiveSuccess = 0;
    this.consecutiveErrors = 0;
    this.cooldownUntil = 0;
    this.adjustmentHistory = []; // [{at, from, to, reason}]
  }

  setBounds({ min, max, targetLatencyMs, errorBackoffMs }) {
    if (min != null) this.min = Math.max(1, Number(min) || 1);
    if (max != null) this.max = Math.max(this.min, Number(max) || this.min);
    if (targetLatencyMs != null) this.targetLatencyMs = Number(targetLatencyMs) || this.targetLatencyMs;
    if (errorBackoffMs != null) this.errorBackoffMs = Number(errorBackoffMs) || this.errorBackoffMs;
    if (this.limit < this.min) this.setLimit(this.min);
    if (this.limit > this.max) this.setLimit(this.max);
  }

  recordSuccess(latencyMs) {
    const latency = Number(latencyMs) || 0;
    this.recentLatencies.push(latency);
    if (this.recentLatencies.length > 10) this.recentLatencies.shift();
    this.consecutiveSuccess += 1;
    this.consecutiveErrors = 0;
    if (this.consecutiveSuccess >= 3 && this.limit < this.max) {
      const avg = this.recentLatencies.reduce((a, b) => a + b, 0) / this.recentLatencies.length;
      if (avg < this.targetLatencyMs) {
        const before = this.limit;
        this.setLimit(Math.min(this.max, this.limit + 1));
        this.consecutiveSuccess = 0;
        this.adjustmentHistory.push({ at: Date.now(), from: before, to: this.limit, reason: `avg latency ${Math.round(avg)}ms < target` });
      }
    }
  }

  recordError(type = "unknown") {
    this.consecutiveErrors += 1;
    this.consecutiveSuccess = 0;
    if (this.consecutiveErrors >= 2 && this.limit > this.min) {
      const before = this.limit;
      this.setLimit(Math.max(this.min, this.limit - 1));
      this.cooldownUntil = Date.now() + this.errorBackoffMs;
      this.adjustmentHistory.push({ at: Date.now(), from: before, to: this.limit, reason: `${type} ×${this.consecutiveErrors}` });
      this.consecutiveErrors = 0;
    }
  }

  snapshot() {
    const avgLatency = this.recentLatencies.length
      ? Math.round(this.recentLatencies.reduce((a, b) => a + b, 0) / this.recentLatencies.length)
      : null;
    return {
      ...super.snapshot(),
      kind: "autoscale",
      min: this.min,
      max: this.max,
      avgLatencyMs: avgLatency,
      consecutiveSuccess: this.consecutiveSuccess,
      consecutiveErrors: this.consecutiveErrors,
      cooldownUntil: this.cooldownUntil > Date.now() ? this.cooldownUntil : 0,
      history: this.adjustmentHistory.slice(-5),
    };
  }
}
