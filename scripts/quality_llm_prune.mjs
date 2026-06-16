#!/usr/bin/env node
import { readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildReviewRequest, fileSha256, normalizeOptions, parseArgs } from "./quality_llm_common.mjs";

const root = process.cwd();
const reportsDir = path.join(root, ".quality-review/reports");

async function listReportFiles() {
  try {
    const entries = await readdir(reportsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^llm-quality-[a-f0-9]+\.json$/.test(entry.name))
      .map((entry) => path.join(".quality-review/reports", entry.name))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// 一份 pass 报告只要还有任一条目按 contentHash 命中当前文件内容，就可能被后续
// push/PR 的聚合 diff 用作联合覆盖来源，不能删。
async function providesLiveCoverage(reportFile, hashCache) {
  let report;
  try {
    report = JSON.parse(await readFile(path.join(root, reportFile), "utf8"));
  } catch {
    return false;
  }
  if (report?.verdict !== "pass") return false;
  for (const topic of report.reviewedTopics ?? []) {
    if (typeof topic?.ref !== "string" || typeof topic?.contentHash !== "string") continue;
    if (!existsSync(path.join(root, topic.ref))) continue;
    if (!hashCache.has(topic.ref)) hashCache.set(topic.ref, await fileSha256(topic.ref));
    if (hashCache.get(topic.ref) === topic.contentHash) return true;
  }
  return false;
}

async function main() {
  const rawArgs = parseArgs();
  const options = normalizeOptions(rawArgs);
  const dryRun = Boolean(rawArgs["dry-run"]);
  const review = await buildReviewRequest(options);
  const keep = new Set(review.request.reviewedTargetCount ? [review.request.reportPath] : []);
  const reports = await listReportFiles();
  const hashCache = new Map();
  const staleReports = [];
  for (const reportFile of reports) {
    if (keep.has(reportFile)) continue;
    if (await providesLiveCoverage(reportFile, hashCache)) {
      keep.add(reportFile);
      continue;
    }
    staleReports.push(reportFile);
  }

  if (!reports.length) {
    console.log("No LLM review reports to prune.");
    return;
  }

  if (keep.size) {
    console.log(`Keeping ${keep.size} report(s) (current reviewId or still providing per-topic coverage):`);
    for (const file of [...keep].sort()) console.log(`- ${file}`);
  } else {
    console.log(`No report is required for env=${options.env}, scope=${options.scope}.`);
  }

  if (!staleReports.length) {
    console.log("No stale LLM review reports found.");
    return;
  }

  for (const report of staleReports) {
    if (dryRun) {
      console.log(`Would remove stale report: ${report}`);
    } else {
      await rm(path.join(root, report));
      console.log(`Removed stale report: ${report}`);
    }
  }

  if (dryRun) {
    console.log(`Dry run complete: ${staleReports.length} stale report(s) would be removed.`);
  } else {
    console.log(`Pruned ${staleReports.length} stale LLM review report(s).`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

