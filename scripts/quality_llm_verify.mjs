#!/usr/bin/env node
import path from "node:path";
import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  REVIEW_SCHEMA_VERSION,
  RUBRIC_VERSION,
  buildReviewRequest,
  expectedReportPath,
  normalizeOptions,
  parseArgs,
  readReport,
} from "./quality_llm_common.mjs";

const requiredDimensions = [
  "accuracy",
  "cognitiveOrder",
  "expertVoice",
  "selfContained",
  "interviewUsability",
  "difficultyFit",
];
const factVerdicts = new Set(["correct", "wrong", "suspicious", "outdated"]);

function fail(message, hints = []) {
  console.error(`LLM quality review failed: ${message}`);
  for (const hint of hints) console.error(`- ${hint}`);
  process.exitCode = 1;
}

function assertEqual(errors, label, actual, expected) {
  if (actual !== expected) errors.push(`${label} mismatch: expected ${expected}, got ${actual}`);
}

function sortedRefs(items) {
  return items.map((item) => item.ref).sort();
}

function validateScores(errors, label, scores) {
  if (!scores || typeof scores !== "object") {
    errors.push(`${label} scores missing`);
    return;
  }
  if (typeof scores.overall !== "number" || scores.overall < 85 || scores.overall > 100) {
    errors.push(`${label} overall score must be a number in [85, 100] (0-100 scale)`);
  }
  for (const key of requiredDimensions) {
    if (!Number.isInteger(scores[key]) || scores[key] < 4 || scores[key] > 5) {
      errors.push(`${label} ${key} must be an integer in [4, 5] (1-5 scale)`);
    }
  }
}

function validateFactFindings(errors, topic) {
  const findings = topic.factFindings;
  if (!Array.isArray(findings) || findings.length < 3) {
    errors.push(`${topic.ref} factFindings must contain >= 3 verified key claims (got ${Array.isArray(findings) ? findings.length : "none"})`);
    return;
  }
  for (const [index, finding] of findings.entries()) {
    const label = `${topic.ref} factFindings[${index}]`;
    if (typeof finding?.claim !== "string" || finding.claim.trim().length < 8) {
      errors.push(`${label} claim must describe the verified assertion`);
    }
    if (!factVerdicts.has(finding?.verdict)) {
      errors.push(`${label} verdict must be one of ${[...factVerdicts].join("/")}`);
      continue;
    }
    if (finding.verdict === "wrong" || finding.verdict === "outdated") {
      errors.push(`${label} is ${finding.verdict} — a passing report cannot contain wrong/outdated facts; fix the content and re-review`);
    }
    if (finding.verdict === "suspicious" && (typeof finding.evidence !== "string" || finding.evidence.trim().length < 8)) {
      errors.push(`${label} suspicious finding must explain why it could not be verified`);
    }
  }
}

async function listCommittedReports() {
  const dir = path.join(process.cwd(), ".quality-review/reports");
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const reports = [];
  for (const name of entries.sort()) {
    if (!/^llm-quality-[a-f0-9]+\.json$/.test(name)) continue;
    const relative = path.join(".quality-review/reports", name);
    try {
      const report = await readReport(path.resolve(relative));
      if (report) reports.push({ relative, report });
    } catch {
      // 不可解析的报告不参与覆盖
    }
  }
  return reports;
}

function reportIsTrustworthy(report) {
  return (
    report.schemaVersion === REVIEW_SCHEMA_VERSION &&
    report.rubricVersion === RUBRIC_VERSION &&
    report.verdict === "pass" &&
    (!Array.isArray(report.blockingFindings) || report.blockingFindings.length === 0) &&
    Boolean(report.reviewer?.agent) &&
    Boolean(report.reviewer?.model)
  );
}

// 多 commit push / PR 场景：CI 的聚合 diff 不会与任何单次提交的 reviewId 匹配。
// 回退策略：当前范围内每篇 topic 只要被某份已提交的 pass 报告按 contentHash 精确覆盖即可通过。
async function verifyByCoverage(review) {
  const reports = await listCommittedReports();
  const coverage = new Map();
  const missing = [];
  for (const target of review.request.targets) {
    let source = null;
    for (const { relative, report } of reports) {
      if (!reportIsTrustworthy(report)) continue;
      const entry = (report.reviewedTopics ?? []).find(
        (topic) => topic.ref === target.ref && topic.contentHash === target.contentHash,
      );
      if (!entry || entry.verdict !== "pass") continue;
      const entryErrors = [];
      validateScores(entryErrors, entry.ref, { overall: entry.score, ...(entry.dimensions ?? {}) });
      validateFactFindings(entryErrors, entry);
      if (entryErrors.length) continue;
      source = relative;
      break;
    }
    if (source) coverage.set(target.ref, source);
    else missing.push(target.ref);
  }
  return { ok: missing.length === 0 && coverage.size > 0, coverage, missing };
}

function reportGitDrift(relativeReportPath) {
  let status = "";
  try {
    status = execFileSync("git", ["status", "--porcelain", "--", relativeReportPath], { encoding: "utf8" });
  } catch {
    return null;
  }
  const line = status.split(/\r?\n/).find(Boolean);
  if (!line) return null;
  const stagedFlag = line[0];
  const worktreeFlag = line[1];
  if (stagedFlag === "?" ) {
    return `report ${relativeReportPath} is untracked — the commit will not include it`;
  }
  if (worktreeFlag !== " ") {
    return `report ${relativeReportPath} has unstaged edits — the staged version differs from what was verified`;
  }
  return null;
}

async function main() {
  const options = normalizeOptions(parseArgs());
  const review = await buildReviewRequest(options);

  if (!review.request.reviewedTargetCount) {
    console.log(`LLM quality review skipped: no targets for env=${options.env}, scope=${options.scope}.`);
    return;
  }

  const reportPath = options.report ? path.resolve(options.report) : expectedReportPath(review.request);
  const report = await readReport(reportPath);
  if (!report) {
    const coverage = await verifyByCoverage(review);
    if (coverage.ok) {
      if (options.staged && !options.report) {
        for (const source of new Set(coverage.coverage.values())) {
          const drift = reportGitDrift(source);
          if (drift) {
            fail(drift, [`Run: git add ${source}`]);
            return;
          }
        }
      }
      console.log(`LLM quality review verified via per-topic coverage (${coverage.coverage.size} topic(s)):`);
      for (const [ref, source] of coverage.coverage) console.log(`- ${ref} <= ${source}`);
      return;
    }
    fail(`missing report ${path.relative(process.cwd(), reportPath)} and no per-topic coverage from committed reports`, [
      coverage.missing.length
        ? `uncovered topics: ${coverage.missing.join(", ")}`
        : "no committed reports matched the current content hashes",
      `Run: npm run quality:llm:packet -- --env=${options.env} --scope=${options.scope} --sample=${options.sampleSize}`,
      "Then run quality:llm:run (or your own agent) to produce the JSON report.",
      "Stage the report under .quality-review/reports/ before committing.",
      "If a report for these topics already exists under a different reviewId, the content was edited after review — re-generate the packet and re-review.",
    ]);
    return;
  }

  if (options.staged && !options.report) {
    const relativeReportPath = path.relative(process.cwd(), reportPath);
    const drift = reportGitDrift(relativeReportPath);
    if (drift) {
      fail(drift, [`Run: git add ${relativeReportPath}`]);
      return;
    }
  }

  const errors = [];
  assertEqual(errors, "schemaVersion", report.schemaVersion, REVIEW_SCHEMA_VERSION);
  assertEqual(errors, "rubricVersion", report.rubricVersion, RUBRIC_VERSION);
  assertEqual(errors, "request.reviewId", report.request?.reviewId, review.request.reviewId);
  assertEqual(errors, "request.env", report.request?.env, review.request.env);
  assertEqual(errors, "request.scope", report.request?.scope, review.request.scope);
  assertEqual(errors, "request.sampleSize", report.request?.sampleSize, review.request.sampleSize);
  assertEqual(errors, "request.targetHash", report.request?.targetHash, review.request.targetHash);
  assertEqual(errors, "request.contentHash", report.request?.contentHash, review.request.contentHash);
  assertEqual(errors, "request.staticAuditHash", report.request?.staticAuditHash, review.request.staticAuditHash);

  const expectedRefs = sortedRefs(review.request.targets);
  const actualRefs = sortedRefs(report.reviewedTopics ?? []);
  if (JSON.stringify(actualRefs) !== JSON.stringify(expectedRefs)) {
    errors.push(`reviewedTopics coverage mismatch: expected ${expectedRefs.join(", ")}, got ${actualRefs.join(", ")}`);
  }

  if (!report.reviewer?.agent || !report.reviewer?.model) {
    errors.push("reviewer.agent and reviewer.model are required, but provider credentials must stay outside the repo");
  }
  if (report.verdict !== "pass") {
    errors.push(`verdict must be pass, got ${report.verdict}`);
  }
  if (Array.isArray(report.blockingFindings) && report.blockingFindings.length) {
    errors.push(`blockingFindings must be empty, got ${report.blockingFindings.length}`);
  }
  validateScores(errors, "overall", report.scores);

  const expectedHashByRef = new Map(review.request.targets.map((target) => [target.ref, target.contentHash]));
  for (const topic of report.reviewedTopics ?? []) {
    if (topic.verdict !== "pass") errors.push(`${topic.ref} verdict must be pass`);
    const expectedContentHash = expectedHashByRef.get(topic.ref);
    if (expectedContentHash && topic.contentHash !== expectedContentHash) {
      errors.push(`${topic.ref} contentHash mismatch — the topic was edited after this review`);
    }
    validateScores(errors, topic.ref, { overall: topic.score, ...(topic.dimensions ?? {}) });
    validateFactFindings(errors, topic);
  }

  if (errors.length) {
    fail(`${errors.length} report check(s) did not pass`, errors.slice(0, 12));
    if (errors.length > 12) console.error(`- ... ${errors.length - 12} more`);
    return;
  }

  console.log(`LLM quality review verified: ${review.request.reviewId}`);
  console.log(`- report: ${path.relative(process.cwd(), reportPath)}`);
  console.log(`- targets: ${review.request.reviewedTargetCount}/${review.request.fullTargetCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

