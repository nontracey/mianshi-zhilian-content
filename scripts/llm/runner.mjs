// scripts/llm/runner.mjs
// 统一 LLM 入口:对外暴露 runRefine / runJudge / runBlockJudge 三个高阶调用。
// 内部用 router + openai-runner,自动应用默认采样参数 + 模型链 + 降级。
// 任何"想调 LLM"的地方都走这个文件,不在 refine / judge / packet 里重复实现可用性窗口。

import { openaiRunner } from "./openai-runner.mjs";
import { createRouter } from "./router.mjs";
import { REFINE_DEFAULTS, JUDGE_DEFAULTS, BLOCK_JUDGE_DEFAULTS, VISION_JUDGE_DEFAULTS, DIAGRAM_GENERATE_DEFAULTS } from "./defaults.mjs";

/**
 * @typedef {Object} RunRequest
 * @property {string} systemPrompt
 * @property {string} userPrompt
 * @property {object} [schema] - JSON schema (response_format=json_schema)
 * @property {object} [sampling] - 覆盖默认采样参数 { temperature, top_p, max_tokens }
 * @property {number} [timeoutMs]
 * @property {number} [retry]
 * @property {(e: any) => void} [onProgress]
 * @property {AbortSignal} [signal]
 * @property {string[]} [modelChain] - 覆盖默认模型链
 */

function buildRouter(defaults, envKey, overrideChain) {
  if (overrideChain && overrideChain.length) {
    return createRouter({ specs: overrideChain });
  }
  if (defaults.modelChain) {
    return createRouter({ specs: defaults.modelChain });
  }
  return createRouter({ envKey, fallback: ["zhipu:glm-4.7-flash", "longcat:LongCat-2.0-Preview"] });
}

function mergeSampling(defaults, override) {
  const out = {
    temperature: defaults.temperature,
    top_p: defaults.top_p,
    max_tokens: defaults.max_tokens,
  };
  if (override) Object.assign(out, override);
  return out;
}

/** 精修调用 */
export async function runRefine(req) {
  const router = buildRouter(REFINE_DEFAULTS, "REFINE_MODEL_CHAIN", req.modelChain);
  return router.run({
    ...req,
    kind: "refine",
    timeoutMs: req.timeoutMs ?? REFINE_DEFAULTS.timeoutMs,
    retry: req.retry ?? REFINE_DEFAULTS.retry,
    sampling: mergeSampling(REFINE_DEFAULTS, req.sampling),
  });
}

/** 整篇评审 */
export async function runJudge(req) {
  const router = buildRouter(JUDGE_DEFAULTS, "JUDGE_MODEL_CHAIN", req.modelChain);
  return router.run({
    ...req,
    kind: "judge",
    timeoutMs: req.timeoutMs ?? JUDGE_DEFAULTS.timeoutMs,
    retry: req.retry ?? JUDGE_DEFAULTS.retry,
    sampling: mergeSampling(JUDGE_DEFAULTS, req.sampling),
  });
}

/** 块级评审 */
export async function runBlockJudge(req) {
  const router = buildRouter(BLOCK_JUDGE_DEFAULTS, "BLOCK_JUDGE_MODEL_CHAIN", req.modelChain);
  return router.run({
    ...req,
    kind: "block_judge",
    timeoutMs: req.timeoutMs ?? BLOCK_JUDGE_DEFAULTS.timeoutMs,
    retry: req.retry ?? BLOCK_JUDGE_DEFAULTS.retry,
    sampling: mergeSampling(BLOCK_JUDGE_DEFAULTS, req.sampling),
  });
}

/** 视觉评审：需要模型声明 image capability，或通过 MCP 后端走外部视觉工具。 */
export async function runVisionJudge(req) {
  const router = buildRouter(VISION_JUDGE_DEFAULTS, "VISION_JUDGE_MODEL_CHAIN", req.modelChain);
  return router.run({
    ...req,
    kind: "vision_judge",
    timeoutMs: req.timeoutMs ?? VISION_JUDGE_DEFAULTS.timeoutMs,
    retry: req.retry ?? VISION_JUDGE_DEFAULTS.retry,
    sampling: mergeSampling(VISION_JUDGE_DEFAULTS, req.sampling),
  });
}

/** 图候选生成：视觉判官 fail 后重生 N 候选。优先 free tier，付费需 allowPaid 显式开启。 */
export async function runDiagramGenerate(req) {
  const router = buildRouter(DIAGRAM_GENERATE_DEFAULTS, "DIAGRAM_CANDIDATE_MODEL_CHAIN", req.modelChain);
  return router.run({
    ...req,
    kind: "diagram_generate",
    timeoutMs: req.timeoutMs ?? DIAGRAM_GENERATE_DEFAULTS.timeoutMs,
    retry: req.retry ?? DIAGRAM_GENERATE_DEFAULTS.retry,
    sampling: mergeSampling(DIAGRAM_GENERATE_DEFAULTS, req.sampling),
  });
}

/** 直接调 API,不走 router(单次调用、不降级) */
export async function runOnce(req) {
  return openaiRunner.run(req);
}

export const llmRunner = { runRefine, runJudge, runBlockJudge, runVisionJudge, runDiagramGenerate, runOnce };
