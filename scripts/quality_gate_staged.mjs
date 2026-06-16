#!/usr/bin/env node
// 暂存区质量门禁：只对本次 git add 的 topic 卡确定性质量分。
// 复用 content_quality_audit.mjs（全语料两遍扫描，跨 topic 模板句检测需要全量），
// 但只在“你这次要提交的 topic”里出现 <minScore 时才阻断，历史存量不连坐。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const staged = process.argv.slice(2).filter((file) => /^topics\/.*\.json$/.test(file));
if (!staged.length) process.exit(0);

// 1) 每篇暂存 topic 必须是可解析 JSON（最常见的损坏来源，给精确报错）。
for (const ref of staged) {
  try {
    JSON.parse(readFileSync(ref, "utf8"));
  } catch (error) {
    console.error(`[pre-commit] ${ref} JSON 解析失败：${error.message}`);
    process.exit(1);
  }
}

// 2) 跑确定性审计，只在“暂存的 topic”里出现 <minScore 时阻断。
const result = spawnSync(
  process.execPath,
  ["scripts/content_quality_audit.mjs", "--json", "--min-score=90"],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);
if (!result.stdout) {
  console.error("[pre-commit] 质量审计未产出结果：");
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

let audit;
try {
  audit = JSON.parse(result.stdout);
} catch (error) {
  console.error(`[pre-commit] 解析审计 JSON 失败：${error.message}`);
  process.exit(1);
}

const failing = new Map((audit.failingTopics ?? []).map((topic) => [topic.ref, topic]));
const offenders = staged.filter((ref) => failing.has(ref));

if (offenders.length) {
  console.error(
    `\n[pre-commit] 以下暂存的 topic 质量分 < ${audit.threshold}，不能提交` +
      `（修到 ≥${audit.threshold}，或用 \`git commit --no-verify\` 临时跳过）：`,
  );
  for (const ref of offenders) {
    const topic = failing.get(ref);
    console.error(`  - ${topic.score}/100  ${ref}`);
    for (const issue of (topic.issues ?? []).slice(0, 3)) console.error(`      * ${issue}`);
  }
  process.exit(1);
}

console.log(`[pre-commit] 暂存的 ${staged.length} 篇 topic 均 ≥${audit.threshold} ✓`);
