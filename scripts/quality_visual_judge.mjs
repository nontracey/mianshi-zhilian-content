import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { envConfig } from "./llm/env-config.mjs";
import { llmRunner } from "./llm/runner.mjs";
import { callConfiguredTools } from "./mcp/registry.mjs";

const root = process.cwd();
const VISUAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    visualFit: { type: "string", enum: ["pass", "fail", "not_checked"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          cardTitle: { type: "string" },
          severity: { type: "string", enum: ["info", "warn", "fail"] },
          issue: { type: "string" },
          evidence: { type: "string" },
          requiredFix: { type: "string" },
        },
      },
    },
    candidateRanking: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          cardTitle: { type: "string" },
          bestFormat: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
  required: ["visualFit", "summary", "findings", "candidateRanking"],
};

const cache = new Map();

function boolEnv(key, fallback = false) {
  const raw = envConfig.getEnv(key);
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function textLength(value) {
  return String(value ?? "").replace(/\s+/g, "").length;
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function diagramCards(topic) {
  return (topic.learningCards ?? []).filter((card) => card?.type === "diagram" || card?.type === "animation");
}

function isSvgPath(value) {
  return typeof value === "string" && /\.svg(?:[?#].*)?$/i.test(value.trim());
}

function cardSvgPaths(card) {
  const out = [];
  for (const value of [card.svgPath, card.asset]) {
    if (isSvgPath(value)) out.push(value.trim());
  }
  for (const source of Array.isArray(card.sources) ? card.sources : []) {
    if (source?.kind === "svg" && isSvgPath(source.path)) out.push(source.path.trim());
  }
  return out;
}

function cardSources(card) {
  const sources = Array.isArray(card.sources) ? [...card.sources] : [];
  if (card.content && card.format === "mermaid") sources.push({ kind: "mermaid", content: card.content });
  return sources;
}

function cardInlineSvgs(card) {
  const out = [];
  if (typeof card.svg === "string" && /<svg\b/i.test(card.svg)) {
    out.push({ label: "card.svg", svg: card.svg });
  }
  for (const source of Array.isArray(card.sources) ? card.sources : []) {
    if (source?.kind === "svg" && typeof source.content === "string" && /<svg\b/i.test(source.content)) {
      out.push({ label: "sources[].content", svg: source.content });
    }
  }
  return out;
}

function svgDataUrl(svgText) {
  return `data:image/svg+xml;base64,${Buffer.from(svgText, "utf8").toString("base64")}`;
}

function parseNumAttr(attrs, name) {
  const m = String(attrs ?? "").match(new RegExp(`${name}\\s*=\\s*["']?(-?\\d+(?:\\.\\d+)?)`, "i"));
  return m ? Number(m[1]) : null;
}

function parseSvgBounds(svg) {
  const rootTag = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const viewBox = rootTag.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  if (viewBox) {
    const nums = viewBox.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (nums.length === 4) return { x: nums[0], y: nums[1], width: nums[2], height: nums[3], source: "viewBox" };
  }
  const width = parseNumAttr(rootTag, "width");
  const height = parseNumAttr(rootTag, "height");
  return { x: 0, y: 0, width, height, source: width && height ? "width-height" : "missing" };
}

function svgTextNodes(svg) {
  const nodes = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = re.exec(svg))) {
    const attrs = match[1] ?? "";
    nodes.push({
      x: parseNumAttr(attrs, "x"),
      y: parseNumAttr(attrs, "y"),
      fontSize: parseNumAttr(attrs, "font-size"),
      text: stripTags(match[2]),
    });
  }
  return nodes;
}

function staticSvgFindings({ svg, svgPath, cardTitle }) {
  const findings = [];
  const bounds = parseSvgBounds(svg);
  if (!/<svg\b/i.test(svg)) {
    findings.push({ cardTitle, severity: "fail", issue: "SVG 文件缺少 <svg> 根节点", evidence: svgPath, requiredFix: "重建合法 SVG 或改用 Mermaid/text 兜底" });
    return findings;
  }
  if (!bounds.width || !bounds.height || bounds.width <= 0 || bounds.height <= 0) {
    findings.push({ cardTitle, severity: "fail", issue: "SVG 缺少有效 viewBox/width/height", evidence: svgPath, requiredFix: "补齐 viewBox，确保移动端可缩放" });
  }
  const texts = svgTextNodes(svg);
  if (!texts.length) {
    findings.push({ cardTitle, severity: "warn", issue: "SVG 没有可见 text 节点", evidence: svgPath, requiredFix: "确认图不是纯装饰；必要时在 caption/fallback 中补足语义" });
  }
  for (const node of texts) {
    if (node.fontSize != null && node.fontSize < 10) {
      findings.push({ cardTitle, severity: "warn", issue: "SVG 文字字号过小", evidence: `${node.text.slice(0, 24)} font-size=${node.fontSize}`, requiredFix: "移动端字号建议不低于 10-12px" });
    }
    if (node.text.length > 34) {
      findings.push({ cardTitle, severity: "warn", issue: "SVG 单个文本节点过长", evidence: node.text.slice(0, 60), requiredFix: "拆行或改成 caption/fallback，避免压字" });
    }
    if (bounds.width && bounds.height && node.x != null && node.y != null) {
      const outX = node.x < bounds.x - 2 || node.x > bounds.x + bounds.width + 2;
      const outY = node.y < bounds.y - 2 || node.y > bounds.y + bounds.height + 2;
      if (outX || outY) {
        findings.push({ cardTitle, severity: "fail", issue: "SVG 文本坐标越出 viewBox", evidence: `${node.text.slice(0, 24)} @(${node.x},${node.y})`, requiredFix: "扩大 viewBox 或调整文本位置" });
      }
    }
  }
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i];
      const b = texts[j];
      if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
      const sameSpot = Math.abs(a.x - b.x) < 24 && Math.abs(a.y - b.y) < 10;
      if (sameSpot && a.text && b.text) {
        findings.push({ cardTitle, severity: "fail", issue: "SVG 文本疑似重叠", evidence: `${a.text.slice(0, 18)} / ${b.text.slice(0, 18)}`, requiredFix: "重新布局节点或拆成多面板" });
      }
    }
  }
  return findings;
}

function staticVisualReview(topic, ref) {
  const cards = diagramCards(topic);
  const findings = [];
  const artifacts = [];
  for (const card of cards) {
    const sources = cardSources(card);
    const hasTextFallback =
      textLength(card.fallback) >= 12 ||
      textLength(card.caption) >= 12 ||
      sources.some((source) => source.kind === "text" && textLength(source.content) >= 12);
    if (!hasTextFallback) {
      findings.push({ cardTitle: card.title ?? "", severity: "fail", issue: "图解缺少可读兜底", evidence: "fallback/caption/text source 均不足", requiredFix: "补一层文字兜底，说明图在讲什么" });
    }
    for (const svgPath of cardSvgPaths(card)) {
      const abs = path.join(root, svgPath);
      if (!svgPath.startsWith("assets/") || svgPath.includes("..") || path.isAbsolute(svgPath)) {
        findings.push({ cardTitle: card.title ?? "", severity: "fail", issue: "SVG 路径非法", evidence: svgPath, requiredFix: "资源必须位于 assets/ 下，不能包含 .. 或绝对路径" });
        continue;
      }
      if (!existsSync(abs)) {
        findings.push({ cardTitle: card.title ?? "", severity: "fail", issue: "SVG 文件不存在", evidence: svgPath, requiredFix: "生成资源或改用已有资源/mermaid/text" });
        continue;
      }
      const svg = readFileSync(abs, "utf8");
      artifacts.push({ cardTitle: card.title ?? "", kind: "svg", path: svgPath, dataUrl: svgDataUrl(svg), source: svg.slice(0, 12000) });
      findings.push(...staticSvgFindings({ svg, svgPath, cardTitle: card.title ?? "" }));
    }
    for (const inline of cardInlineSvgs(card)) {
      const svgPath = `${ref}:${card.title ?? "inline-svg"}:${inline.label}`;
      artifacts.push({ cardTitle: card.title ?? "", kind: "svg", path: svgPath, dataUrl: svgDataUrl(inline.svg), source: inline.svg.slice(0, 12000) });
      findings.push(...staticSvgFindings({ svg: inline.svg, svgPath, cardTitle: card.title ?? "" }));
    }
  }
  const hasFail = findings.some((finding) => finding.severity === "fail");
  return {
    ref,
    backend: "static",
    visualFit: hasFail ? "fail" : (cards.length ? "not_checked" : "not_checked"),
    summary: cards.length
      ? `静态视觉 QA 检查 ${cards.length} 张图/动画，fail=${findings.filter((f) => f.severity === "fail").length}。`
      : "当前 topic 没有 diagram/animation，视觉判官不适用。",
    findings,
    candidateRanking: [],
    artifacts,
    checkedCards: cards.map((card) => ({
      title: card.title ?? "",
      type: card.type,
      format: card.format ?? "",
      sources: cardSources(card).map((source) => source.kind),
    })),
  };
}

function parseToolJson(result) {
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent;
  for (const item of result.content ?? []) {
    if (item.type === "text" && item.text) {
      try {
        return JSON.parse(item.text);
      } catch {
        return { visualFit: "not_checked", summary: item.text, findings: [], candidateRanking: [] };
      }
    }
  }
  return null;
}

function normalizeVisualResult(result, fallbackBackend) {
  const parsed = parseToolJson(result) ?? result ?? {};
  const visualFit = ["pass", "fail", "not_checked"].includes(parsed.visualFit) ? parsed.visualFit : "not_checked";
  return {
    backend: parsed.backend ?? fallbackBackend,
    visualFit,
    summary: String(parsed.summary ?? ""),
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    candidateRanking: Array.isArray(parsed.candidateRanking) ? parsed.candidateRanking : [],
  };
}

function mergeVisualReviews(staticReview, dynamicReview) {
  if (!dynamicReview) return staticReview;
  const findings = [...(staticReview.findings ?? []), ...(dynamicReview.findings ?? [])];
  const visualFit = findings.some((finding) => finding.severity === "fail") || dynamicReview.visualFit === "fail"
    ? "fail"
    : dynamicReview.visualFit === "pass"
      ? "pass"
      : staticReview.visualFit;
  return {
    ...staticReview,
    backend: `${staticReview.backend}+${dynamicReview.backend}`,
    visualFit,
    summary: [staticReview.summary, dynamicReview.summary].filter(Boolean).join(" | "),
    findings,
    candidateRanking: dynamicReview.candidateRanking?.length ? dynamicReview.candidateRanking : staticReview.candidateRanking,
  };
}

async function runMcpVisualJudges(topic, ref, staticReview) {
  const refs = [
    envConfig.getEnv("VISION_JUDGE_MCP_TOOLS"),
    envConfig.getEnv("VISION_JUDGE_MCP_TOOL"),
  ].filter(Boolean);
  if (!refs.length) return null;
  const toolArgs = {
    ref,
    topic: {
      id: topic.id,
      title: topic.title,
      domain: topic.domain,
      category: topic.category,
      difficulty: topic.difficulty,
      summary: topic.summary,
      tags: topic.tags,
    },
    cards: staticReview.checkedCards,
    artifacts: staticReview.artifacts,
    staticFindings: staticReview.findings,
    criteria: {
      contentAccuracy: "图中的步骤、状态、数据结构、箭头方向必须与 topic 机制一致。",
      formatFit: "判断 SVG/Mermaid/compareTable/code/text/none 哪种表达更适合。",
      renderQuality: "检查空白、裁切、重叠、显示不全、文字过密、移动端字号。",
      topicFit: "图不能是四节点模板、装饰图或跨 topic 套图。",
      fallback: "图解必须有 caption/fallback/text 降级兜底。",
    },
  };
  const results = await callConfiguredTools("VISION_JUDGE_MCP_TOOLS", "VISION_JUDGE_MCP_TOOL", toolArgs, { mode: "parallel" });
  const ok = results.filter((entry) => entry.ok);
  if (!ok.length) {
    return {
      backend: "mcp",
      visualFit: staticReview.visualFit === "fail" ? "fail" : "not_checked",
      summary: `所有视觉 MCP 工具失败：${results.map((r) => `${r.ref.server}:${r.ref.tool}=${r.error}`).join("; ")}`,
      findings: [],
      candidateRanking: [],
    };
  }
  // merge：findings 取并集，candidateRanking 取并集，visualFit 任一 fail 则 fail
  const merged = ok.reduce((acc, entry) => {
    const parsed = normalizeVisualResult(entry.result, `mcp:${entry.ref.server}`);
    return {
      backend: acc.backend ? `${acc.backend}+${parsed.backend}` : parsed.backend,
      visualFit: acc.visualFit === "fail" || parsed.visualFit === "fail" ? "fail"
        : acc.visualFit === "pass" || parsed.visualFit === "pass" ? "pass"
        : "not_checked",
      summary: [acc.summary, parsed.summary].filter(Boolean).join(" | "),
      findings: [...acc.findings, ...parsed.findings],
      candidateRanking: [...acc.candidateRanking, ...parsed.candidateRanking],
    };
  }, { backend: "", visualFit: "not_checked", summary: "", findings: [], candidateRanking: [] });
  return merged;
}

async function runLlmVisualJudge(topic, ref, staticReview) {
  const chain = String(envConfig.getEnv("VISION_JUDGE_MODEL_CHAIN") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!chain.length || !staticReview.artifacts.length) return null;
  const visionModels = chain.filter((spec) => envConfig.modelSupports(spec, "image"));
  if (!visionModels.length) return {
    backend: "llm-vision",
    visualFit: "not_checked",
    summary: "VISION_JUDGE_MODEL_CHAIN 未包含 image-capable 模型。",
    findings: [],
    candidateRanking: [],
  };
  const prompt = `你是视觉质量判官。请根据 topic 语义和图片判断图解是否真的有帮助。

检查维度：
1. 内容：图中的节点、状态、箭头、布局是否贴合 topic，不得是模板换名。
2. 格式：SVG/Mermaid/compareTable/code/text/none 哪个更合适；不要一味 SVG。
3. 渲染：是否空白、裁切、重叠、显示不全、文字过密、移动端看不清。
4. 兜底：caption/fallback/text source 是否能在图坏掉时讲清。
5. 候选排序：如果同一卡片有多种表达，说明哪个更好。

topic:
${JSON.stringify({ ref, id: topic.id, title: topic.title, domain: topic.domain, category: topic.category, difficulty: topic.difficulty, summary: topic.summary, tags: topic.tags }, null, 2)}

静态 QA:
${JSON.stringify({ checkedCards: staticReview.checkedCards, findings: staticReview.findings }, null, 2)}
`;
  const result = await llmRunner.runVisionJudge({
    systemPrompt: "你是严格的图解视觉质量判官，只返回 JSON。",
    userPrompt: prompt,
    schema: VISUAL_SCHEMA,
    modelChain: visionModels,
    images: staticReview.artifacts.slice(0, 4).map((artifact) => ({ dataUrl: artifact.dataUrl, detail: "high" })),
  });
  return normalizeVisualResult(result.parsed, "llm-vision");
}

export async function buildVisualReview(topic, ref) {
  const staticReview = staticVisualReview(topic, ref);
  const enabled = boolEnv("VISION_JUDGE_ENABLED", false);
  const cacheKey = hash(JSON.stringify({
    ref,
    topicHash: hash(JSON.stringify(topic)),
    enabled,
    mcp: envConfig.getEnv("VISION_JUDGE_MCP_TOOLS") ?? envConfig.getEnv("VISION_JUDGE_MCP_TOOL") ?? "",
    models: envConfig.getEnv("VISION_JUDGE_MODEL_CHAIN") ?? "",
  }));
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let review = staticReview;
  if (enabled && diagramCards(topic).length) {
    try {
      const dynamic = await runMcpVisualJudges(topic, ref, staticReview) ?? await runLlmVisualJudge(topic, ref, staticReview);
      review = mergeVisualReviews(staticReview, dynamic);
    } catch (error) {
      review = mergeVisualReviews(staticReview, {
        backend: "visual-backend-error",
        visualFit: staticReview.visualFit === "fail" ? "fail" : "not_checked",
        summary: `视觉后端失败：${error.message}`,
        findings: [],
        candidateRanking: [],
      });
    }
  }
  cache.set(cacheKey, review);
  return review;
}

export function applyVisualReviewToJudgeReview(review, visualReview) {
  if (!review || !visualReview) return review;
  const out = JSON.parse(JSON.stringify(review));
  out.externalVisualReview = {
    backend: visualReview.backend,
    visualFit: visualReview.visualFit,
    summary: visualReview.summary,
    findings: visualReview.findings,
    candidateRanking: visualReview.candidateRanking,
  };
  out.diagramModalityFinding ??= {};
  if (visualReview.visualFit === "fail") {
    out.diagramModalityFinding.visualFit = "fail";
    out.verdict = "fail";
    out.blockingFindings ??= [];
    for (const finding of visualReview.findings.filter((item) => item.severity === "fail")) {
      out.blockingFindings.push({ reason: `视觉 QA fail：${finding.cardTitle || ""} ${finding.issue || ""}`.trim() });
    }
  } else if (!out.diagramModalityFinding.visualFit || out.diagramModalityFinding.visualFit === "not_checked") {
    out.diagramModalityFinding.visualFit = visualReview.visualFit;
  }
  return out;
}
