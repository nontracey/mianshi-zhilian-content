/**
 * Phase 3 体验优化脚本
 * 3.2 优化 RecallPrompts（模板化 → 具体面试问题）
 * 3.4 重新校准 Difficulty 标签
 *
 * 用法：node scripts/phase3_experience.mjs [--dry-run]
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const root = path.resolve(__dirname, "..");

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

// ── 3.2 优化 RecallPrompts ──────────────────────────────

function fixRecallPrompts(topic) {
  const { title, id, recallPrompts } = topic;
  let changed = false;

  if (!recallPrompts || recallPrompts.length === 0) return false;

  for (const prompt of recallPrompts) {
    // 检查是否是模板化 prompt
    const isTemplate1 = prompt.prompt === `请用自己的话解释 ${title}。`;
    const isTemplate2 = prompt.prompt === `如果面试官追问 ${title} 的应用场景或常见误区，你会怎么回答？`;
    const isGeneric = /请用自己的话解释/.test(prompt.prompt) || /如果面试官追问.*的应用场景或常见误区/.test(prompt.prompt);

    if (isTemplate1) {
      prompt.prompt = `面试官问：请介绍一下${title}？`;
      changed = true;
    } else if (isTemplate2) {
      prompt.prompt = `面试官追问：${title}在实际项目中是怎么用的？有什么注意事项？`;
      changed = true;
    } else if (isGeneric) {
      // 保持不变，但标记为需要人工审核
    }
  }

  return changed;
}

// ── 3.4 Difficulty 校准 ──────────────────────────────────

function calibrateDifficulty(topic) {
  const { title, difficulty, learningCards } = topic;
  let changed = false;
  let newDifficulty = difficulty;

  const explainCard = learningCards.find(c => c.type === "explain");
  const content = explainCard?.content || "";

  // 基于内容复杂度调整难度
  const hasSourceCode = /源码|底层实现|内部原理|深入分析/.test(content);
  const hasComparison = learningCards.some(c => c.type === "compareTable");
  const hasCodeExample = learningCards.some(c => c.type === "code");
  const contentLength = content.length;
  const headerCount = (content.match(/^#/gm) || []).length;

  // 基于内容特征调整
  if (difficulty === 1 && (hasSourceCode || contentLength > 1500 || headerCount > 6)) {
    newDifficulty = 2;
    changed = true;
  } else if (difficulty === 2 && hasSourceCode && contentLength > 2000) {
    newDifficulty = 3;
    changed = true;
  } else if (difficulty === 3 && contentLength < 500 && !hasSourceCode) {
    newDifficulty = 2;
    changed = true;
  }

  if (changed) {
    topic.difficulty = newDifficulty;
  }
  return changed;
}

// ── 主流程 ──────────────────────────────────────────────

async function main() {
  const topicFiles = (await walk(path.join(root, "topics"))).sort();

  const stats = {
    recallFixed: 0,
    difficultyAdjusted: 0,
    totalFiles: topicFiles.length
  };

  for (const filePath of topicFiles) {
    const raw = await readFile(filePath, "utf8");
    const topic = JSON.parse(raw);
    let changed = false;

    // 3.2 RecallPrompts
    if (fixRecallPrompts(topic)) {
      stats.recallFixed++;
      changed = true;
    }

    // 3.4 Difficulty
    if (calibrateDifficulty(topic)) {
      stats.difficultyAdjusted++;
      changed = true;
    }

    if (changed && !DRY_RUN) {
      await writeFile(filePath, JSON.stringify(topic, null, 2) + "\n");
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}Phase 3 体验优化完成：`);
  console.log(`  - 扫描文件：${stats.totalFiles}`);
  console.log(`  - RecallPrompts 优化：${stats.recallFixed}`);
  console.log(`  - Difficulty 调整：${stats.difficultyAdjusted}`);
}

main().catch(error => { console.error(error); process.exit(1); });
