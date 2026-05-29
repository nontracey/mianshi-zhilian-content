/**
 * 任务 3.1：为知识点添加 prerequisites（前置依赖）
 * 基于同分类内的 order 排序，为后续知识点添加前置依赖
 *
 * 用法：node scripts/phase3_1_prerequisites.mjs [--dry-run]
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

async function main() {
  const topicFiles = (await walk(path.join(root, "topics"))).sort();

  // 读取所有 topic，按 domain+category 分组
  const topicsByGroup = new Map();
  const topicMap = new Map();

  for (const filePath of topicFiles) {
    const raw = await readFile(filePath, "utf8");
    const topic = JSON.parse(raw);
    topic._filePath = filePath;
    topicMap.set(topic.id, topic);

    const groupKey = `${topic.domain}/${topic.category}`;
    if (!topicsByGroup.has(groupKey)) {
      topicsByGroup.set(groupKey, []);
    }
    topicsByGroup.get(groupKey).push(topic);
  }

  // 对每个分组按 order 排序，添加 prerequisites
  let modified = 0;

  for (const [groupKey, topics] of topicsByGroup) {
    topics.sort((a, b) => (a.order || 0) - (b.order || 0));

    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      if (topic.prerequisites && topic.prerequisites.length > 0) continue;

      // 为非第一个知识点添加前置依赖（前一个同分类的知识点）
      if (i > 0) {
        const prevTopic = topics[i - 1];
        topic.prerequisites = [prevTopic.id];
        modified++;
      }
    }
  }

  // 写入文件
  for (const [, topics] of topicsByGroup) {
    for (const topic of topics) {
      if (topic.prerequisites || topic._filePath) {
        const filePath = topic._filePath;
        delete topic._filePath;
        if (!DRY_RUN) {
          await writeFile(filePath, JSON.stringify(topic, null, 2) + "\n");
        }
      }
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}任务 3.1 完成：`);
  console.log(`  - 扫描文件：${topicFiles.length}`);
  console.log(`  - 添加 prerequisites：${modified}`);
}

main().catch(error => { console.error(error); process.exit(1); });
