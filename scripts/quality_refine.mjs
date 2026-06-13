#!/usr/bin/env node
// 内容精修驱动器（spawn-per-topic）：
//   - 编排循环只活在本 Node 进程里，每篇精修 spawn 一个一次性 CLI 子进程、用完即弃，
//     从架构上根除“主 agent 长会话上下文溢出”。
//   - 目标集由 scope/topic 选择决定；确定性审计只提供上下文、验收和重试信号，
//     不把静态 >=90 当成“无需送 LLM 看”的跳过条件。
//   - 弱模型只负责“改”：CLI 只把改写后的整篇 JSON 输出到 stdout（只读/plan 模式，零写权限），
//     由本驱动校验 schema 不变量后才原子落盘；坏输出永不污染仓库。
//   - 验收门禁 = 现有 content_quality_audit.mjs（≥minScore、8 维有地板、反刷分），不放宽任何口径。
import { spawn, spawnSync } from "node:child_process";
import { mkdir, rename, rm, writeFile, appendFile } from "node:fs/promises";
import { mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, getChangedFiles, sha256 } from "./quality_llm_common.mjs";

const root = process.cwd();
const maxConcurrency = 8;

// 处理顺序：先小后大，便于早期发现问题、降低单次回滚成本（与 manual-refine 一致）。
const DOMAIN_ORDER = [
  "go", "self-media", "data-engineering", "devops", "security", "network",
  "design-pattern", "database", "os", "architecture", "python", "agent",
  "dotnet", "frontend", "java", "algorithm",
];

// ===== 内嵌精修规范（弱模型唯一参照，不读 81KB 大文档；要求只增不减）=====
const REFINE_SPEC = `你是资深技术面试内容主笔 + 领域专家。任务：把下面这一篇 topic 改写到“真人专家会认可、面试能直接用”的高质量，使其通过确定性质量审计（满分 100，合格线见下，8 个维度各有地板分，强项不能补偿短板）。

【8 个评估维度——每一项都要做到位，不能为了一项牺牲另一项】
1. 结构完整性：必须含 explain + interviewAnswer + checklist；至少一张 compareTable / diagram / code；rubric 四维权重之和=100。
2. 内容深度：每张 explain 要讲清机制/触发条件/关键指标/失败路径/工程取舍，不是清单堆砌、不是大白话复述定义。
3. 专家证据：给出具体抓手——真实函数名/类名/参数、版本边界、命令与配置项、数值量级、生产现象与定位线索。禁止“通常、一般、很重要”这类空话。
4. 讲解清晰度：遵循认知顺序——先动机/痛点 → 机制 → 具体例子 → 边界/反例 → 面试如何表达；逻辑连贯不跳跃。
5. 图示/对比：diagram 节点必须是本题专属概念（不是“输入→处理→输出”这种万能图）；compareTable 行列对齐，且每一行都含真正的结论而非同义复述。
6. 面试可用性：interviewAnswer 用三层结构——30 秒结论 → 机制要点列表 → 边界/追问应对；followUpQuestions ≥2 条，且答案是本题专属、不复述题面。
7. rubric 评估质量：mustHave 是具体知识点名词（如“本地队列+全局队列+work stealing 三层调度”），不是“能说明「X」在「Y」里的作用和判断标准”这类套娃句；commonMistakes 是真实的坑，不是泛化。
8. 模板与语言卫生：逐字消除下列 P0 模板句式（命中必改写成本题专属的具体表达）：
   - explain 结尾三段式：“把 X 放到真实场景里看…”/“判断 X 是否答到位时…”/“学透 X 的关键是…追问/复述校验”。
   - code 高亮注释套话：“这里定义示例的核心入口或结构…”/“这里给出最终结果或提前退出条件…”等。
   - rubric.mustHave：“能说明「{点}」在「{标题}」里的作用和判断标准”。
   - interviewerFocus：“考察是否能解释 X 的 a、b、c、d”这种四词排比模板。
   - followUpQuestions：“X 一般怎么定位/怎么排查”这种通用骨架但答案没有本题专属抓手。
   - 任何“今日笔记/今日练习/第 X 天/Day X”。

【准确性与时效】所有事实、版本、API、默认值、数值必须正确且贴合当前主流实践；不确定的断言宁可不写，不要编造。算法题要给正确复杂度与边界条件。

【硬性约束（违反会被驱动判失败并重试）】
- 保持 id / domain / category 完全不变；status 保持 "production"；difficulty 不得下调。
- 不得删空内容、不得整体缩水（信息量只增不减）；followUpQuestions ≥2；recallPrompts ≥1；rubric.scoreWeights 之和=100。
- 必须含 explain + interviewAnswer + checklist，且至少一张 compareTable / diagram / code 卡片。
- interviewAnswer 正文不得使用行内编号列表（如“1）… 2）…”或“：1) …”），要用 Markdown 列表（每项换行、以 - 或 1. 开头）。
- 每张 code 卡片必须标注 language；不得在 code 卡片里使用 box-drawing 字符画（┌─┐│└┘ 等），需要画图就用 diagram 卡片。
- 把 updatedAt 设为今天。
- 严禁保留任何上面列出的模板句；严禁跨 topic 照抄通用句子。`;

// ===== CLI 预设（与评审同款只读/plan：精修器只输出 JSON，不需要任何写/工具权限）=====
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
    qwen: { baseArgs: [], modelArg: "--model", promptArg: "-p", promptMode: "flag", extraArgs: ["--approval-mode", "plan"], usePty: true },
    gemini: { baseArgs: [], modelArg: "--model", promptArg: "-p", promptMode: "flag", extraArgs: ["--approval-mode", "plan"], usePty: true },
    claude: { baseArgs: ["-p"], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: [], usePty: false },
    opencode: { baseArgs: ["run"], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: [], usePty: false },
    codex: { baseArgs: ["exec", "--skip-git-repo-check"], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: ["--sandbox", "read-only"], usePty: false },
    generic: { baseArgs: [], modelArg: cfg.modelArg, promptArg: cfg.promptArg, promptMode: cfg.promptMode, extraArgs: [], usePty: cfg.usePty },
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

function clean(text) {
  return String(text)
    .replace(//g, "")
    .replace(//g, "")
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
    if (start < 0 || end <= start) throw new Error("CLI 输出里没有 JSON 对象");
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
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`timeout after ${timeoutMs}ms`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`exit code=${code} signal=${signal || ""} stderr=${stderr.trim().slice(0, 400)}`));
    });
  });
}

function buildCliArgs(cfg, prompt, model) {
  const args = [...cfg.baseArgs, ...cfg.extraArgs];
  const useModel = model ?? cfg.model;
  if (useModel) args.push(cfg.modelArg, useModel);
  if (cfg.promptMode === "flag") {
    if (!cfg.promptArg) throw new Error("promptMode=flag 时必须有 promptArg");
    args.push(cfg.promptArg, prompt);
  } else if (cfg.promptMode === "positional") {
    args.push(prompt);
  } else {
    throw new Error(`unsupported promptMode: ${cfg.promptMode}`);
  }
  return args;
}

// ===== 模型降级链：主用模型频繁不可用就自动降到下一个，最后兜底 =====
function makeModelState(chain, degradeAfter) {
  return { chain: chain.length ? chain : [undefined], index: 0, consecutive: 0, degradeAfter };
}
function currentModel(modelState) {
  return modelState.chain[modelState.index];
}
// 只有“可用性失败”（进程超时/非零退出/端点不可用）才计入降级；
// “内容失败”（模型出了 JSON 但没过校验）属于该篇正常重试，不触发降级。
function noteModelResult(modelState, result) {
  if (result.ok) {
    modelState.consecutive = 0;
    return;
  }
  if (!result.availabilityFailure) return;
  modelState.consecutive += 1;
  if (modelState.consecutive >= modelState.degradeAfter && modelState.index < modelState.chain.length - 1) {
    modelState.index += 1;
    modelState.consecutive = 0;
    console.log(`[DEGRADE] 主用模型频繁不可用，降级到：${currentModel(modelState) ?? "CLI 默认"}（链 ${modelState.index + 1}/${modelState.chain.length}）`);
  }
}

// ===== 确定性审计（唯一事实源 + 验收门禁）=====
function runAudit(minScore) {
  const result = spawnSync(
    process.execPath,
    ["scripts/content_quality_audit.mjs", "--json", `--min-score=${minScore}`],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (!result.stdout) {
    throw new Error(`审计未产出结果：${result.stderr || `exit ${result.status}`}`);
  }
  const audit = JSON.parse(result.stdout);
  audit.failingMap = new Map((audit.failingTopics ?? []).map((topic) => [topic.ref, topic]));
  audit.scoreMap = new Map((audit.allTopics ?? []).map((topic) => [topic.ref, topic.score]));
  return audit;
}

// 把 duplicateLanguageIssues（形如 "5x <句子> :: ref1 | ref2 | ..."）反向索引到每个 ref。
function templatesByRef(audit) {
  const map = new Map();
  for (const line of audit.duplicateLanguageIssues ?? []) {
    const match = line.match(/^(\d+)x\s([\s\S]*?)\s::\s(.*)$/);
    if (!match) continue;
    const count = Number(match[1]);
    const sentence = match[2];
    const refs = match[3]
      .split("|")
      .map((part) => part.trim())
      .map((part) => part.replace(/\s*\.\.\..*$/, "").trim())
      .filter((part) => part.startsWith("topics/"));
    for (const ref of refs) {
      if (!map.has(ref)) map.set(ref, []);
      map.get(ref).push({ count, sentence });
    }
  }
  return map;
}

function buildRefinePrompt(topic, failingInfo, templates, minScore, deterministicScore) {
  const issues = failingInfo?.issues ?? [];
  const tmpl = templates ?? [];
  const issueBlock = issues.length
    ? issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
    : "（确定性审计未列出扣分明细，可能已经达到静态阈值；这不是内容达标证明。请按上面 8 维重新做专家级审读，找出静态规则遗漏的事实薄弱、表达空泛、结构不顺、面试不可用、图表泛化、追问浅等问题。）";
  const templateBlock = tmpl.length
    ? `\n【跨 topic 模板句——下列句子在多篇里逐字重复，必须改写成本题专属的具体表达，禁止照抄】\n${tmpl
        .map((entry) => `- （在 ${entry.count} 篇里重复）${entry.sentence}`)
        .join("\n")}\n`
    : "";
  return `${REFINE_SPEC}

【本篇当前确定性审计分】${deterministicScore ?? failingInfo?.score ?? "?"}/100，静态验收线 ${minScore}。
静态分数只是验收兜底，不是跳过理由。你必须先在内部按真人专家口径重新评分和找问题，再直接输出精修后的完整 JSON；不要输出评分过程。

【本篇被扣分的具体缺口（务必逐条消除）】
${issueBlock}
${templateBlock}
【输出要求】只输出改写后的完整 topic JSON 对象，从 { 开始到 } 结束。不要解释、不要 markdown 代码围栏、不要任何额外文字。

【当前 topic JSON】
${JSON.stringify(topic, null, 2)}
`;
}

// 落盘前的 schema 不变量：只防“身份被改 / 内容被掏空 / 结构损坏”，质量好坏交给审计判。
function checkInvariants(original, parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "输出不是 JSON 对象";
  for (const key of ["id", "domain", "category"]) {
    if (parsed[key] !== original[key]) return `${key} 被改动（${original[key]} -> ${parsed[key]}）`;
  }
  if (parsed.status !== "production") return `status 必须保持 production，实际为 ${parsed.status}`;
  if (!Array.isArray(parsed.learningCards) || parsed.learningCards.length === 0) return "learningCards 为空";
  if (Array.isArray(original.recallPrompts) && original.recallPrompts.length >= 1) {
    if (!Array.isArray(parsed.recallPrompts) || parsed.recallPrompts.length < 1) return "recallPrompts 丢失";
  }
  // 复刻 validate_content.mjs 的关键硬规则，确保精修产物也能通过 `npm run validate`（CI 仍跑全量）。
  const cards = parsed.learningCards;
  const types = new Set(cards.map((card) => card.type));
  for (const required of ["explain", "interviewAnswer", "checklist"]) {
    if (!types.has(required)) return `缺少必备卡片：${required}`;
  }
  if (!cards.some((card) => ["compareTable", "diagram", "code"].includes(card.type))) {
    return "缺少 compareTable / diagram / code 之一";
  }
  for (const card of cards) {
    if (card.type === "interviewAnswer" && /(^|[：:；;。])\s*1[）)]/.test(card.content ?? "")) {
      return `interviewAnswer 含行内编号列表（用 Markdown 列表代替）：${card.title ?? ""}`;
    }
    if (card.type === "code" && !card.language) return `code 卡片缺 language：${card.title ?? ""}`;
  }
  if (!cards.some((card) => card.type === "interviewAnswer" && Array.isArray(card.followUpQuestions) && card.followUpQuestions.length >= 2)) {
    return "interviewAnswer.followUpQuestions 需 ≥2";
  }
  const weights = parsed.rubric?.scoreWeights;
  if (weights) {
    const sum = (weights.coverage ?? 0) + (weights.accuracy ?? 0) + (weights.interviewExpression ?? 0) + (weights.depth ?? 0);
    if (sum !== 100) return `rubric.scoreWeights 之和必须=100，实际 ${sum}`;
  }
  const originalLen = JSON.stringify(original).length;
  const newLen = JSON.stringify(parsed).length;
  if (newLen < originalLen * 0.6) return `内容疑似被截断/掏空（${newLen} < 原文 ${originalLen} 的 60%）`;
  return null;
}

async function writeTopicAtomic(ref, parsed) {
  const abs = path.join(root, ref);
  const tmp = `${abs}.refine.tmp`;
  await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`);
  await rename(tmp, abs);
}

// writeTo 不为空时写到该路径（预览模式，不动仓库）；否则原子写回仓库 ref。
async function refineOneTopic(ref, audit, templates, cfg, cliPath, runDir, minScore, model, writeTo) {
  const original = JSON.parse(readFileSync(path.join(root, ref), "utf8"));
  const prompt = buildRefinePrompt(original, audit.failingMap.get(ref), templates.get(ref), minScore, audit.scoreMap.get(ref));
  const attempts = cfg.retries + 1;
  let lastError = null;
  let availabilityFailure = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const tmp = mkdtempSync(path.join(tmpdir(), "quality-refine-"));
    try {
      const args = buildCliArgs(cfg, prompt, model);
      let raw = "";
      try {
        if (cfg.usePty && process.platform === "darwin") {
          const capture = path.join(tmp, "capture.txt");
          await runProcess("script", ["-q", capture, cliPath, ...args], { cwd: root, stdio: ["ignore", "ignore", "pipe"] }, cfg.timeoutMs);
          raw = readFileSync(capture, "utf8");
        } else {
          const result = await runProcess(cliPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }, cfg.timeoutMs);
          raw = result.stdout;
        }
      } catch (spawnError) {
        availabilityFailure = true; // 进程级失败：超时 / 非零退出 / 端点不可用 -> 计入降级信号
        throw spawnError;
      }
      availabilityFailure = false; // 进程已正常产出 -> 不是可用性问题
      const parsed = extractJson(raw);
      const bad = checkInvariants(original, parsed);
      if (bad) throw new Error(`schema 不变量失败：${bad}`);
      if (writeTo) {
        await mkdir(path.dirname(writeTo), { recursive: true });
        await writeFile(writeTo, `${JSON.stringify(parsed, null, 2)}\n`);
      } else {
        await writeTopicAtomic(ref, parsed);
      }
      await writeFile(path.join(runDir, `${ref.replace(/[^a-z0-9]+/gi, "-")}.raw.txt`), `${clean(raw)}\n`).catch(() => {});
      return { ok: true, attempts: attempt, availabilityFailure: false };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) console.log(`[RETRY] ${ref} ${attempt}/${attempts}: ${error.message}`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  return { ok: false, attempts, error: lastError?.message ?? "unknown error", availabilityFailure };
}

function orderByDomain(refs) {
  const rank = (ref) => {
    const domain = ref.split("/")[1];
    const index = DOMAIN_ORDER.indexOf(domain);
    return index < 0 ? DOMAIN_ORDER.length : index;
  };
  return [...refs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function applyScope(failingRefs, scope, options) {
  if (scope === "all") return failingRefs;
  if (scope.startsWith("domain:")) {
    const domain = scope.slice("domain:".length);
    return failingRefs.filter((ref) => ref.split("/")[1] === domain);
  }
  if (scope === "changed") {
    const changed = new Set(getChangedFiles(options).filter((file) => file.startsWith("topics/")));
    return failingRefs.filter((ref) => changed.has(ref));
  }
  throw new Error(`unknown --scope=${scope}（用 all | changed | domain:<id>）`);
}

function parseTopicList(args) {
  const items = [];
  if (args.topic) items.push(String(args.topic));
  if (args.topics) items.push(...String(args.topics).split(/[\n,]/));
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^\.\//, ""));
}

function resolveTargetRefs(audit, scope, options, topicFilters) {
  const allRefs = audit.allTopics.map((topic) => topic.ref);
  const scopedRefs = applyScope(allRefs, scope, options);
  if (!topicFilters.length) return orderByDomain(scopedRefs);

  const scopedSet = new Set(scopedRefs);
  const knownSet = new Set(allRefs);
  const requested = [...new Set(topicFilters)];
  const missing = requested.filter((ref) => !knownSet.has(ref));
  if (missing.length) throw new Error(`找不到 topic：${missing.join(", ")}`);

  const outsideScope = requested.filter((ref) => !scopedSet.has(ref));
  if (outsideScope.length) {
    throw new Error(`下列 topic 不在 scope=${scope} 内：${outsideScope.join(", ")}`);
  }
  return orderByDomain(requested);
}

async function refinePool(targets, audit, templates, cfg, cliPath, runDir, minScore, progressPath, modelState, counters) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < targets.length) {
      const ref = targets[index++];
      const model = currentModel(modelState);
      const result = await refineOneTopic(ref, audit, templates, cfg, cliPath, runDir, minScore, model);
      noteModelResult(modelState, result);
      results.push({ ref, ...result });
      counters.processed += 1;
      if (result.ok) counters.written += 1;
      else counters.failed += 1;
      await appendFile(
        progressPath,
        `${JSON.stringify({ ref, status: result.ok ? "written" : "failed", attempts: result.attempts, model: model ?? "default", error: result.error, ts: new Date().toISOString() })}\n`,
      );
      const domain = ref.split("/")[1];
      console.log(
        `[${counters.processed}/${counters.total} ✓${counters.written} ✗${counters.failed} | ${domain} | m=${model ?? "默认"}] ` +
          `${result.ok ? "OK  " : "FAIL"} ${ref}${result.error ? ` (${result.error})` : ""}`,
      );
    }
  }
  await Promise.all(Array.from({ length: cfg.concurrency }, worker));
  return results;
}

function summarizeFailingByDomain(refs) {
  const byDomain = new Map();
  for (const ref of refs) {
    const domain = ref.split("/")[1];
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
  }
  return orderByDomain([...byDomain.keys()]).map((domain) => `${domain}:${byDomain.get(domain)}`).join("  ");
}

function ensureInt(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} 必须是 [${min}, ${max}] 内的整数，实际 ${value}`);
  }
}

async function main() {
  const args = parseArgs();
  const scope = String(args.scope ?? "all").trim();
  const minScore = Number(args["min-score"] ?? 90);
  const concurrency = Number(args.concurrency ?? 2);
  const maxRounds = Number(args["max-rounds"] ?? 3);
  const retries = Number(args.retries ?? 1);
  const timeoutMs = Number(args["timeout-ms"] ?? 600000);
  const limit = args.limit ? Number(args.limit) : Infinity;
  const dryRun = Boolean(args["dry-run"]);
  const auditOnly = Boolean(args["audit-only"]);
  const previewMode = Boolean(args.preview);
  const topicFilters = parseTopicList(args);
  const degradeAfter = Number(args["degrade-after"] ?? 3);
  const options = {
    scope,
    diffRef: args["diff-ref"],
    changedFilesArg: args["changed-files"],
    staged: Boolean(args.staged),
    worktree: Boolean(args.worktree),
  };
  // 模型降级链：--model-chain "m1,m2,m3" 优先；否则退回单个 --model；都没有则用 CLI 默认。
  const modelChain = args["model-chain"]
    ? String(args["model-chain"]).split(",").map((entry) => entry.trim()).filter(Boolean)
    : (args.model ?? process.env.QUALITY_LLM_MODEL ? [args.model ?? process.env.QUALITY_LLM_MODEL] : [undefined]);

  ensureInt(concurrency, "concurrency", 1, maxConcurrency);
  ensureInt(maxRounds, "max-rounds", 1, 10);
  ensureInt(retries, "retries", 0, 5);
  ensureInt(degradeAfter, "degrade-after", 1, 50);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 30000) throw new Error("--timeout-ms 必须是 >=30000 的整数");
  if (!Number.isInteger(minScore) || minScore < 1 || minScore > 100) throw new Error("--min-score 必须在 [1,100]");

  // 审计预览：不调用任何 LLM，只看当前还差哪些篇、各篇缺口。
  if (auditOnly) {
    const audit = runAudit(minScore);
    const targetRefs = resolveTargetRefs(audit, scope, options, topicFilters);
    const targetSet = new Set(targetRefs);
    const scoped = audit.failingTopics.map((topic) => topic.ref).filter((ref) => targetSet.has(ref));
    console.log(`确定性审计：overall ${audit.overallScore}/100，全量 failing ${audit.failingTopicCount}，scope=${scope} 目标 ${targetRefs.length} 篇，未达静态线 ${scoped.length}`);
    console.log(`按域分布（scope 内）：${summarizeFailingByDomain(scoped) || "（无）"}`);
    for (const ref of orderByDomain(scoped).slice(0, 40)) {
      const info = audit.failingMap.get(ref);
      console.log(`- ${info.score}/100  ${ref}`);
      for (const issue of (info.issues ?? []).slice(0, 2)) console.log(`      * ${issue}`);
    }
    if (scoped.length > 40) console.log(`... 其余 ${scoped.length - 40} 篇省略`);
    return;
  }

  const cli = args.cli ?? process.env.QUALITY_LLM_CLI;
  if (!cli) {
    throw new Error(
      "必须用 --cli <claude|codex|qwen|gemini|opencode|generic> 指定精修 CLI（或设 QUALITY_LLM_CLI）。\n" +
        "示例：npm run quality:refine -- --cli claude --model minimax-m3 --scope domain:go --concurrency 3",
    );
  }
  const cfg = applyPreset({
    cli,
    model: args.model ?? process.env.QUALITY_LLM_MODEL,
    preset: args.preset ?? "auto",
    concurrency,
    retries,
    timeoutMs,
    baseArgs: [],
    extraArgs: [],
    modelArg: args["model-arg"] ?? "--model",
    promptArg: args["prompt-arg"] ?? "-p",
    promptMode: args["prompt-mode"] ?? "flag",
    usePty: Boolean(args["use-pty"]),
    noDefaultExtraArgs: Boolean(args["no-default-extra-args"]),
  });
  const cliPath = commandPath(cfg.cli);
  if (!cliPath) throw new Error(`找不到 CLI：${cfg.cli}。请先安装或换一个 --cli。`);

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha256(scope).slice(0, 6)}`;
  const runDir = path.join(root, ".quality-refine", runId);
  await mkdir(runDir, { recursive: true });
  const progressPath = path.join(runDir, "progress.jsonl");
  const modelState = makeModelState(modelChain, degradeAfter);

  // 测试/预览模式：精修单篇，结果写到 .quality-refine/preview/（不动仓库），打印路径供 sh 渲染。
  if (previewMode) {
    const audit = runAudit(minScore);
    const templates = templatesByRef(audit);
    const candidates = resolveTargetRefs(audit, scope, options, topicFilters);
    let ref = candidates[0];
    if (!ref) {
      throw new Error(`scope=${scope} 内没有可预览 topic。`);
    }
    const outPath = path.join(root, ".quality-refine", "preview", `${ref.replace(/[^a-z0-9]+/gi, "-")}.json`);
    console.log(`预览精修单篇：${ref}（当前分 ${audit.scoreMap.get(ref)}/100），model=${currentModel(modelState) ?? "CLI 默认"}`);
    const result = await refineOneTopic(ref, audit, templates, cfg, cliPath, runDir, minScore, currentModel(modelState), outPath);
    if (!result.ok) {
      console.error(`预览失败：${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`PREVIEW_OUTPUT=${path.relative(root, outPath)}`); // 供 sh 解析渲染
    return;
  }

  console.log(
    `精修启动：cli=${cfg.cli} (${cliPath})，模型链=[${modelChain.map((entry) => entry ?? "CLI默认").join(" → ")}]（频繁不可用降级阈值 ${degradeAfter}），` +
      `scope=${scope}${topicFilters.length ? ` topics=${topicFilters.length}` : " topics=scope全部"}，concurrency=${cfg.concurrency}，maxRounds=${maxRounds}，minScore=${minScore}`,
  );

  // 目标集由 scope/topic 选择决定；静态分数只作为上下文，不作为第一轮跳过条件。
  const initialAudit = runAudit(minScore);
  const targetRefs = resolveTargetRefs(initialAudit, scope, options, topicFilters);
  if (!targetRefs.length) throw new Error(`scope=${scope} 内没有可精修 topic。`);
  const targetSet = new Set(targetRefs);
  const initialFailing = new Set(initialAudit.failingTopics.map((topic) => topic.ref).filter((ref) => targetSet.has(ref)));
  console.log(
    `起始：目标 ${targetRefs.length} 篇（第一轮都会送 LLM 精修），其中静态 <${minScore} ${initialFailing.size} 篇  ` +
      `[${summarizeFailingByDomain([...initialFailing]) || "无"}]`,
  );

  // 跨轮状态：bestScore 用于检测“连续无提升 -> 放弃，避免死循环”。
  const state = new Map(targetRefs.map((ref) => [ref, {
    attempts: 0,
    bestScore: initialAudit.scoreMap.get(ref) ?? 0,
    noImprove: 0,
  }]));
  const stuck = new Set();

  for (let round = 1; round <= maxRounds; round += 1) {
    const audit = runAudit(minScore);
    const templates = templatesByRef(audit);
    const firstPass = targetRefs.filter((ref) => !stuck.has(ref) && state.get(ref).attempts === 0);
    const retryCandidates = targetRefs.filter((ref) => !stuck.has(ref) && state.get(ref).attempts > 0 && audit.failingMap.has(ref));

    const retrying = [];
    for (const ref of retryCandidates) {
      const current = audit.failingMap.get(ref).score;
      const prior = state.get(ref);
      if (current > prior.bestScore) { prior.bestScore = current; prior.noImprove = 0; }
      else { prior.noImprove += 1; }
      if (prior.noImprove >= 2) { stuck.add(ref); continue; }
      retrying.push(ref);
    }

    const working = [...firstPass, ...retrying];
    if (!working.length) {
      console.log(`\n[round ${round}] 目标集已无可修目标（全部至少精修过一次且静态达标，或 stuck）。`);
      break;
    }

    const ordered = orderByDomain(working).slice(0, limit);
    console.log(
      `\n[round ${round}/${maxRounds}] 本轮 ${ordered.length} 篇  ` +
        `首次精修 ${ordered.filter((ref) => state.get(ref).attempts === 0).length}，复修 ${ordered.filter((ref) => state.get(ref).attempts > 0).length}  ` +
        `[${summarizeFailingByDomain(ordered)}]`,
    );

    if (dryRun) {
      for (const ref of ordered.slice(0, 40)) console.log(`  would refine: ${audit.scoreMap.get(ref) ?? "?"}/100  ${ref}`);
      console.log("（--dry-run：未调用 CLI、未写文件）");
      return;
    }

    for (const ref of ordered) state.get(ref).attempts += 1;
    const counters = { total: ordered.length, processed: 0, written: 0, failed: 0 };
    await refinePool(ordered, audit, templates, cfg, cliPath, runDir, minScore, progressPath, modelState, counters);
  }

  // 最终审计 + 汇总
  const finalAudit = runAudit(minScore);
  const processed = targetRefs.filter((ref) => state.get(ref).attempts > 0);
  const unprocessed = targetRefs.filter((ref) => state.get(ref).attempts === 0);
  const stillFailing = targetRefs.filter((ref) => finalAudit.failingMap.has(ref));
  const fixed = [...initialFailing].filter((ref) => !finalAudit.failingMap.has(ref));
  const summary = {
    runId,
    scope,
    selectedTargets: targetRefs.length,
    minScore,
    cli: cfg.cli,
    modelChain: modelChain.map((entry) => entry ?? "CLI default"),
    endedOnModel: currentModel(modelState) ?? "CLI default",
    startedFailing: initialFailing.size,
    processed: processed.length,
    unprocessed,
    fixed: fixed.length,
    stillFailing: stillFailing.length,
    stuck: [...stuck],
    overallScoreAfter: finalAudit.overallScore,
    stillFailingDetail: stillFailing
      .map((ref) => ({ ref, score: finalAudit.failingMap.get(ref).score, issues: finalAudit.failingMap.get(ref).issues }))
      .sort((a, b) => a.score - b.score),
  };
  await writeFile(path.join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`\n==== 精修完成 ====`);
  console.log(`已送 LLM 精修：${processed.length}/${targetRefs.length}    修好原静态未达标：${fixed.length}/${initialFailing.size}    仍 <${minScore}：${stillFailing.length}    放弃(stuck)：${stuck.size}`);
  if (unprocessed.length) console.log(`未处理：${unprocessed.length} 篇（通常是 limit/max-rounds 不足）`);
  console.log(`全量 overall：${initialAudit.overallScore} -> ${finalAudit.overallScore}`);
  console.log(`产物：${path.relative(root, runDir)}（progress.jsonl / summary.json / 每篇 raw 输出）`);
  if (stillFailing.length) {
    console.log(`仍未达标（按分数升序，前 20）：`);
    for (const item of summary.stillFailingDetail.slice(0, 20)) console.log(`- ${item.score}/100  ${item.ref}`);
  }
  if (stillFailing.length || unprocessed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
