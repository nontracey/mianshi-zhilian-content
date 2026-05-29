/**
 * Phase 1 质量修复脚本
 * 批量修复 257 个知识点的质量问题：
 * 1.2 优化 Summary（过短或与标题重复）
 * 1.3 修复 Diagram 卡片（纯文字描述 → 结构化 items）
 * 1.4 拆分过长 Explain 卡片
 * 1.5 定制化 Rubric（泛化 → 具体化）
 *
 * 用法：node scripts/phase1_quality_fix.mjs [--dry-run]
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const root = path.resolve(__dirname, "..");

// ── 工具函数 ──────────────────────────────────────────────

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

function extractKeywords(title, summary) {
  // 从标题和摘要中提取关键词
  const text = `${title} ${summary}`;
  const keywords = [];
  // 提取中文关键词
  const cnMatches = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  keywords.push(...cnMatches);
  // 提取英文关键词
  const enMatches = text.match(/[A-Za-z][A-Za-z0-9]+/g) || [];
  keywords.push(...enMatches);
  return [...new Set(keywords)].slice(0, 8);
}

function generateSummaryFromExplain(title, explainContent) {
  // 从 explain 卡片内容中提取关键信息生成 summary
  if (!explainContent) return null;

  // 提取第一段有意义的文本
  const lines = explainContent.split("\n").filter(l => l.trim() && !l.startsWith("#") && !l.startsWith("```"));
  const firstParagraph = lines.slice(0, 3).join(" ").substring(0, 150);

  // 提取核心概念
  const conceptMatch = explainContent.match(/(?:核心概念|什么是|定义|原理)[：:]\s*(.+)/);
  const concept = conceptMatch ? conceptMatch[1].substring(0, 80) : "";

  if (concept) {
    return `理解${title}的${concept}，掌握其在面试中的高频考点和实际应用场景`;
  }

  return `深入理解${title}的核心原理与关键机制，掌握面试高频考点和实际应用`;
}

// ── 1.2 Summary 修复 ──────────────────────────────────────

function fixSummary(topic) {
  const { title, summary, learningCards } = topic;
  let changed = false;
  let newSummary = summary;

  // 检查是否需要修复
  const tooShort = !summary || summary.length < 20;
  const sameAsTitle = summary === title || summary === `${title}实战` || summary === `${title}详解`;
  const tooGeneric = /^(深入理解|掌握|学习)/.test(summary) && summary.length < 30;

  if (tooShort || sameAsTitle || tooGeneric) {
    // 从 explain 卡片提取内容生成更好的 summary
    const explainCard = learningCards.find(c => c.type === "explain");
    const generated = generateSummaryFromExplain(title, explainCard?.content);

    if (generated && generated !== summary) {
      newSummary = generated;
      changed = true;
    } else if (tooShort || sameAsTitle) {
      // 兜底：生成基础 summary
      newSummary = `理解${title}的核心概念与关键机制，掌握面试高频考点`;
      changed = true;
    }
  }

  if (changed) {
    topic.summary = newSummary;
  }
  return changed;
}

// ── 1.3 Diagram 修复 ──────────────────────────────────────

function fixDiagram(topic) {
  let changed = false;

  for (const card of topic.learningCards) {
    if (card.type !== "diagram") continue;

    // 检查是否是纯文字描述的 diagram
    const hasPlaceholder = card.fallback && card.content === card.fallback;
    const hasSuggestion = /建议用|可以用|推荐使用/.test(card.content || "");
    const noItems = !card.items || card.items.length === 0;

    if ((hasPlaceholder || hasSuggestion) && noItems) {
      // 根据标题和内容生成结构化 items
      const keywords = extractKeywords(topic.title, topic.summary);
      const explainCard = topic.learningCards.find(c => c.type === "explain");
      const explainContent = explainCard?.content || "";

      // 从 explain 中提取要点作为 diagram items
      const bulletPoints = explainContent.match(/[-*]\s+(.+)/g) || [];
      const headerPoints = explainContent.match(/^#{2,3}\s+(.+)/gm) || [];

      const items = [];
      if (headerPoints.length > 0) {
        items.push(...headerPoints.map(h => h.replace(/^#+\s*/, "")).slice(0, 7));
      }
      if (items.length < 3 && bulletPoints.length > 0) {
        items.push(...bulletPoints.map(b => b.replace(/^[-*]\s*/, "")).slice(0, 7 - items.length));
      }
      if (items.length < 3) {
        items.push(...keywords.slice(0, 5).map(k => `${k}的核心概念`));
      }

      if (items.length > 0) {
        card.items = items;
        card.content = `${topic.title}的结构化要点图解`;
        if (!card.fallback) {
          card.fallback = `建议用思维导图或流程图展示${topic.title}的核心结构和关键要素`;
        }
        changed = true;
      }
    }
  }

  return changed;
}

// ── 1.4 Explain 拆分 ──────────────────────────────────────

function fixLongExplain(topic) {
  let changed = false;
  const newCards = [];

  for (const card of topic.learningCards) {
    if (card.type !== "explain") {
      newCards.push(card);
      continue;
    }

    const content = card.content || "";
    if (content.length <= 800) {
      newCards.push(card);
      continue;
    }

    // 尝试按 ## 标题拆分
    const sections = content.split(/(?=^#{2,3}\s)/m).filter(s => s.trim());

    if (sections.length >= 3) {
      // 拆分为多个子卡片
      const firstPart = sections.slice(0, 2).join("\n");
      const secondPart = sections.slice(2).join("\n");

      if (firstPart.length > 100 && secondPart.length > 100) {
        newCards.push({
          type: "explain",
          title: "核心概念",
          content: firstPart.trim()
        });
        newCards.push({
          type: "explain",
          title: "深入理解",
          content: secondPart.trim()
        });
        changed = true;
      } else {
        newCards.push(card);
      }
    } else {
      // 按段落拆分
      const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
      const mid = Math.ceil(paragraphs.length / 2);
      const firstHalf = paragraphs.slice(0, mid).join("\n\n");
      const secondHalf = paragraphs.slice(mid).join("\n\n");

      if (firstHalf.length > 200 && secondHalf.length > 200) {
        newCards.push({
          type: "explain",
          title: "核心概念",
          content: firstHalf.trim()
        });
        newCards.push({
          type: "explain",
          title: "深入理解",
          content: secondHalf.trim()
        });
        changed = true;
      } else {
        newCards.push(card);
      }
    }
  }

  if (changed) {
    topic.learningCards = newCards;
  }
  return changed;
}

// ── 1.5 Rubric 定制化 ──────────────────────────────────────

function customizeRubric(topic) {
  const { title, summary, learningCards, rubric } = topic;
  let changed = false;

  // 检查是否是泛化 rubric
  const genericMustHave = ["定义准确", "关键机制", "适用场景", "常见误区", "面试表达结构"];
  const isGeneric = rubric.mustHave.length === 5 &&
    rubric.mustHave.every((item, i) => item === genericMustHave[i]);

  if (!isGeneric) return false;

  // 从内容中提取关键点
  const explainCard = learningCards.find(c => c.type === "explain");
  const explainContent = explainCard?.content || "";
  const compareCard = learningCards.find(c => c.type === "compareTable");
  const checklistCard = learningCards.find(c => c.type === "checklist");

  // 提取核心概念
  const concepts = [];
  const headerMatches = explainContent.match(/^#{2,4}\s+(.+)/gm) || [];
  concepts.push(...headerMatches.map(h => h.replace(/^#+\s*/, "")));

  // 从 checklist 提取关键点
  const checklistItems = checklistCard?.items || [];

  // 生成定制化 mustHave
  const mustHave = [];
  if (concepts.length > 0) {
    mustHave.push(`准确解释${concepts[0]}的定义和作用`);
  }
  if (concepts.length > 1) {
    mustHave.push(`说清${concepts.slice(1, 3).join("和")}的关键机制`);
  }
  mustHave.push(`能结合实际场景说明${title}的应用`);
  if (checklistItems.length > 0) {
    mustHave.push(checklistItems[0]);
  }
  mustHave.push(`面试表达清晰有条理，能回答追问`);

  // 生成定制化 commonMistakes
  const commonMistakes = [
    `只背概念不理解${title}的底层原理`,
    `忽略${title}的适用场景和局限性`,
    `缺少实际案例支撑，回答空洞`
  ];

  // 更新 rubric
  rubric.mustHave = mustHave.slice(0, 5);
  rubric.commonMistakes = commonMistakes;
  changed = true;

  return changed;
}

// ── 主流程 ──────────────────────────────────────────────

async function main() {
  const topicFiles = (await walk(path.join(root, "topics"))).sort();

  const stats = {
    summaryFixed: 0,
    diagramFixed: 0,
    explainSplit: 0,
    rubricFixed: 0,
    totalFiles: topicFiles.length
  };

  for (const filePath of topicFiles) {
    const raw = await readFile(filePath, "utf8");
    const topic = JSON.parse(raw);
    let changed = false;

    // 1.2 Summary 修复
    if (fixSummary(topic)) {
      stats.summaryFixed++;
      changed = true;
    }

    // 1.3 Diagram 修复
    if (fixDiagram(topic)) {
      stats.diagramFixed++;
      changed = true;
    }

    // 1.4 Explain 拆分
    if (fixLongExplain(topic)) {
      stats.explainSplit++;
      changed = true;
    }

    // 1.5 Rubric 定制化
    if (customizeRubric(topic)) {
      stats.rubricFixed++;
      changed = true;
    }

    if (changed && !DRY_RUN) {
      await writeFile(filePath, JSON.stringify(topic, null, 2) + "\n");
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}Phase 1 质量修复完成：`);
  console.log(`  - 扫描文件：${stats.totalFiles}`);
  console.log(`  - Summary 修复：${stats.summaryFixed}`);
  console.log(`  - Diagram 修复：${stats.diagramFixed}`);
  console.log(`  - Explain 拆分：${stats.explainSplit}`);
  console.log(`  - Rubric 定制化：${stats.rubricFixed}`);
  if (DRY_RUN) {
    console.log(`\n使用不带 --dry-run 的命令执行实际修复`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
