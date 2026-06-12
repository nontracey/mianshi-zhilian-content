import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

export const REVIEW_SCHEMA_VERSION = "1.0.0";
export const RUBRIC_VERSION = "2026-06-13";
export const DEFAULT_ENV = "production";
export const DEFAULT_SCOPE = "changed";
export const DEFAULT_SAMPLE_SIZE = "all";

const root = process.cwd();

const envConfigs = {
  production: {
    id: "production",
    manifest: "manifest.json",
    topicPrefix: "topics/",
  },
  staging: {
    id: "staging",
    manifest: "staging-manifest.json",
    topicPrefix: "staging/topics/",
  },
  draft: {
    id: "draft",
    manifest: "draft-manifest.json",
    topicPrefix: "draft/topics/",
  },
};

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const equalsIndex = body.indexOf("=");
    if (equalsIndex >= 0) {
      args[body.slice(0, equalsIndex)] = body.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[body] = next;
      index += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

export function normalizeOptions(args = {}) {
  const env = String(args.env ?? DEFAULT_ENV).trim();
  const scope = String(args.scope ?? (args.topic ? `topic:${args.topic}` : DEFAULT_SCOPE)).trim();
  const rawSampleSize = args.sample ?? args["sample-size"] ?? DEFAULT_SAMPLE_SIZE;
  const sampleSize = rawSampleSize === "all" ? "all" : Number(rawSampleSize);
  if (sampleSize !== "all" && (!Number.isInteger(sampleSize) || sampleSize < 1)) {
    throw new Error(`--sample must be "all" or a positive integer, got ${rawSampleSize}`);
  }
  return {
    env,
    scope,
    sampleSize,
    diffRef: args["diff-ref"],
    changedFilesArg: args["changed-files"],
    staged: Boolean(args.staged),
    worktree: Boolean(args.worktree),
    allowEmpty: Boolean(args["allow-empty"]),
    report: args.report,
    seed: args.seed,
  };
}

export function shortHash(value, length = 12) {
  return sha256(value).slice(0, length);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
}

export function hashJson(value) {
  return sha256(stableJson(value));
}

export async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

export async function fileSha256(file) {
  return sha256(await readFile(path.join(root, file), "utf8"));
}

async function fileExists(file) {
  try {
    await access(path.join(root, file));
    return true;
  } catch {
    return false;
  }
}

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" });
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

export function getChangedFiles(options) {
  if (options.changedFilesArg) {
    return options.changedFilesArg
      .split(/[\n,]/)
      .map((file) => file.trim())
      .filter(Boolean);
  }

  if (options.diffRef) {
    // diff-ref 解析失败必须硬错误：静默返回空会让 CI 门禁在 force-push/浅克隆时凭空放行。
    let output;
    try {
      output = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", options.diffRef], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      throw new Error(
        `Cannot resolve --diff-ref "${options.diffRef}" (${error.message.split("\n")[0]}). ` +
          "Check fetch depth / base ref; do not skip the LLM review gate silently.",
      );
    }
    return output
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
  }

  if (options.worktree) {
    return git(["diff", "--name-only", "--diff-filter=ACMR"], { allowFailure: true })
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
  }

  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { allowFailure: true })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
  if (staged.length || options.staged) return staged;

  if (process.env.GITHUB_BASE_REF) {
    return git(["diff", "--name-only", "--diff-filter=ACMR", `origin/${process.env.GITHUB_BASE_REF}...HEAD`], { allowFailure: true })
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
  }

  return [];
}

function getUnstagedFiles() {
  return git(["diff", "--name-only", "--diff-filter=ACMR"], { allowFailure: true })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function usesLocalStagedDiff(options) {
  return options.scope === "changed" && !options.changedFilesArg && !options.diffRef && !options.worktree;
}

function envList(env) {
  if (env === "all") return Object.keys(envConfigs);
  if (!envConfigs[env]) {
    throw new Error(`Unknown --env=${env}. Expected production, staging, draft, or all.`);
  }
  return [env];
}

export async function loadEnvironment(env) {
  const config = envConfigs[env];
  const manifest = await readJson(config.manifest);
  const topics = [];
  for (const domainEntry of manifest.domains ?? []) {
    const domain = await readJson(domainEntry.entry);
    for (const category of domain.categories ?? []) {
      for (const ref of category.topics ?? []) {
        if (!ref.startsWith(config.topicPrefix)) continue;
        const topic = await readJson(ref);
        topics.push({
          env,
          ref,
          id: topic.id,
          title: topic.title,
          domain: topic.domain,
          domainTitle: domain.title,
          category: topic.category,
          categoryTitle: category.title,
          difficulty: topic.difficulty,
          status: topic.status ?? env,
          topic,
        });
      }
    }
  }
  return { env, manifest, topics };
}

function normalizeTopicScope(scope) {
  if (!scope.startsWith("topic:")) return null;
  return scope.slice("topic:".length).replace(/^\.?\//, "");
}

export async function resolveTargets(options) {
  const changedFiles = options.scope === "changed" ? getChangedFiles(options) : [];
  const changedSet = new Set(changedFiles);
  const envs = envList(options.env);
  const loaded = [];
  for (const env of envs) loaded.push(await loadEnvironment(env));
  const candidates = loaded.flatMap((entry) => entry.topics);

  let fullTargets;
  const topicScope = normalizeTopicScope(options.scope);
  if (options.scope === "changed") {
    fullTargets = candidates.filter((target) => changedSet.has(target.ref));
  } else if (options.scope === "all") {
    fullTargets = candidates;
  } else if (options.scope.startsWith("domain:")) {
    const domain = options.scope.slice("domain:".length);
    fullTargets = candidates.filter((target) => target.domain === domain);
  } else if (topicScope) {
    fullTargets = candidates.filter((target) => target.ref === topicScope);
    if (!fullTargets.length && (await fileExists(topicScope))) {
      const topic = await readJson(topicScope);
      fullTargets = [
        {
          env: inferEnvFromTopicPath(topicScope),
          ref: topicScope,
          id: topic.id,
          title: topic.title,
          domain: topic.domain,
          category: topic.category,
          difficulty: topic.difficulty,
          status: topic.status ?? inferEnvFromTopicPath(topicScope),
          topic,
        },
      ];
    }
  } else {
    throw new Error(`Unknown --scope=${options.scope}. Expected changed, all, domain:<id>, or topic:<path>.`);
  }

  const deduped = Array.from(new Map(fullTargets.map((target) => [`${target.env}:${target.ref}`, target])).values())
    .sort((left, right) => `${left.env}:${left.ref}`.localeCompare(`${right.env}:${right.ref}`));

  const fullTargetHash = await hashTargets(deduped, { includeContent: true });
  const sampleSeed = options.seed ?? fullTargetHash;
  const selectedTargets = chooseSample(deduped, options.sampleSize, sampleSeed);
  const targetHash = await hashTargets(selectedTargets, { includeContent: false });
  const contentHash = await hashTargets(selectedTargets, { includeContent: true });

  return {
    changedFiles,
    fullTargets: deduped,
    selectedTargets,
    sampleSeed,
    fullTargetHash,
    targetHash,
    contentHash,
  };
}

function inferEnvFromTopicPath(ref) {
  if (ref.startsWith("staging/topics/")) return "staging";
  if (ref.startsWith("draft/topics/")) return "draft";
  return "production";
}

function chooseSample(targets, sampleSize, seed) {
  if (sampleSize === "all" || targets.length <= sampleSize) return targets;
  return [...targets]
    .sort((left, right) => {
      const leftHash = sha256(`${seed}\0${left.env}\0${left.ref}`);
      const rightHash = sha256(`${seed}\0${right.env}\0${right.ref}`);
      return leftHash.localeCompare(rightHash);
    })
    .slice(0, sampleSize)
    .sort((left, right) => `${left.env}:${left.ref}`.localeCompare(`${right.env}:${right.ref}`));
}

async function hashTargets(targets, { includeContent }) {
  const entries = [];
  for (const target of targets) {
    const entry = {
      env: target.env,
      ref: target.ref,
      id: target.id,
      title: target.title,
    };
    if (includeContent) {
      entry.contentHash = sha256(await readFile(path.join(root, target.ref), "utf8"));
    }
    entries.push(entry);
  }
  return hashJson(entries);
}

export async function loadStaticAudit(selectedTargets) {
  if (!selectedTargets.length) {
    return { supported: true, staticAuditHash: hashJson({ empty: true }), topicReports: new Map() };
  }

  const allProduction = selectedTargets.every((target) => target.env === "production");
  if (!allProduction) {
    return {
      supported: false,
      staticAuditHash: null,
      topicReports: new Map(),
      reason: "content_quality_audit.mjs currently scores production manifest only",
    };
  }

  const scriptPath = path.join(root, "scripts/content_quality_audit.mjs");
  const scriptHash = sha256(await readFile(scriptPath, "utf8"));
  const child = spawnSync(process.execPath, ["scripts/content_quality_audit.mjs", "--min-score=101", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });
  if (!child.stdout.trim()) {
    throw new Error(`Static quality audit produced no JSON output: ${child.stderr.trim()}`);
  }

  const result = JSON.parse(child.stdout);
  const byRef = new Map((result.failingTopics ?? []).map((report) => [report.ref, report]));
  const selectedReports = selectedTargets.map((target) => ({
    ref: target.ref,
    report: byRef.get(target.ref) ?? null,
  }));
  return {
    supported: true,
    staticAuditHash: hashJson({
      tool: "content_quality_audit",
      scriptHash,
      rubricVersion: RUBRIC_VERSION,
      selectedReports,
    }),
    topicReports: byRef,
  };
}

export async function buildReviewRequest(options) {
  const targetResolution = await resolveTargets(options);
  const staticAudit = await loadStaticAudit(targetResolution.selectedTargets);
  const candidateRefs = new Set(targetResolution.fullTargets.map((target) => target.ref));
  const relevantChangedFiles = targetResolution.changedFiles.filter((file) => candidateRefs.has(file));
  if (usesLocalStagedDiff(options) && relevantChangedFiles.length) {
    const unstagedRelevant = getUnstagedFiles().filter((file) => relevantChangedFiles.includes(file));
    if (unstagedRelevant.length) {
      throw new Error(
        `Reviewed topic has unstaged edits: ${unstagedRelevant.join(", ")}. ` +
          "Stage the final content or stash unstaged edits before generating/verifying the LLM review.",
      );
    }
  }
  const targets = [];
  for (const target of targetResolution.selectedTargets) {
    targets.push({
      env: target.env,
      ref: target.ref,
      id: target.id,
      title: target.title,
      domain: target.domain,
      category: target.category,
      difficulty: target.difficulty,
      status: target.status,
      // 每篇 topic 的内容哈希：支持多 commit push / PR 时用多份历史报告做联合覆盖校验。
      contentHash: await fileSha256(target.ref),
      staticAudit: staticAudit.topicReports.get(target.ref)
        ? {
            score: staticAudit.topicReports.get(target.ref).score,
            grade: staticAudit.topicReports.get(target.ref).grade,
            issues: staticAudit.topicReports.get(target.ref).issues,
            metrics: staticAudit.topicReports.get(target.ref).metrics,
          }
        : null,
    });
  }
  const requestCore = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    rubricVersion: RUBRIC_VERSION,
    env: options.env,
    scope: options.scope,
    sampleSize: options.sampleSize,
    sampleSeed: targetResolution.sampleSeed,
    changedFilesHash: hashJson(relevantChangedFiles),
    fullTargetCount: targetResolution.fullTargets.length,
    reviewedTargetCount: targetResolution.selectedTargets.length,
    targetHash: targetResolution.targetHash,
    contentHash: targetResolution.contentHash,
    staticAuditHash: staticAudit.staticAuditHash,
    targets,
  };
  const reviewId = `llm-quality-${shortHash(hashJson(requestCore), 16)}`;
  const request = {
    ...requestCore,
    reviewId,
    reportPath: `.quality-review/reports/${reviewId}.json`,
  };

  return {
    request,
    targetResolution,
    staticAudit,
    topics: targetResolution.selectedTargets.map((target) => ({
      ...request.targets.find((item) => item.ref === target.ref && item.env === target.env),
      topic: target.topic,
    })),
  };
}

export async function writeReviewPacket(review) {
  await mkdir(path.join(root, ".quality-review/requests"), { recursive: true });
  await mkdir(path.join(root, ".quality-review/reports"), { recursive: true });
  const jsonPath = `.quality-review/requests/${review.request.reviewId}.json`;
  const markdownPath = `.quality-review/requests/${review.request.reviewId}.md`;
  await writeFile(path.join(root, jsonPath), `${JSON.stringify(review, null, 2)}\n`);
  await writeFile(path.join(root, markdownPath), renderReviewPrompt(review));
  return { jsonPath, markdownPath, reportPath: review.request.reportPath };
}

export function renderReviewPrompt(review) {
  const reportTemplate = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    rubricVersion: RUBRIC_VERSION,
    generatedAt: new Date().toISOString(),
    request: review.request,
    reviewer: {
      agent: "",
      model: "",
      notes: "",
    },
    verdict: "pass",
    scores: {
      overall: 0,
      accuracy: 0,
      cognitiveOrder: 0,
      expertVoice: 0,
      selfContained: 0,
      interviewUsability: 0,
      difficultyFit: 0,
    },
    blockingFindings: [],
    reviewedTopics: review.request.targets.map((target) => ({
      ref: target.ref,
      title: target.title,
      contentHash: target.contentHash,
      verdict: "pass",
      score: 0,
      dimensions: {
        accuracy: 0,
        cognitiveOrder: 0,
        expertVoice: 0,
        selfContained: 0,
        interviewUsability: 0,
        difficultyFit: 0,
      },
      factFindings: [],
      orderFindings: [],
      voiceFindings: [],
      selfContainedFindings: [],
      blockingFindings: [],
      notes: "",
    })),
  };

  return `# LLM 内容质量评审请求

请用维护者自己的 agent / 模型完成评审。本仓库不固定 LLM provider，也不要求在 CI 中配置模型密钥。

**评审独立性**：评审会话必须是干净上下文。不要在写作/修改这批内容的同一会话里做评审；评审 agent 不应继承任何"这些内容已经写好了"的立场。

## 输入

- 请求 JSON：\`.quality-review/requests/${review.request.reviewId}.json\`
- 报告输出：\`${review.request.reportPath}\`
- reviewId：\`${review.request.reviewId}\`
- 范围：\`${review.request.env}\` / \`${review.request.scope}\`
- 抽样：${review.request.reviewedTargetCount}/${review.request.fullTargetCount}

注意：reviewId 由被评审内容的哈希派生。如果评审后又修改了 topic 内容，reviewId 会变化、本报告作废，必须重新生成请求包并重新评审。

## 评分量纲

- 总分（\`scores.overall\` 和每篇 \`score\`）：0-100。语义与 docs/knowledge-content-standard.md §8.3 对齐：90-94 = 用户能从不会学到面试可用；95+ = 优秀；**低于 85 阻断**。
- 维度分（\`dimensions.*\`）：1-5 整数。5 = 资深领域评审眼中无可挑剔；4 = 合格；**低于 4 阻断**。不要使用其他量纲。

## 评审目标

逐篇阅读请求 JSON 中的 \`topics[].topic\`，用真实领域评审口径判断静态脚本无法判断的质量：

1. \`accuracy\` 事实正确性：列出关键事实断言并核验，判断是否错误、过时、缺少成立条件或明显可疑。**事实包括图和代码**：diagram 的流程方向/状态转移、compareTable 的对比结论、code 卡代码是否真的正确且与讲解一致，都按事实核验。遇到版本、默认值、协议行为等时间敏感内容，优先用官方资料核验；无法核验时标记 \`suspicious\`。
2. \`cognitiveOrder\` 认知顺序：讲解是否符合“为什么需要它 -> 是什么 -> 核心机制 -> 例子 -> 边界/失败路径 -> 对比/取舍 -> 面试表达”的学习路径；指出先用后讲、术语跳跃、例子来得太晚等问题。
3. \`expertVoice\` 专家口吻真伪：是否有机制、条件、指标、失败模式、工程边界和取舍，而不是模板腔、百科腔或拼接腔。
4. \`selfContained\` 自包含闭环：读者只靠本 topic 正文，是否能回答 \`recallPrompts\` 和 \`rubric.mustHave\`。
5. \`interviewUsability\` 面试可用性：是否能形成可复述的 30 秒结论、机制主线和追问边界。
6. \`difficultyFit\` 难度匹配：内容深度与 \`difficulty\` 标注是否一致——difficulty 1-2 不应有入门铺垫注水或论文式展开，difficulty 4-5 必须讲透机制、失败路径和权衡，不能浅尝辄止。

## 证据要求（防止走过场）

每篇 \`reviewedTopics[].factFindings\` 至少 3 条，覆盖该 topic 最关键的事实断言（定义、机制、边界至少各一类），每条结构如下：

\`\`\`json
{ "claim": "被核验的事实断言原文或摘述", "verdict": "correct | wrong | suspicious | outdated", "evidence": "核验依据：官方文档结论 / 领域常识推理 / 无法核验的原因" }
\`\`\`

\`verdict\` 为 \`wrong\` 或 \`outdated\` 的发现必须同时进入 \`blockingFindings\`，并使整体 \`verdict\` 为 \`fail\`；\`suspicious\` 必须写明无法核验的原因。orderFindings / voiceFindings / selfContainedFindings 没有问题时可以为空数组，但 factFindings 不允许为空——评审必须留下核验痕迹。

## 阻断规则

出现任一情况，整体 \`verdict\` 必须为 \`fail\`：

- 发现关键事实错误（含图、表、代码中的错误）。
- 任一 topic 总分低于 85。
- 任一核心维度低于 4 分。
- topic 学完无法回答自己的 mustHave 或 recallPrompts。
- 语言明显模板化，像通用生成骨架，不像为当前知识点写的内容。

不要为了让提交通过而调高分数：fail 报告的正确处理方式是修复内容后重新评审，而不是修改报告。

## 输出要求

只写 JSON 报告到 \`${review.request.reportPath}\`，不要把请求 JSON 或长篇解释提交进报告。报告必须保留下面模板中的 \`request\` 对象原样不变；每篇 \`reviewedTopics[].contentHash\` 由脚本预填，不要修改或删除——它把评审结论绑定到被评审内容的精确版本。

\`\`\`json
${JSON.stringify(reportTemplate, null, 2)}
\`\`\`
`;
}

export function expectedReportPath(request) {
  return path.join(root, request.reportPath);
}

export async function readReport(reportPath) {
  if (!existsSync(reportPath)) return null;
  return JSON.parse(await readFile(reportPath, "utf8"));
}
