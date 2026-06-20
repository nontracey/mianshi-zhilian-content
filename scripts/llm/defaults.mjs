// scripts/llm/defaults.mjs
// 精修 / 审判 / 块级审判的默认采样参数,针对"内容改写"和"评分判断"两种任务优化。
// 默认值可被 .env 覆盖(REFINE_TEMPERATURE / JUDGE_TEMPERATURE 等)。

import { envConfig } from "./env-config.mjs";

function num(key, fallback) {
  const v = envConfig.getEnv(key);
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(key, fallback) {
  const v = envConfig.getEnv(key);
  return v == null || v === "" ? fallback : v;
}

// 精修场景:温度低(0.3)→ 稳定、不胡说;top_p 0.9 → 保留一定创造性;max_tokens 16384 → 撑大长 topic
// 改写是"在原 topic 基础上补充深问+专家证据",给足 token 才能一次写完
export const REFINE_DEFAULTS = {
  temperature: num("REFINE_TEMPERATURE", 0.3),
  top_p: num("REFINE_TOP_P", 0.9),
  max_tokens: num("REFINE_MAX_TOKENS", 16384),
  timeoutMs: num("REFINE_TIMEOUT_MS", 120000),
  retry: num("REFINE_RETRY", 3),
  modelChain: str("REFINE_MODEL_CHAIN", ""),
};

// 评审场景:温度极低(0.1)→ 评分稳定;top_p 0.9;max_tokens 8192 → 评审 JSON 不会撑到 16k
export const JUDGE_DEFAULTS = {
  temperature: num("JUDGE_TEMPERATURE", 0.1),
  top_p: num("JUDGE_TOP_P", 0.9),
  max_tokens: num("JUDGE_MAX_TOKENS", 8192),
  timeoutMs: num("JUDGE_TIMEOUT_MS", 120000),
  retry: num("JUDGE_RETRY", 3),
  modelChain: str("JUDGE_MODEL_CHAIN", ""),
};

// 块级评审:评审单个 block,JSON 更小
export const BLOCK_JUDGE_DEFAULTS = {
  temperature: num("BLOCK_JUDGE_TEMPERATURE", 0.1),
  top_p: num("BLOCK_JUDGE_TOP_P", 0.9),
  max_tokens: num("BLOCK_JUDGE_MAX_TOKENS", 4096),
  timeoutMs: num("BLOCK_JUDGE_TIMEOUT_MS", 60000),
  retry: num("BLOCK_JUDGE_RETRY", 2),
};

export const VISION_JUDGE_DEFAULTS = {
  temperature: num("VISION_JUDGE_TEMPERATURE", 0.1),
  top_p: num("VISION_JUDGE_TOP_P", 0.9),
  max_tokens: num("VISION_JUDGE_MAX_TOKENS", 4096),
  timeoutMs: num("VISION_JUDGE_TIMEOUT_MS", 120000),
  retry: num("VISION_JUDGE_RETRY", 2),
  modelChain: str("VISION_JUDGE_MODEL_CHAIN", ""),
};

// 图候选生成：用于视觉判官 fail 后重生 N 候选图。
// 优先用 free tier 模型（DIAGRAM_CANDIDATE_ALLOW_PAID=false 时强制 free）。
export const DIAGRAM_GENERATE_DEFAULTS = {
  temperature: num("DIAGRAM_GENERATE_TEMPERATURE", 0.4),
  top_p: num("DIAGRAM_GENERATE_TOP_P", 0.9),
  max_tokens: num("DIAGRAM_GENERATE_MAX_TOKENS", 8192),
  timeoutMs: num("DIAGRAM_GENERATE_TIMEOUT_MS", 120000),
  retry: num("DIAGRAM_GENERATE_RETRY", 2),
  modelChain: str("DIAGRAM_CANDIDATE_MODEL_CHAIN", ""),
};

export const DEFAULTS = {
  refine: REFINE_DEFAULTS,
  judge: JUDGE_DEFAULTS,
  block_judge: BLOCK_JUDGE_DEFAULTS,
  vision_judge: VISION_JUDGE_DEFAULTS,
  diagram_generate: DIAGRAM_GENERATE_DEFAULTS,
};
