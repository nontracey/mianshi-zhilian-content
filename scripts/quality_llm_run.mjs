#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  REVIEW_SCHEMA_VERSION,
  RUBRIC_VERSION,
  buildReviewRequest,
  normalizeOptions,
  parseArgs,
  sha256,
  writeReviewPacket,
} from "./quality_llm_common.mjs";
import { JUDGE_DIMENSIONS } from "./quality_llm_judge.mjs";

const root = process.cwd();
const maxConcurrency = 4;
const requiredDimensions = JUDGE_DIMENSIONS;

function parseRunnerArgs(argv = process.argv.slice(2)) {
  const base = parseArgs(argv);
  const repeated = { extraArgs: [], baseArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--extra-arg") repeated.extraArgs.push(argv[++index]);
    else if (arg === "--base-arg") repeated.baseArgs.push(argv[++index]);
  }
  return {
    ...base,
    cli: base.cli ?? process.env.QUALITY_LLM_CLI,
    model: base.model ?? process.env.QUALITY_LLM_MODEL,
    preset: base.preset ?? "auto",
    concurrency: Number(base.concurrency ?? 2),
    retries: Number(base.retries ?? 1),
    batchSize: Number(base["batch-size"] ?? 1),
    timeoutMs: Number(base["timeout-ms"] ?? 600000),
    usePty: Boolean(base["use-pty"]),
    noDefaultExtraArgs: Boolean(base["no-default-extra-args"]),
    modelArg: base["model-arg"] ?? "--model",
    promptArg: base["prompt-arg"] ?? "-p",
    promptMode: base["prompt-mode"] ?? "flag",
    extraArgs: repeated.extraArgs,
    baseArgs: repeated.baseArgs,
  };
}

function inferPreset(cliName, preset) {
  if (preset && preset !== "auto") return preset;
  const base = cliName.split("/").pop().toLowerCase();
  if (base === "qwen" || base === "qwen-code") return "qwen";
  if (base === "gemini") return "gemini";
  if (base === "claude" || base === "claudecode" || base === "claude-code") return "claude";
  if (base === "opencode") return "opencode";
  if (base === "codex") return "codex";
  return "generic";
}

function applyPreset(cfg) {
  const preset = inferPreset(cfg.cli, cfg.preset);
  const presets = {
    // 评审任务的全部输入都内嵌在 prompt 中，评审 CLI 不需要任何工具执行权限。
    // plan = 只读/只分析模式，杜绝被评审内容里的注入文本诱导 CLI 执行命令或写文件。
    // qwen 0.18: -p/--prompt 已 deprecated（"Appended to input on stdin (if any)"，会让 CLI 等 stdin EOF 而不退出），
    // 官方推荐 positional："Defaults to one-shot; use -i/--prompt-interactive for interactive."
    qwen: {
      baseArgs: [],
      modelArg: "--model",
      promptArg: null,
      promptMode: "positional",
      extraArgs: ["--approval-mode", "plan"],
      usePty: true,
    },
    gemini: {
      baseArgs: [],
      modelArg: "--model",
      promptArg: "-p",
      promptMode: "flag",
      extraArgs: ["--approval-mode", "plan"],
      usePty: true,
    },
    claude: {
      baseArgs: ["-p"],
      modelArg: "--model",
      promptArg: null,
      promptMode: "positional",
      extraArgs: [],
      usePty: false,
    },
    opencode: {
      baseArgs: ["run"],
      modelArg: "--model",
      promptArg: null,
      promptMode: "positional",
      extraArgs: [],
      usePty: false,
    },
    codex: {
      baseArgs: ["exec", "--skip-git-repo-check"],
      modelArg: "--model",
      promptArg: null,
      promptMode: "positional",
      extraArgs: ["--sandbox", "read-only"],
      usePty: false,
    },
    generic: {
      baseArgs: [],
      modelArg: cfg.modelArg,
      promptArg: cfg.promptArg,
      promptMode: cfg.promptMode,
      extraArgs: [],
      usePty: cfg.usePty,
    },
  };
  const selected = presets[preset] ?? presets.generic;
  return {
    ...cfg,
    preset,
    baseArgs: cfg.baseArgs.length ? cfg.baseArgs : selected.baseArgs,
    modelArg: cfg.modelArg === "--model" ? selected.modelArg : cfg.modelArg,
    promptArg: cfg.promptArg === "-p" ? selected.promptArg : cfg.promptArg,
    promptMode: cfg.promptMode === "flag" ? selected.promptMode : cfg.promptMode,
    extraArgs: cfg.noDefaultExtraArgs ? cfg.extraArgs : [...selected.extraArgs, ...cfg.extraArgs],
    usePty: cfg.usePty || selected.usePty,
  };
}

function commandPath(name) {
  const result = spawnSync("command", ["-v", name], { shell: true, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\n/)[0] : "";
}

// 把 model 名称里的 `:` `/` `\` 替换成 `_`，避免 OpenAI 兼容 API 的 chain spec (如 `volcengine:deepseek-v4-pro`)
// 把输出路径误判为子目录。`default` 兜底是 `cli-preset` 组合，确保无 model 也能落到 `outputs/` 下的稳定目录。
function safeModelSegment(model, cli, preset) {
  return String(model || `${cli}-${preset || "auto"}`).replace(/[:\/\\]/g, "_");
}

// 把 topic ref (`topics/java/xxx.json`) 拍平成可作为文件名的字符串：把 `/` 换成 `__`，剥掉 `.json` 后缀，
// 避免 `outputs/<model>/<batch>/topics/java/xxx.json` 误建子目录链。ref 本身就是 topic 文件相对路径，
// 不需要再二次消毒字符；非法字符在 buildReviewRequest 阶段就已经被路径约束挡住。
function safeRefBaseName(ref) {
  return String(ref).replace(/\//g, "__").replace(/\.json$/i, "");
}

function clean(text) {
  return String(text)
    .replace(/\u0004/g, "")
    .replace(/\u0008/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/^Script started.*\n?/gm, "")
    .replace(/^Script done.*\n?/gm, "")
    .replace(/\r/g, "")
    .trim();
}

function extractJson(text) {
  const source = clean(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("CLI output did not contain a JSON object");
    return JSON.parse(source.slice(start, end + 1));
  }
}

function runProcess(command, args, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`timeout after ${timeoutMs}ms`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`exit code=${code} signal=${signal || ""} stderr=${stderr.trim()}`));
    });
  });
}

function buildCliArgs(cfg, prompt) {
  const args = [...cfg.baseArgs, ...cfg.extraArgs];
  if (cfg.model) args.push(cfg.modelArg, cfg.model);
  if (cfg.promptMode === "flag") {
    if (!cfg.promptArg) throw new Error("promptArg is required when promptMode=flag");
    args.push(cfg.promptArg, prompt);
  } else if (cfg.promptMode === "positional") {
    args.push(prompt);
  } else {
    throw new Error(`unsupported promptMode: ${cfg.promptMode}`);
  }
  return args;
}

function topicPrompt(review, item) {
  return `你是独立内容质量评审 agent。不要复用写作立场，只按事实和学习体验审查。

只返回 JSON，不要解释，不要 Markdown 代码围栏。

请求元信息：
${JSON.stringify({
  schemaVersion: REVIEW_SCHEMA_VERSION,
  rubricVersion: RUBRIC_VERSION,
  reviewId: review.request.reviewId,
  env: review.request.env,
  scope: review.request.scope,
  sampleSize: review.request.sampleSize,
}, null, 2)}

请评审下面这一篇 topic，输出一个单 topic 评审对象：

输出 JSON schema：
{
  "ref": "${item.ref}",
  "title": "${item.title}",
  "verdict": "pass | fail",
  "score": 85,
  "dimensions": {
    "accuracy": 4,
    "cognitiveOrder": 4,
    "expertVoice": 4,
    "selfContained": 4,
    "interviewUsability": 4,
    "difficultyFit": 4,
    "learnerClarity": 4,
    "coverage": 4
  },
  "factFindings": [
    { "claim": "被核验的事实断言", "verdict": "correct | wrong | suspicious | outdated", "evidence": "核验依据或无法核验原因" }
  ],
  "orderFindings": [],
  "voiceFindings": [],
  "selfContainedFindings": [],
  "clarityFindings": [],
  "coverageFindings": [],
  "followUpFindings": [],
  "blockingFindings": [],
  "notes": ""
}

硬性要求：
- score 使用 0-100；低于 85 必须 fail。
- dimensions 使用 1-5 整数；任一低于 4 必须 fail。
- factFindings 至少 3 条，覆盖定义、机制、边界/失败路径等关键事实；图、表、代码也按事实核验。
- wrong/outdated 事实必须进入 blockingFindings 且 verdict=fail。
- 如果正文无法支撑 recallPrompts 或 rubric.mustHave，verdict=fail。
- 如果语言明显模板化、讲解顺序跳跃、专家口吻不真实，verdict=fail。
- learnerClarity 要判断零基础读者是否能看懂；coverage 要按资深面试官会考的关键面判断，不要只拿本篇 rubric/recallPrompts 当标尺。

topic JSON：
${JSON.stringify(item.topic, null, 2)}
`;
}

function batchPrompt(review, items) {
  return `你是独立内容质量评审 agent。不要复用写作立场，只按事实和学习体验审查。

只返回 JSON，不要解释，不要 Markdown 代码围栏。

请求元信息：
${JSON.stringify({
  schemaVersion: REVIEW_SCHEMA_VERSION,
  rubricVersion: RUBRIC_VERSION,
  reviewId: review.request.reviewId,
  env: review.request.env,
  scope: review.request.scope,
  sampleSize: review.request.sampleSize,
  batchSize: items.length,
}, null, 2)}

请逐篇评审下面这些 topic，输出一个对象，reviews 数组必须与输入 refs 一一对应：

输出 JSON schema：
{
  "reviews": [
    {
      "ref": "输入 topic 的 ref",
      "title": "输入 topic 的 title",
      "verdict": "pass | fail",
      "score": 85,
      "dimensions": {
        "accuracy": 4,
        "cognitiveOrder": 4,
        "expertVoice": 4,
        "selfContained": 4,
        "interviewUsability": 4,
        "difficultyFit": 4,
        "learnerClarity": 4,
        "coverage": 4
      },
      "factFindings": [
        { "claim": "被核验的事实断言", "verdict": "correct | wrong | suspicious | outdated", "evidence": "核验依据或无法核验原因" }
      ],
      "orderFindings": [],
      "voiceFindings": [],
      "selfContainedFindings": [],
      "clarityFindings": [],
      "coverageFindings": [],
      "followUpFindings": [],
      "blockingFindings": [],
      "notes": ""
    }
  ]
}

硬性要求：
- reviews 必须包含下面每一个 ref，不能遗漏、合并或新增 ref。
- score 使用 0-100；低于 85 必须 fail。
- dimensions 使用 1-5 整数；任一低于 4 必须 fail。
- 每个 topic 的 factFindings 至少 3 条，覆盖定义、机制、边界/失败路径等关键事实；图、表、代码也按事实核验。
- wrong/outdated 事实必须进入该 topic 的 blockingFindings 且 verdict=fail。
- 如果正文无法支撑 recallPrompts 或 rubric.mustHave，verdict=fail。
- 如果语言明显模板化、讲解顺序跳跃、专家口吻不真实，verdict=fail。
- learnerClarity 要判断零基础读者是否能看懂；coverage 要按资深面试官会考的关键面判断，不要只拿本篇 rubric/recallPrompts 当标尺。

topic JSON 列表：
${JSON.stringify(
  items.map((item) => ({
    ref: item.ref,
    title: item.title,
    topic: item.topic,
  })),
  null,
  2,
)}
`;
}

function normalizeTopicReview(parsed, item) {
  return {
    ref: item.ref,
    title: item.title,
    // contentHash 由脚本注入而不是信任 LLM 输出，绑定评审结论与被评审内容版本。
    contentHash: item.contentHash,
    // 只有显式 pass 才算 pass：评审模型输出 needs_work / 缺字段一律按 fail 处理。
    verdict: parsed.verdict === "pass" ? "pass" : "fail",
    score: Number(parsed.score),
    dimensions: Object.fromEntries(requiredDimensions.map((key) => [key, Number(parsed.dimensions?.[key])])),
    factFindings: Array.isArray(parsed.factFindings) ? parsed.factFindings : [],
    orderFindings: Array.isArray(parsed.orderFindings) ? parsed.orderFindings : [],
    voiceFindings: Array.isArray(parsed.voiceFindings) ? parsed.voiceFindings : [],
    selfContainedFindings: Array.isArray(parsed.selfContainedFindings) ? parsed.selfContainedFindings : [],
    clarityFindings: Array.isArray(parsed.clarityFindings) ? parsed.clarityFindings : [],
    coverageFindings: Array.isArray(parsed.coverageFindings) ? parsed.coverageFindings : [],
    followUpFindings: Array.isArray(parsed.followUpFindings) ? parsed.followUpFindings : [],
    blockingFindings: Array.isArray(parsed.blockingFindings) ? parsed.blockingFindings : [],
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
  };
}

function extractBatchReviews(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.reviews)) return parsed.reviews;
  throw new Error("CLI output did not contain a reviews array");
}

async function runOneBatch(items, review, cfg, cliPath, outDir, batchIdx) {
  // taskId 仍保留：失败重试日志和后续的 stdout 链接都靠它串起来。
  // 输出文件不再以 taskId 命名：改为 `outputs/<model>/<batchIdx>/<refSafe>.json` 形态，
  // 这样 (model, batchIdx, ref) 三元组能从路径直接读到，CI 落盘核对也只看 `outputs/` 即可。
  const taskId =
    items.length === 1
      ? `${items[0].ref.replace(/[^a-z0-9]+/gi, "-")}-${sha256(items[0].ref).slice(0, 8)}`
      : `batch-${sha256(items.map((item) => item.ref).join("\n")).slice(0, 12)}`;
  const prompt = items.length === 1 ? topicPrompt(review, items[0]) : batchPrompt(review, items);
  const attempts = cfg.retries + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const tmp = mkdtempSync(path.join(tmpdir(), "quality-llm-"));
    try {
      const args = buildCliArgs(cfg, prompt);
      let raw = "";
      if (cfg.usePty && process.platform === "darwin") {
        // BSD script 才支持 `script -q file cmd args...`；Linux util-linux 语法不同，降级为直跑。
        const capture = path.join(tmp, "capture.txt");
        await runProcess("script", ["-q", capture, cliPath, ...args], { cwd: root, stdio: ["ignore", "ignore", "pipe"] }, cfg.timeoutMs);
        raw = readFileSync(capture, "utf8");
      } else {
        const result = await runProcess(cliPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }, cfg.timeoutMs);
        raw = result.stdout;
      }
      const extracted = extractJson(raw);
      const parsedReviews = items.length === 1 ? [extracted] : extractBatchReviews(extracted);
      // 输出 ref 错位是历史事故的根因：LLM 在 batch 模式下常把 ref/title 填成别的 topic，
      // 这里按 LLM 输出端最先出现的 ref 顺序回退匹配（顺序对得上就不抛），对得不上才要求 ref 字符串严格相等。
      // normalizeTopicReview 在写盘前会再覆盖一次 ref/title，所以即便这里匹配错了，磁盘文件仍然正确。
      const byRef = new Map();
      parsedReviews.forEach((parsed, parsedIndex) => {
        if (parsed?.ref && !byRef.has(parsed.ref)) byRef.set(parsed.ref, parsed);
      });
      const byOrder = parsedReviews;
      const normalized = items.map((item, itemIndex) => {
        let parsed = byRef.get(item.ref);
        let usedOrderFallback = false;
        if (!parsed) {
          parsed = byOrder[itemIndex];
          if (!parsed) throw new Error(`CLI output missing review for ${item.ref}`);
          usedOrderFallback = true;
        }
        const review = normalizeTopicReview(parsed, item);
        if (usedOrderFallback) {
          review.notes = `${review.notes ? review.notes + " | " : ""}[fallback] LLM 输出缺 ref 字段，按输入顺序回退到第 ${itemIndex + 1} 篇`.trim();
        }
        return review;
      });
      const rawPath = path.join(outDir, `${batchIdx}.raw.txt`);
      await writeFile(rawPath, clean(raw) + "\n");
      // 按 ref 一篇一文件：CI 与开发者 grep 都更直观。
      // 内层 `ref`/`title` 字段由 normalizeTopicReview 从 item 强制写回，避免 LLM 端把别人 topic 的标题错填到本篇。
      const refOutputs = [];
      for (const review of normalized) {
        const refPath = path.join(outDir, `${safeRefBaseName(review.ref)}.json`);
        await writeFile(refPath, JSON.stringify(review, null, 2) + "\n");
        refOutputs.push(refPath);
      }
      return { ok: true, items, reviews: normalized, attempts: attempt, output: outDir, refOutputs, taskId };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.log(`[RETRY] ${items.map((item) => item.ref).join(", ")} attempt ${attempt}/${attempts}: ${error.message}`);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  return { ok: false, items, attempts, error: lastError?.message ?? "unknown error", taskId };
}

async function runOneTopic(item, review, cfg, cliPath, outDir, batchIdx) {
  const result = await runOneBatch([item], review, cfg, cliPath, outDir, batchIdx);
  if (result.ok) {
    return {
      ok: true,
      item,
      review: result.reviews[0],
      attempts: result.attempts,
      output: result.output,
      refOutputs: result.refOutputs,
    };
  }
  return {
    ok: false,
    item,
    attempts: result.attempts,
    error: result.error,
  };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function runPool(items, review, cfg, cliPath, runOutDir) {
  if (cfg.batchSize <= 1) return runTopicPool(items, review, cfg, cliPath, runOutDir);
  const batches = chunk(items, cfg.batchSize);
  const results = [];
  let index = 0;
  async function worker() {
    while (index < batches.length) {
      const batchIdx = index;
      const batch = batches[index++];
      // batch 子目录用 4 位 zero-pad：批次数 < 10000 时 lex 序 = 数序，CI 翻 log 友好。
      const batchOutDir = path.join(runOutDir, String(batchIdx).padStart(4, "0"));
      await mkdir(batchOutDir, { recursive: true });
      const result = await runOneBatch(batch, review, cfg, cliPath, batchOutDir, batchIdx);
      for (const item of batch) {
        if (result.ok) {
          const topicReview = result.reviews.find((entry) => entry.ref === item.ref);
          results.push({
            ok: Boolean(topicReview),
            item,
            review: topicReview,
            attempts: result.attempts,
            output: result.output,
            refOutputs: result.refOutputs,
            error: topicReview ? undefined : `batch output missing review for ${item.ref}`,
          });
        } else {
          results.push({
            ok: false,
            item,
            attempts: result.attempts,
            error: result.error,
          });
        }
      }
      console.log(`[${result.ok ? "OK" : "FAIL"}] batch ${batchIdx} ${batch[0].ref} ... ${batch[batch.length - 1].ref} (${batch.length})`);
    }
  }
  await Promise.all(Array.from({ length: cfg.concurrency }, worker));
  return results.sort((left, right) => left.item.ref.localeCompare(right.item.ref));
}

async function runTopicPool(items, review, cfg, cliPath, runOutDir) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      const batchIdx = index - 1;
      const batchOutDir = path.join(runOutDir, String(batchIdx).padStart(4, "0"));
      await mkdir(batchOutDir, { recursive: true });
      const result = await runOneTopic(item, review, cfg, cliPath, batchOutDir, batchIdx);
      results.push(result);
      console.log(`[${result.ok ? "OK" : "FAIL"}] ${item.ref}`);
    }
  }
  await Promise.all(Array.from({ length: cfg.concurrency }, worker));
  return results.sort((left, right) => left.item.ref.localeCompare(right.item.ref));
}

function aggregateReport(review, cfg, cliPath, results) {
  const topicReviews = results.filter((result) => result.ok).map((result) => result.review);
  const failedTasks = results.filter((result) => !result.ok);
  const blockingFindings = [
    ...failedTasks.map((result) => ({
      ref: result.item.ref,
      reason: `CLI task failed after ${result.attempts} attempt(s): ${result.error}`,
    })),
    ...topicReviews.flatMap((topic) => (topic.blockingFindings ?? []).map((finding) => ({ ref: topic.ref, finding }))),
  ];

  const dimensionScores = Object.fromEntries(
    requiredDimensions.map((key) => [
      key,
      topicReviews.length ? Math.min(...topicReviews.map((topic) => Number(topic.dimensions?.[key] ?? 0))) : 0,
    ]),
  );
  const topicMinScore = topicReviews.length ? Math.min(...topicReviews.map((topic) => Number(topic.score ?? 0))) : 0;
  const verdict =
    failedTasks.length ||
    topicReviews.length !== review.request.targets.length ||
    topicReviews.some((topic) => topic.verdict !== "pass") ||
    blockingFindings.length
      ? "fail"
      : "pass";

  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    rubricVersion: RUBRIC_VERSION,
    generatedAt: new Date().toISOString(),
    request: review.request,
    reviewer: {
      agent: cfg.cli,
      model: cfg.model || "CLI default configured model",
      notes: `CLI path: ${cliPath}; preset: ${cfg.preset}; concurrency: ${cfg.concurrency}; retries: ${cfg.retries}; timeoutMs: ${cfg.timeoutMs}`,
    },
    verdict,
    scores: {
      overall: topicMinScore,
      ...dimensionScores,
    },
    blockingFindings,
    reviewedTopics: topicReviews,
  };
}

function verifyGeneratedReport(options, reportPath) {
  const args = [
    "scripts/quality_llm_verify.mjs",
    `--env=${options.env}`,
    `--scope=${options.scope}`,
    `--sample=${options.sampleSize}`,
    `--report=${reportPath}`,
  ];
  if (options.diffRef) args.push(`--diff-ref=${options.diffRef}`);
  if (options.changedFilesArg) args.push(`--changed-files=${options.changedFilesArg}`);
  if (options.worktree) args.push("--worktree");
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

async function main() {
  const runnerArgs = parseRunnerArgs();
  const options = normalizeOptions(runnerArgs);
  const review = await buildReviewRequest(options);
  if (!review.request.reviewedTargetCount) {
    console.log(`No LLM review targets for env=${review.request.env}, scope=${review.request.scope}.`);
    return;
  }

  if (!runnerArgs.cli) {
    throw new Error("Choose an external review CLI with --cli <name> or QUALITY_LLM_CLI. The current Codex agent is not used as the reviewer.");
  }
  if (!Number.isInteger(runnerArgs.concurrency) || runnerArgs.concurrency < 1 || runnerArgs.concurrency > maxConcurrency) {
    throw new Error(`--concurrency must be an integer in [1, ${maxConcurrency}]`);
  }
  if (!Number.isInteger(runnerArgs.retries) || runnerArgs.retries < 0 || runnerArgs.retries > 5) {
    throw new Error("--retries must be an integer in [0, 5]");
  }
  if (!Number.isInteger(runnerArgs.batchSize) || runnerArgs.batchSize < 1 || runnerArgs.batchSize > 10) {
    throw new Error("--batch-size must be an integer in [1, 10]");
  }
  if (!Number.isInteger(runnerArgs.timeoutMs) || runnerArgs.timeoutMs < 30000) {
    throw new Error("--timeout-ms must be an integer >= 30000");
  }

  const cfg = applyPreset(runnerArgs);
  const cliPath = commandPath(cfg.cli);
  if (!cliPath) {
    throw new Error(`Required CLI not found: ${cfg.cli}. Install it or choose another --cli.`);
  }

  await writeReviewPacket(review);

  // 输出根目录改成 `outputs/<model-safe>/`：reviewer 用的 model 直接体现在路径里，
  // 不同 model / 不同 chain 切换时不会互相覆盖；旧的 `.quality-review/tmp/<reviewId>/` 链路是按 reviewId 隔离，
  // reviewId 又是内容哈希派生的，同一份内容无论用什么 model 都会进同一个目录，反而压制了多 model 对比。
  const modelSafe = safeModelSegment(cfg.model, cfg.cli, cfg.preset);
  const runOutDir = path.join(root, "outputs", modelSafe);
  await mkdir(runOutDir, { recursive: true });
  console.log(
    `Running external LLM review: cli=${cfg.cli} (${cliPath}), model=${cfg.model || "CLI default configured model"}, ` +
      `concurrency=${cfg.concurrency}, retries=${cfg.retries}, batchSize=${cfg.batchSize}, targets=${review.request.reviewedTargetCount}`,
  );

  const results = await runPool(review.topics, review, cfg, cliPath, runOutDir);
  const finalReport = aggregateReport(review, cfg, cliPath, results);
  const reportPath = path.join(root, review.request.reportPath);
  await mkdir(path.dirname(reportPath), { recursive: true });
  if (finalReport.verdict !== "pass" && existsSync(reportPath)) {
    try {
      const previous = JSON.parse(readFileSync(reportPath, "utf8"));
      if (previous?.verdict === "pass") {
        console.warn(`WARNING: overwriting an existing PASS report with a FAIL result at ${review.request.reportPath}.`);
      }
    } catch {
      // 旧文件不可解析时直接覆盖
    }
  }
  await writeFile(reportPath, JSON.stringify(finalReport, null, 2) + "\n");
  await writeFile(
    path.join(runOutDir, "run-report.json"),
    JSON.stringify(
      {
        cli: cfg.cli,
        preset: cfg.preset,
        cliPath,
        model: cfg.model || "CLI default configured model",
        modelSegment: modelSafe,
        concurrency: cfg.concurrency,
        retries: cfg.retries,
        batchSize: cfg.batchSize,
        timeoutMs: cfg.timeoutMs,
        request: review.request,
        results: results.map((result) => ({
          ref: result.item.ref,
          ok: result.ok,
          attempts: result.attempts,
          output: result.output,
          refOutputs: result.refOutputs,
          error: result.error,
        })),
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Wrote report: ${review.request.reportPath}`);
  console.log(`Run artifacts: ${path.relative(root, runOutDir)}/`);
  if (!verifyGeneratedReport(options, review.request.reportPath)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
