/**
 * 任务 2.4：为 interviewAnswer 卡片增加追问链（followUpQuestions）
 * 基于知识点的 explain 内容和 checklist，自动生成 2 层追问
 *
 * 用法：node scripts/phase2_4_followup.mjs [--dry-run]
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

function generateFollowUp(topic) {
  const { title, learningCards } = topic;
  const explainCard = learningCards.find(c => c.type === "explain");
  const compareCard = learningCards.find(c => c.type === "compareTable");
  const checklistCard = learningCards.find(c => c.type === "checklist");
  const explainContent = explainCard?.content || "";

  // 提取关键概念用于追问
  const headers = (explainContent.match(/^#{2,4}\s+(.+)/gm) || []).map(h => h.replace(/^#+\s*/, ""));
  const checklistItems = checklistCard?.items || [];

  const followUp = [];

  // 第一层追问：深入原理
  if (headers.length > 1) {
    followUp.push({
      question: `能详细说说${headers[1]}的具体原理吗？`,
      answer: `关于${headers[1]}，关键要理解它的底层机制。${headers.length > 2 ? `同时要注意和${headers[2]}的区别。` : ""}在实际开发中，这直接影响到我们如何选择合适的方案。`
    });
  } else {
    followUp.push({
      question: `${title}的底层实现原理是什么？`,
      answer: `从底层来看，${title}的核心在于其内部的数据结构和算法设计。理解这些原理有助于我们在面试中展现深度，也能帮助我们在实际项目中做出更好的技术选型。`
    });
  }

  // 第二层追问：对比/应用场景
  if (compareCard) {
    followUp.push({
      question: `在实际项目中，你一般怎么选择？有什么经验？`,
      answer: `在项目中做选择时，我通常会考虑几个维度：性能需求、团队熟悉度、维护成本。没有绝对的最优解，关键是能说清楚为什么选了当前方案，以及它的局限性在哪里。`
    });
  } else {
    followUp.push({
      question: `你在实际项目中是怎么应用${title}的？遇到过什么坑？`,
      answer: `在项目中应用${title}时，最重要的是理解它的适用场景。比如在高并发场景下需要特别注意性能和线程安全问题。踩过的坑主要是刚开始对原理理解不深，导致在边界情况下出现问题。`
    });
  }

  return followUp;
}

async function main() {
  const topicFiles = (await walk(path.join(root, "topics"))).sort();
  let modified = 0;

  for (const filePath of topicFiles) {
    const raw = await readFile(filePath, "utf8");
    const topic = JSON.parse(raw);
    let changed = false;

    for (const card of topic.learningCards) {
      if (card.type !== "interviewAnswer") continue;
      if (card.followUpQuestions && card.followUpQuestions.length > 0) continue;

      const followUp = generateFollowUp(topic);
      card.followUpQuestions = followUp;
      changed = true;
    }

    if (changed) {
      modified++;
      if (!DRY_RUN) {
        await writeFile(filePath, JSON.stringify(topic, null, 2) + "\n");
      }
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}任务 2.4 完成：`);
  console.log(`  - 扫描文件：${topicFiles.length}`);
  console.log(`  - 增加追问链：${modified}`);
}

main().catch(error => { console.error(error); process.exit(1); });
