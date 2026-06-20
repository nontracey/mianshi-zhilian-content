// scripts/diagram_candidates.mjs
// 多候选图选优：视觉判官 fail 时触发，对一张图产 N 候选 → 视觉判官打分 → 选最优落盘。
//
// 触发条件（由 quality_refine.mjs 的 diagramCandidatePass 判定）：
//   - 判前 visualReview.visualFit === "fail"
//   - 判官 diagramModalityFinding.visualFit === "fail"
//   - SVG 被删且信息量退化
//
// 候选格式（默认 3 版）：svg / mermaid / compareTable（或 text 兜底）
//   - 每个候选独立 prompt，避免弱模型一次产多版混乱（K12 结构化模板）
//   - 优先 free tier 模型；allowPaid=false 且 free 池空 → 抛 NoFreeDiagramModel
//
// stuck 检测：连续 N 次重生仍 fail → 保留旧版 + 标 diagramStuck（计数在 quality_refine 维护）
// 反馈循环（K2）：previousFailures 喂回下次生成 prompt

import { envConfig } from "./llm/env-config.mjs";
import { llmRunner } from "./llm/runner.mjs";
import { buildVisualReview } from "./quality_visual_judge.mjs";

const CANDIDATE_FORMATS = ["svg", "mermaid", "compareTable"];

class NoFreeDiagramModel extends Error {
  constructor(message = "未配置免费图生成模型且未授权付费；请加 --allow-paid-diagram 或在向导开启") {
    super(message);
    this.name = "NoFreeDiagramModel";
    this.code = "NO_FREE_DIAGRAM_MODEL";
  }
}

function boolEnv(key, fallback = false) {
  const raw = envConfig.getEnv(key);
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function numEnv(key, fallback) {
  const raw = envConfig.getEnv(key);
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function pickDiagramChain(allowPaid) {
  const configured = String(envConfig.getEnv("DIAGRAM_CANDIDATE_MODEL_CHAIN") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const refineChain = String(envConfig.getEnv("REFINE_MODEL_CHAIN") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const source = configured.length ? configured : refineChain;
  const freeModels = envConfig.pickUsableFreeModels(source);
  if (freeModels.length) return freeModels;
  if (allowPaid) return source;
  return [];
}

// K12 结构化 prompt 模板：弱模型友好
function buildCandidatePrompt(topic, card, format, opts = {}) {
  const previousFailures = opts.previousFailures
    ? `\n上一版问题（这次务必避免）：\n${opts.previousFailures}`
    : "";
  if (format === "compareTable") {
    return `你是图解设计师。当前 diagram 可能不适合 topic「${topic.title}」，请改成一张真正能讲清机制/取舍的 compareTable。

topic 摘要：${topic.summary ?? ""}
topic 领域：${topic.domain} / ${topic.category} / 难度 ${topic.difficulty}
当前卡片标题：${card?.title ?? ""}

要求：
1. 输出真正的 learningCard，type 必须是 "compareTable"，不要塞进 diagram.sources。
2. columns 与 rows 必须对齐；每一行都要有本题专属结论，不要同义复述。
3. 表格要比原图更清楚地表达机制、边界、取舍或错误路径。
${previousFailures}

必须输出 JSON：
{
  "type": "compareTable",
  "title": "<表格标题，≤30字>",
  "columns": ["维度", "关键判断", "面试表达"],
  "rows": [
    ["<本题维度>", "<具体结论>", "<可复述表达>"]
  ]
}`;
  }

  const cardSpec = format === "svg"
    ? `输出合法内联 SVG（含 viewBox、text 节点 font-size≥12、不得重叠）。sources[0] 必须是 { "kind":"svg", "content":"<svg ...>...</svg>" }，不要编不存在的 assets 路径`
    : `输出合法 Mermaid 源码（flowchart/graph/sequenceDiagram/stateDiagram 任选），放 sources 里 kind="mermaid" 的 content 字段`;

  return `你是图解设计师。为 topic「${topic.title}」生成第 ${opts.candidateIndex ?? 1} 版图解，格式：${format}。

topic 摘要：${topic.summary ?? ""}
topic 领域：${topic.domain} / ${topic.category} / 难度 ${topic.difficulty}
当前卡片标题：${card?.title ?? ""}

要求：
1. ${cardSpec}
2. 必须有 caption（≤50字，移动端可读）和 fallback（≥30字，图坏时纯文字兜底）
3. 图必须承载 topic 的真实机制，不得是模板换名或装饰图
4. 同时输出 mermaid 或 text 兜底（SVG 必备）
${previousFailures}

必须输出 JSON：
{
  "type": "diagram",
  "title": "<图标题，≤30字>",
  "format": "${format}",
  "sources": [
    { "kind": "${format === "svg" ? "svg" : "mermaid"}", "content": "<源码>" },
    { "kind": "text", "content": "<纯文字兜底，≥30字>" }
  ],
  "caption": "<图说明 ≤50字>",
  "fallback": "<图坏掉的纯文字兜底 ≥30字>"
}`;
}

const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    type: { type: "string", enum: ["diagram", "animation", "compareTable"] },
    title: { type: "string" },
    format: { type: "string", enum: ["svg", "mermaid", "compareTable", "text"] },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          kind: { type: "string", enum: ["svg", "mermaid", "text", "code"] },
          path: { type: "string" },
          content: { type: "string" },
        },
      },
    },
    caption: { type: "string" },
    fallback: { type: "string" },
    content: { type: "string" },
    columns: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
  },
  required: ["type", "title"],
};

function normalizeCandidateCard(parsed, format, oldCard) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const title = String(parsed.title || oldCard?.title || (format === "compareTable" ? "机制对比表" : "机制图解")).slice(0, 40);
  if (format === "compareTable") {
    const columns = Array.isArray(parsed.columns) ? parsed.columns.map(String).filter(Boolean) : [];
    const rows = Array.isArray(parsed.rows)
      ? parsed.rows.filter(Array.isArray).map((row) => row.map((cell) => String(cell ?? "")))
      : [];
    if (columns.length < 2 || !rows.length || rows.some((row) => row.length !== columns.length)) return null;
    return {
      type: "compareTable",
      title,
      columns,
      rows,
    };
  }

  const sources = Array.isArray(parsed.sources) ? parsed.sources.map((source) => ({ ...source })) : [];
  for (const source of sources) {
    if (source.kind === "svg" && source.path && source.content) delete source.path;
    if (source.kind === "svg" && /<placeholder>|assets\/diagrams\/<|\.svg$/i.test(String(source.path ?? "")) && source.content) delete source.path;
  }
  const wantedKind = format === "svg" ? "svg" : "mermaid";
  const hasPrimary = sources.some((source) => source.kind === wantedKind && typeof source.content === "string" && source.content.trim());
  const fallback = String(parsed.fallback || parsed.caption || "").trim();
  if (!hasPrimary || fallback.length < 12) return null;
  if (!sources.some((source) => source.kind === "text" && String(source.content ?? "").trim().length >= 12)) {
    sources.push({ kind: "text", content: fallback });
  }
  return {
    type: "diagram",
    title,
    format,
    sources,
    caption: String(parsed.caption || title).slice(0, 80),
    fallback,
  };
}

// 生成单张图的 N 候选
export async function generateDiagramCandidates(topic, card, ref, opts = {}) {
  const enabled = boolEnv("DIAGRAM_CANDIDATE_ENABLED", true);
  if (!enabled) return { candidates: [], skipped: "disabled" };

  const candidateCount = Math.max(1, Math.min(5, opts.candidateCount || numEnv("DIAGRAM_CANDIDATE_COUNT", 3)));
  const allowPaid = opts.allowPaid ?? boolEnv("DIAGRAM_CANDIDATE_ALLOW_PAID", false);
  const chain = pickDiagramChain(allowPaid);
  if (!chain.length) throw new NoFreeDiagramModel();

  const formats = CANDIDATE_FORMATS.slice(0, candidateCount);
  const previousFailures = opts.previousFailures
    ? Array.isArray(opts.previousFailures)
      ? opts.previousFailures.map((f) => `- ${f.issue ?? f}`).join("\n")
      : String(opts.previousFailures)
    : null;

  const candidates = await Promise.all(
    formats.map(async (format, idx) => {
      try {
        const result = await llmRunner.runDiagramGenerate({
          systemPrompt: "你是图解设计师，只返回 JSON。",
          userPrompt: buildCandidatePrompt(topic, card, format, {
            candidateIndex: idx + 1,
            previousFailures,
          }),
          schema: CANDIDATE_SCHEMA,
          modelChain: chain,
        });
        const cardOut = normalizeCandidateCard(result.parsed, format, card);
        if (!cardOut) throw new Error(`候选结构不可用 format=${format}`);
        return { format, ok: true, card: cardOut, raw: result };
      } catch (error) {
        return { format, ok: false, error: error.message };
      }
    }),
  );

  return {
    candidates: candidates.filter((c) => c.ok),
    failed: candidates.filter((c) => !c.ok),
    chain,
    allowPaid,
  };
}

// 视觉判官对每版候选打分（复用 buildVisualReview）
// 这里构造一个临时 topic（只含该张候选图），让视觉判官跑一遍
export async function scoreDiagramCandidates(candidates, topic, ref) {
  const scored = await Promise.all(
    candidates.map(async (entry) => {
      try {
        const tempTopic = { ...topic, learningCards: [entry.card] };
        const review = await buildVisualReview(tempTopic, `${ref}#candidate-${entry.format}`);
        const score = computeScore(review);
        return { ...entry, review, score };
      } catch (error) {
        return { ...entry, review: null, score: 0, error: error.message };
      }
    }),
  );
  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function computeScore(review) {
  if (!review) return 0;
  let score = 50;
  if (review.visualFit === "pass") score += 30;
  else if (review.visualFit === "fail") score -= 30;
  else score += 5; // not_checked
  const failCount = (review.findings ?? []).filter((f) => f.severity === "fail").length;
  const warnCount = (review.findings ?? []).filter((f) => f.severity === "warn").length;
  score -= failCount * 15;
  score -= warnCount * 5;
  return Math.max(0, Math.min(100, score));
}

// 选最优候选；全 fail 兜底返回 null（保留旧版）
export function selectBestCandidate(scored, oldCard) {
  const valid = scored.filter((entry) => entry.review && entry.review.visualFit !== "fail" && entry.score >= 50);
  if (!valid.length) return { best: null, keptOld: true, reason: "all candidates failed visual review" };
  const best = valid[0];
  return { best, keptOld: false, reason: `selected ${best.format} (score=${best.score})` };
}

export { NoFreeDiagramModel, CANDIDATE_FORMATS };
