/**
 * 任务 3.3：更新关键知识点的 diagram 卡片引用 SVG
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// SVG 映射：文件路径 → SVG 文件名
const svgMap = [
  ["topics/java/topic-001-ebcc71cb.json", "assets/diagrams/01-jvm-runtime-data-area.svg"],
  ["topics/network/topic-tcp-handshake.json", "assets/diagrams/02-tcp-handshake.svg"],
  ["topics/network/topic-https.json", "assets/diagrams/03-https-tls-handshake.svg"],
  ["topics/agent/topic-119-03006980.json", "assets/diagrams/04-rag-pipeline.svg"],
];

async function main() {
  let modified = 0;

  for (const [relPath, svgPath] of svgMap) {
    const filePath = path.join(root, relPath);
    try {
      const raw = await readFile(filePath, "utf8");
      const topic = JSON.parse(raw);
      let changed = false;

      for (const card of topic.learningCards) {
        if (card.type === "diagram") {
          card.svgPath = svgPath;
          changed = true;
        }
      }

      if (changed) {
        await writeFile(filePath, JSON.stringify(topic, null, 2) + "\n");
        modified++;
        console.log(`  ✅ ${relPath} → ${svgPath}`);
      }
    } catch (e) {
      console.log(`  ⚠️ ${relPath}: ${e.message}`);
    }
  }

  console.log(`\n任务 3.3 完成：更新了 ${modified} 个知识点的 SVG 引用`);
}

main().catch(error => { console.error(error); process.exit(1); });
