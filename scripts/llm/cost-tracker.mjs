// scripts/llm/cost-tracker.mjs
// 成本统计 + token 预算控制。
//
// v3.3 升级：
// - 内置当前默认链路与少量通用模型价格表
// - 多模态 token 估算（OpenAI vision 图像 tile 算法）
// - 本地模型不折钱但记 GPU 时间
// - summary() 按 spec/kind 汇总
// - 预算硬上限：maxTokensPerRun / maxCostPerRun / maxLocalGpuSeconds
// - 持久化支持（state.json 保存/恢复，由 quality_refine.mjs 调用）

import { envConfig } from "./env-config.mjs";
import { liveEvents } from "./live-events.mjs";

// 内置价格表（USD per 1M tokens）；未声明且查不到 → price=unknown
// 数据来源：各厂商官网公开定价（2026-06）
const BUILTIN_PRICES = {
  // 当前默认免费/限额在线链路
  "zhipu:glm-4.7-flash": { input: 0, output: 0 },
  "longcat:LongCat-2.0-Preview": { input: 0, output: 0 },
  // 阿里 DashScope
  "qwen-plus:qwen-plus": { input: 0.4, output: 1.2 },
  "qwen-max:qwen-max": { input: 2.5, output: 10 },
  // OpenAI
  "openai:gpt-4o": { input: 2.5, output: 10 },
  "openai:gpt-4.1": { input: 2.0, output: 8.0 },
  // Anthropic
  "anthropic:claude-sonnet-4-6": { input: 3.0, output: 15 },
  "anthropic:claude-opus-4-7": { input: 15, output: 75 },
  // Google
  "google:gemini-2.5-pro": { input: 1.25, output: 5.0 },
  "google:gemini-2.5-flash": { input: 0.15, output: 0.6 },
};

function lookupPrice(spec, model) {
  if (model?.pricePerMtok) return model.pricePerMtok;
  return BUILTIN_PRICES[spec] ?? null;
}

// OpenAI vision 图像 token 估算：tiles = ceil(w/512) * ceil(h/512)，每 tile 170 tokens + 85 base
function estimateImageTokens(dataUrl) {
  try {
    // 从 dataUrl 解析尺寸（仅 PNG/JPEG 头）
    if (typeof dataUrl !== "string") return 170;
    const base64 = dataUrl.split(",")[1] ?? "";
    if (!base64) return 170;
    // PNG: bytes 16-24 是 width/height（big-endian）
    if (dataUrl.startsWith("data:image/png")) {
      const buf = Buffer.from(base64, "base64");
      if (buf.length >= 24) {
        const w = buf.readUInt32BE(16);
        const h = buf.readUInt32BE(20);
        if (w > 0 && h > 0) {
          const tiles = Math.max(1, Math.ceil(w / 512)) * Math.max(1, Math.ceil(h / 512));
          return tiles * 170 + 85;
        }
      }
    }
    // JPEG: 解析 SOF0 (0xFFC0) 段
    if (dataUrl.startsWith("data:image/jpeg")) {
      const buf = Buffer.from(base64, "base64");
      let i = 2; // skip SOI
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i += 1; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xC0 && marker <= 0xC3) {
          const h = buf.readUInt16BE(i + 5);
          const w = buf.readUInt16BE(i + 7);
          if (w > 0 && h > 0) {
            const tiles = Math.max(1, Math.ceil(w / 512)) * Math.max(1, Math.ceil(h / 512));
            return tiles * 170 + 85;
          }
        }
        const len = buf.readUInt16BE(i + 2);
        i += 2 + len;
      }
    }
  } catch {}
  // SVG / 其他：按 detail=high 估算 765 tokens（OpenAI 对 SVG/未知图像的默认）
  return 765;
}

class CostTracker {
  constructor() {
    this.records = []; // 全部调用记录
    this.budget = {
      maxTokensPerRun: null,
      maxCostPerRun: null,
      maxLocalGpuSeconds: null,
    };
    this.exceeded = false;
    this.exceededReason = null;
  }

  setBudget({ maxTokensPerRun, maxCostPerRun, maxLocalGpuSeconds } = {}) {
    if (maxTokensPerRun != null) this.budget.maxTokensPerRun = Number(maxTokensPerRun);
    if (maxCostPerRun != null) this.budget.maxCostPerRun = Number(maxCostPerRun);
    if (maxLocalGpuSeconds != null) this.budget.maxLocalGpuSeconds = Number(maxLocalGpuSeconds);
  }

  record({ spec, accountId, kind, inputTokens = 0, outputTokens = 0, durationMs = 0, tier, images = 0, imageTokens = 0 }) {
    const model = envConfig.findModel(spec);
    const finalTier = tier ?? model?.tier ?? "paid";
    const isLocal = finalTier === "local";
    // 多模态 token 加到 input
    const totalInput = (inputTokens || 0) + (imageTokens || 0);
    const price = lookupPrice(spec, model);
    let cost = 0;
    if (!isLocal && price) {
      cost = (totalInput / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
    }
    const entry = {
      at: Date.now(),
      spec,
      accountId,
      kind,
      inputTokens: totalInput,
      outputTokens,
      imageTokens: imageTokens || 0,
      durationMs,
      tier: finalTier,
      cost,
      priceKnown: Boolean(price) || !isLocal,
      isLocal,
    };
    this.records.push(entry);
    this.checkBudget();
    try {
      const sum = this.summary();
      const budgetPct = this.budget.maxCostPerRun
        ? (sum.cost.totalUsd / this.budget.maxCostPerRun) * 100
        : this.budget.maxTokensPerRun
          ? (sum.tokens.total / this.budget.maxTokensPerRun) * 100
          : null;
      liveEvents.emitEvent("cost.tick", {
        totalUsd: sum.cost.totalUsd,
        tokens: sum.tokens,
        budgetPct,
        exceeded: this.exceeded,
        reason: this.exceededReason,
      });
    } catch {}
    return entry;
  }

  checkBudget() {
    const totals = this.summary();
    if (this.budget.maxTokensPerRun && totals.tokens.total > this.budget.maxTokensPerRun) {
      this.exceeded = true;
      this.exceededReason = `token ${totals.tokens.total} > 上限 ${this.budget.maxTokensPerRun}`;
      return true;
    }
    if (this.budget.maxCostPerRun && totals.cost.totalUsd > this.budget.maxCostPerRun) {
      this.exceeded = true;
      this.exceededReason = `cost $${totals.cost.totalUsd.toFixed(4)} > 上限 $${this.budget.maxCostPerRun}`;
      return true;
    }
    if (this.budget.maxLocalGpuSeconds && totals.cost.localGpuSeconds > this.budget.maxLocalGpuSeconds) {
      this.exceeded = true;
      this.exceededReason = `local GPU ${totals.cost.localGpuSeconds}s > 上限 ${this.budget.maxLocalGpuSeconds}s`;
      return true;
    }
    return false;
  }

  summary() {
    const bySpec = new Map();
    let totalInput = 0, totalOutput = 0, totalCost = 0, totalLocalGpuMs = 0;
    for (const r of this.records) {
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      totalCost += r.cost;
      if (r.isLocal) totalLocalGpuMs += r.durationMs;
      const key = r.spec;
      if (!bySpec.has(key)) bySpec.set(key, { spec: key, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 0, isLocal: r.isLocal, byKind: {} });
      const agg = bySpec.get(key);
      agg.calls += 1;
      agg.inputTokens += r.inputTokens;
      agg.outputTokens += r.outputTokens;
      agg.cost += r.cost;
      agg.durationMs += r.durationMs;
      const kind = r.kind || "unknown";
      agg.byKind[kind] = (agg.byKind[kind] ?? 0) + 1;
    }
    return {
      cost: {
        totalUsd: Number(totalCost.toFixed(6)),
        localGpuSeconds: Math.round(totalLocalGpuMs / 1000),
        bySpec: [...bySpec.values()].map((v) => ({
          ...v,
          cost: Number(v.cost.toFixed(6)),
          avgLatencyMs: v.calls ? Math.round(v.durationMs / v.calls) : 0,
        })),
      },
      tokens: {
        input: totalInput,
        output: totalOutput,
        total: totalInput + totalOutput,
      },
      calls: this.records.length,
      exceeded: this.exceeded,
      exceededReason: this.exceededReason,
    };
  }

  // 持久化（state.json）
  serialize() {
    return { records: this.records, budget: this.budget, exceeded: this.exceeded, exceededReason: this.exceededReason };
  }

  restore(data) {
    if (!data || !Array.isArray(data.records)) return;
    this.records = data.records;
    if (data.budget) this.budget = { ...this.budget, ...data.budget };
    this.exceeded = Boolean(data.exceeded);
    this.exceededReason = data.exceededReason ?? null;
  }

  reset() {
    this.records = [];
    this.exceeded = false;
    this.exceededReason = null;
  }
}

export const costTracker = new CostTracker();
export { CostTracker, estimateImageTokens, BUILTIN_PRICES, lookupPrice };
