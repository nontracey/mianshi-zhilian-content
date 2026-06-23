// topic 内容字段的抽取、合并回写、校验。
// 只往返「内容字段」，其余脚手架字段原样保留，降低 token 并防破坏 schema。

export const CONTENT_FIELDS = ["summary", "learningCards", "recallPrompts", "rubric", "interviewerFocus"];
export const CONTEXT_FIELDS = ["title", "domain", "category", "difficulty", "interviewFrequency", "tags"];

export function extractContent(topic) {
  const content = {};
  for (const f of CONTENT_FIELDS) if (topic[f] !== undefined) content[f] = topic[f];
  const context = {};
  for (const f of CONTEXT_FIELDS) if (topic[f] !== undefined) context[f] = topic[f];
  return { content, context };
}

// 现有 diagram 卡由程序保护：模型只能采纳其 caption/fallback 文字改进，碰不到 content(svg 路径)。
// 模型自造/降级/顶替/新增的图，转成 _diagramRequests 交后续 SVG 环节，不直接落为正式卡。
function reconcileDiagrams(origCards = [], modelCards = []) {
  const origDiagrams = (origCards || []).filter((c) => c && c.type === "diagram");
  const used = new Set();
  const requests = [];
  const out = [];
  for (const c of modelCards || []) {
    if (!c || c.type !== "diagram") { out.push(c); continue; }
    const idx = origDiagrams.findIndex((d, i) => !used.has(i) && d.content === c.content);
    if (idx >= 0) {
      used.add(idx);
      const orig = origDiagrams[idx];
      out.push({ ...orig, ...(c.caption ? { caption: c.caption } : {}), ...(c.fallback ? { fallback: c.fallback } : {}) });
    } else {
      requests.push({
        cardTitle: c.title || "",
        reason: "模型建议新增/改图（已转待生成清单，不直接落卡）",
        mustShow: typeof c.content === "string" ? c.content.replace(/\s+/g, " ").slice(0, 400) : "",
        suggestedFileName: "",
        caption: c.caption || "",
        fallback: c.fallback || "",
      });
    }
  }
  // 模型删掉/漏掉的现有图：还原回去，插到最后一张 explain 之后（标准卡序）。
  const missing = origDiagrams.filter((_, i) => !used.has(i));
  if (missing.length) {
    let pos = out.map((c) => c.type).lastIndexOf("explain");
    pos = pos < 0 ? out.length : pos + 1;
    out.splice(pos, 0, ...missing);
  }
  return { cards: out, requests };
}

function countText(topic) {
  let chars = 0;
  const add = (s) => { if (typeof s === "string") chars += s.replace(/\s/g, "").length; };
  add(topic.summary);
  for (const c of topic.learningCards || []) {
    add(c.title); add(c.content); add(c.caption); add(c.fallback);
    for (const fq of c.followUpQuestions || []) { add(fq.question); add(fq.answer); }
    for (const it of c.items || []) add(it);
  }
  for (const r of topic.recallPrompts || []) add(r.prompt);
  return chars;
}

// 难度对应的学习时长区间（与 content_quality_audit.mjs 保持一致）。
function expectedMinutesRange(difficulty) {
  if (difficulty <= 1) return [8, 20];
  if (difficulty === 2) return [12, 30];
  if (difficulty === 3) return [20, 40];
  if (difficulty === 4) return [28, 50];
  return [35, 65];
}

// estimatedMinutes 由内容密度重算（~250 字/分钟），再钳制到难度对应区间。
export function recomputeMinutes(topic) {
  const chars = countText(topic);
  const raw = Math.max(5, Math.min(60, Math.round(chars / 250)));
  const [min, max] = expectedMinutesRange(topic.difficulty ?? 3);
  return Math.max(min, Math.min(max, raw));
}

// recallPrompts.id 由程序按既有命名规则归一，不信任模型生成的 id。
function normalizeRecallIds(topic, originalTopic) {
  const base = (originalTopic.recallPrompts?.[0]?.id || "").replace(/\.recall\.\d+$/, "");
  const prefix = base || `${originalTopic.domain}.${originalTopic.category}.${originalTopic.id || "topic"}`;
  (topic.recallPrompts || []).forEach((r, i) => { r.id = `${prefix}.recall.${i + 1}`; });
}

class RewriteError extends Error {}

// 校验模型输出 + 合并回原 topic。失败抛 RewriteError（该篇判失败，原文件不动）。
export function mergeRewrite(originalTopic, parsed) {
  if (!parsed || typeof parsed !== "object") throw new RewriteError("输出不是对象");
  for (const f of CONTENT_FIELDS) {
    if (originalTopic[f] !== undefined && parsed[f] === undefined) throw new RewriteError(`缺字段 ${f}`);
  }
  if (!Array.isArray(parsed.learningCards) || parsed.learningCards.length === 0) {
    throw new RewriteError("learningCards 非法");
  }
  for (const c of parsed.learningCards) {
    if (!c || typeof c.type !== "string") throw new RewriteError("卡片缺 type");
  }
  if (parsed.rubric?.scoreWeights) {
    const sum = Object.values(parsed.rubric.scoreWeights).reduce((a, b) => a + (Number(b) || 0), 0);
    if (sum !== 100) throw new RewriteError(`scoreWeights 之和=${sum}≠100`);
  }

  // 图：现有 diagram 卡由程序保护——模型看得见、能判断，但对图的意见只能走 _diagramRequests，不能改路径/伪造/降级/删除。
  const { cards: learningCards, requests: imgReqFromCards } = reconcileDiagrams(originalTopic.learningCards, parsed.learningCards);
  const diagramRequests = [...(Array.isArray(parsed._diagramRequests) ? parsed._diagramRequests : []), ...imgReqFromCards];

  // 不允许删卡：任何卡型数量比原文少就判失败（全库 429 篇仅 1 对疑似冗余卡，删卡几乎都是从 0 重造的误删）。
  const countByType = (cards) => { const o = {}; for (const c of cards || []) if (c?.type) o[c.type] = (o[c.type] || 0) + 1; return o; };
  const origN = countByType(originalTopic.learningCards);
  const newN = countByType(learningCards);
  for (const [type, n] of Object.entries(origN)) {
    if ((newN[type] || 0) < n) throw new RewriteError(`丢失原有卡：${type} ${n}→${newN[type] || 0}（不允许删卡）`);
  }

  const merged = { ...originalTopic };
  for (const f of CONTENT_FIELDS) if (parsed[f] !== undefined) merged[f] = parsed[f];
  merged.learningCards = learningCards;
  normalizeRecallIds(merged, originalTopic);
  merged.estimatedMinutes = recomputeMinutes(merged);
  merged.updatedAt = new Date().toISOString().slice(0, 10);
  return { topic: merged, diagramRequests };
}

export { RewriteError };
