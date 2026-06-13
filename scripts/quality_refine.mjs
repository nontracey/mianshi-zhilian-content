#!/usr/bin/env node
// 内容精修驱动器（spawn-per-topic）：
//   - 编排循环只活在本 Node 进程里，每篇精修 spawn 一个一次性 CLI 子进程、用完即弃，
//     从架构上根除“主 agent 长会话上下文溢出”。
//   - 目标集由 scope/topic 选择决定；确定性审计只提供上下文、验收和重试信号，
//     不把静态 >=90 当成“无需送 LLM 看”的跳过条件。
//   - 弱模型只负责“改”：CLI 把改写后的整篇 JSON 分块写入 .quality-refine/<runId>/topic-cache/ 缓存文件
//     （auto-edit / workspace-write 沙盒，写权限限定在工作区，prompt 严格指定缓存绝对路径），
//     由本驱动校验 schema 不变量后才原子落盘到 topics/；坏输出永不污染仓库。
//   - 验收门禁 = 现有 content_quality_audit.mjs（≥minScore、8 维有地板、反刷分），不放宽任何口径。
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readdir, rename, rm, stat, writeFile, appendFile } from "node:fs/promises";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, getChangedFiles, sha256 } from "./quality_llm_common.mjs";
import { scoreTopic, buildCorpus } from "./content_quality_audit.mjs";
import {
  BLOCK_JUDGE_RUBRIC_VERSION,
  JUDGE_RUBRIC_VERSION,
  buildBlockJudgePrompt,
  buildJudgeBatchPrompt,
  buildJudgePrompt,
  normalizeJudgeReview,
  normalizeJudgeBatchReviews,
  normalizeBlockJudgeReview,
  aggregateReviews,
  judgePasses,
  acceptByJudge,
  findingsToPromptLines,
} from "./quality_llm_judge.mjs";

const root = process.cwd();
const maxConcurrency = 8;
const activeChildren = new Map();
let shutdownRequested = false;

// 处理顺序：先小后大，便于早期发现问题、降低单次回滚成本（与 manual-refine 一致）。
const DOMAIN_ORDER = [
  "go", "self-media", "data-engineering", "devops", "security", "network",
  "design-pattern", "database", "os", "architecture", "python", "agent",
  "dotnet", "frontend", "java", "algorithm",
];

// ===== 内嵌精修规范（弱模型唯一参照，不读 81KB 大文档；要求只增不减）=====
// 调用 buildRefinePrompt 时会把字面量 ${todayYmd} 替换为实际的 YYYY-MM-DD 日期串。
const REFINE_SPEC = `你是资深技术面试内容主笔 + 领域专家。任务：把下面这一篇 topic 改写到“真人专家会认可、面试能直接用”的高质量，使其通过确定性质量审计（满分 100，合格线见下，8 个维度各有地板分，强项不能补偿短板）。

【输出格式（违反任意一条会被驱动判失败并重试）】
- 你必须只输出一个 JSON 对象，第一个非空白字符必须是 \`{\`，最后一个非空白字符必须是 \`}\`。
- 禁止任何 markdown 代码围栏（不要 \`\`\`json / \`\`\`），禁止解释性前后缀，禁止任何额外文字。
- 禁止 JSON 注释（不要 //、不要 /* */），禁止 trailing comma（最后一个属性、最后一个数组元素后面禁止逗号）。
- 所有字符串必须用双引号；字符串内的双引号用 \\\\\" 转义；换行必须用 \\\\n 表示。

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

【字段结构契约（schema 不变量，任何一条违反都会被驱动判失败并重试）】
- 顶层字段：保持 id / domain / category 完全不变；status 必须保持 "production"；difficulty 不得下调；topic 原本已存在的任何字段都必须原样保留（包括但不限于 leetcodeUrl / sourceRef / prerequisites / interviewFrequency / interviewerFocus / recommendWeight / order / tags / group / summary / estimatedMinutes），不得删除、不得改键名。
- updatedAt：必须更新为 \${todayYmd}（格式 YYYY-MM-DD，短横线分隔；这是 topic 文件用的格式，与 manifest.json 的 contentVersion 点号格式不同），不要带时分秒、不要带时区。
- estimatedMinutes：是用户首次阅读该 topic 卡片所需的分钟数（一般 15-40），不是练习时长，原值合理就别动。
- learningCards：必须是非空数组；类型集合必须同时包含 explain / interviewAnswer / checklist 三类，且至少额外含一张 compareTable / diagram / code。
- learningCards.code：必须有 language 字段，取值仅限 java / python / javascript / typescript / bash / sql / json / yaml / c / cpp / go / rust 之一；禁止在 code 卡片里使用 box-drawing 字符画（┌─┐│└┘ 等），需要画图就用 diagram 卡片。
- learningCards.diagram：format 取值 mermaid / svg / image / text 之一；当 format=mermaid 时，content 必须以 \`flowchart\` 或 \`graph\` 开头并紧跟 TB|TD|BT|LR|RL 方向（例如 \`flowchart LR\`），禁止使用 subgraph / classDef / style / sequenceDiagram / classDiagram / stateDiagram / mindmap；必须提供 fallback（一句话纯文本概括），节点文案必须紧扣本 topic 主题。
- learningCards.compareTable：content 可选两种合法形态——markdown 表格字符串（content 以 \`|\` 开头）或 \`{columns:[...], rows:[[...]]}\` 结构对象；保留原 topic 用的那种形态，不要互换。
- learningCards.interviewAnswer.followUpQuestions：必须是 \`[{question, answer}]\` 对象数组，长度至少 2，禁止退化为字符串数组。
- learningCards.interviewAnswer.content：内部不得出现行内编号列表（如“1）… 2）…”或“：1) …”），要用 Markdown 列表（每项换行、以 \`-\` 或 \`1.\` 开头）。
- recallPrompts：至少 1 条；第一条必须是该 topic 最核心、面试官最常开口问的那个问题（首轮练习兼容旧版 App 用）；每条对象结构必须是 \`{id, prompt, mode}\`，id 形如 \`<topic.id>.recall.<n>\`，mode 取值仅限 text / code / voice；可选附加 expectedMinutes（数字，分钟）、difficulty（1-5）。
- rubric：必须含 mustHave（≥1 条）/ goodToHave / commonMistakes / scoreWeights 四个字段；scoreWeights 必须包含 coverage / accuracy / interviewExpression / depth 四个键，每个值是 0-100 的整数，**四个值之和必须严格等于 100**。
- 总长度：精修后用 JSON.stringify 序列化的字符串长度不得少于原 topic 的 60%（信息量只增不减）。`;

// ===== CLI 预设（auto-edit/workspace-write 允许写缓存文件，prompt 严格限定写缓存路径）=====
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
    qwen: { baseArgs: [], modelArg: "--model", promptArg: "-p", promptMode: "flag", extraArgs: ["--approval-mode", "auto-edit"], usePty: true },
    gemini: { baseArgs: [], modelArg: "--model", promptArg: "-p", promptMode: "flag", extraArgs: ["--approval-mode", "auto_edit"], usePty: true },
    claude: { baseArgs: ["-p"], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: [], usePty: false },
    opencode: { baseArgs: ["run"], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: [], usePty: false },
    codex: { baseArgs: ["exec", "--skip-git-repo-check"], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: ["--sandbox", "workspace-write"], usePty: false },
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
  // 1) 标准化：去 ANSI/控制字符、剥 markdown 围栏、去 BOM/零宽字符。
  const stripped = clean(text)
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const tryParse = (s) => {
    try {
      return { ok: true, value: JSON.parse(s) };
    } catch (err) {
      return { ok: false, error: err };
    }
  };
  // 2) 直接 parse。
  const direct = tryParse(stripped);
  if (direct.ok) return direct.value;
  // 3) 平衡花括号扫描：识别字符串/转义，找出第一个完整 {...} 子串。
  const slice = balancedJsonObjectSlice(stripped);
  if (!slice) {
    // 4) 兜底：取最外层 {...} 区间（旧实现）。
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("CLI 输出里没有 JSON 对象");
    return repairAndParseJson(stripped.slice(start, end + 1));
  }
  const sliced = tryParse(slice);
  if (sliced.ok) return sliced.value;
  // 5) 容错：去注释 + 去 trailing comma 后再 parse。
  return repairAndParseJson(slice);
}

// 在 source 中扫描第一个语义完整的 {...} 子串，正确处理双引号字符串、转义、嵌套花括号。
function balancedJsonObjectSlice(source) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return null;
}

// 容错修复：剥行/块注释、去 trailing comma，再尝试 parse。
function repairAndParseJson(source) {
  let s = source;
  // 剥行注释 // ...（仅在字符串外）
  s = stripJsonComments(s);
  // 去 trailing comma：}, 或 ], 形如  ,\s*}  /  ,\s*]
  s = s.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(s);
}

// 剥 // 行注释和 /* */ 块注释，识别字符串/转义，避免误删字符串内容。
function stripJsonComments(source) {
  let out = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      i++;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// 是否是合法的 topic 契约 JSON（白名单识别）：有 id / domain / learningCards 且与原 topic 同身份
function looksLikeTopicContract(parsed, original) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  if (typeof parsed.id !== "string" || typeof parsed.domain !== "string") return false;
  if (!Array.isArray(parsed.learningCards)) return false;
  if (original) {
    if (parsed.id !== original.id) return false;
    if (parsed.domain !== original.domain) return false;
  }
  return true;
}

// 是否是错误响应 JSON（黑名单识别）：含 code/error/message/status 等错误字段，且无 topic 核心字段
// 覆盖各家 LLM/网关常见错误格式：
//   { code: 429, message: "Too Many Requests", details: "..." }
//   { error: { type: "rate_limit_error", message: "..." } }   // Anthropic/OpenAI
//   { error: "rate_limit_exceeded", error_description: "..." } // OAuth 风格
//   { status: "error", reason: "...", retry_after: 30 }
function looksLikeErrorResponseJson(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  // 有 topic 核心字段就不是错误响应
  if (typeof parsed.id === "string" && typeof parsed.domain === "string" && Array.isArray(parsed.learningCards)) {
    return false;
  }
  const hasErrorField = parsed.error !== undefined
    || parsed.errors !== undefined
    || parsed.error_description !== undefined
    || parsed.error_message !== undefined
    || parsed.message !== undefined
    || parsed.detail !== undefined
    || parsed.details !== undefined
    || parsed.reason !== undefined;
  if (!hasErrorField) return false;
  // HTTP-style code 字段（数字状态码或带数字的字符串）
  const codeRaw = parsed.code ?? parsed.status ?? parsed.statusCode ?? parsed.status_code ?? parsed.httpStatus;
  const codeNum = typeof codeRaw === "number" ? codeRaw : (typeof codeRaw === "string" ? Number(codeRaw) : NaN);
  if (Number.isFinite(codeNum) && codeNum >= 400 && codeNum < 600) return true;
  // 常见错误状态字符串
  const statusStr = typeof parsed.status === "string" ? parsed.status.toLowerCase() : "";
  if (statusStr === "error" || statusStr === "failed" || statusStr === "fail") return true;
  // error 字段是对象（OpenAI/Anthropic 风格）或字符串
  if (typeof parsed.error === "string" && parsed.error.length) return true;
  if (parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error)) return true;
  // retry_after / retryAfter 是限流响应的强特征
  if (parsed.retry_after !== undefined || parsed.retryAfter !== undefined || parsed["Retry-After"] !== undefined) return true;
  return false;
}

// 从错误响应 JSON 提取一条人类可读的摘要
function summarizeErrorResponse(parsed) {
  if (!parsed || typeof parsed !== "object") return "";
  const code = parsed.code ?? parsed.status ?? parsed.statusCode ?? parsed.status_code ?? parsed.httpStatus;
  const msg = parsed.message
    ?? parsed.error_message
    ?? parsed.error_description
    ?? parsed.detail
    ?? parsed.details
    ?? parsed.reason
    ?? (typeof parsed.error === "string" ? parsed.error : parsed.error?.message)
    ?? "";
  const retryAfter = parsed.retry_after ?? parsed.retryAfter ?? parsed["Retry-After"];
  const parts = [];
  if (code !== undefined) parts.push(`code=${code}`);
  if (msg) parts.push(String(msg).slice(0, 200));
  if (retryAfter !== undefined) parts.push(`retry_after=${retryAfter}`);
  return parts.join(" ").trim();
}

// 文本兜底（仅在 JSON 解析失败、无法用结构化判断时使用）
function looksLikeAvailabilityFailureText(text) {
  return availabilityFailureMatch(text) !== null;
}

// 返回首个命中的可用性关键词及其上下文片段，便于失败诊断；未命中返回 null。
function availabilityFailureMatch(text) {
  const cleaned = clean(text);
  const re = /(rate.?limit|too many requests|\b429\b|\b50[023]\b|quota exceeded|throttl|overloaded|service busy|server busy|temporar(?:y|ily) unavailable|service unavailable|gateway timeout|connection reset|econnreset|etimedout|eai_again|enotfound|限流|请求过多|额度不足|服务繁忙|暂时不可用|网关超时)/i;
  const m = cleaned.match(re);
  if (!m) return null;
  const idx = m.index ?? 0;
  const ctxStart = Math.max(0, idx - 40);
  const ctxEnd = Math.min(cleaned.length, idx + m[0].length + 40);
  const context = cleaned.slice(ctxStart, ctxEnd).replace(/\s+/g, " ");
  return { keyword: m[0], context, position: idx, totalLen: cleaned.length };
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function tailLine(text) {
  const lines = clean(text).split(/\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1)?.slice(0, 180) ?? "";
}

function fileSizeLabel(file) {
  if (!file) return "";
  try {
    const size = statSync(file).size;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
    if (size >= 1024) return `${Math.round(size / 1024)}KB`;
    return `${size}B`;
  } catch {
    return "0B";
  }
}

function killChildProcess(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function terminateActiveChildren(signal = "SIGTERM") {
  for (const [pid, child] of activeChildren.entries()) {
    console.log(`[INTERRUPT] 终止外部 CLI pid=${pid} signal=${signal}`);
    killChildProcess(child, signal);
  }
}

function makeInterruptedError(signal = "SIGINT") {
  const error = new Error(`interrupted by ${signal}`);
  error.interrupted = true;
  return error;
}

function installSignalHandlers() {
  let interrupted = false;
  const handle = (signal) => {
    shutdownRequested = true;
    if (interrupted) {
      console.log(`[INTERRUPT] 再次收到 ${signal}，强制退出。`);
      terminateActiveChildren("SIGKILL");
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
    interrupted = true;
    console.log(`\n[INTERRUPT] 收到 ${signal}，正在停止当前精修任务和外部 CLI。`);
    terminateActiveChildren("SIGTERM");
    setTimeout(() => {
      terminateActiveChildren("SIGKILL");
      process.exit(signal === "SIGINT" ? 130 : 143);
    }, 3000).unref();
  };
  process.once("SIGINT", () => handle("SIGINT"));
  process.once("SIGTERM", () => handle("SIGTERM"));
}

function runProcess(command, args, options, timeoutMs, progress = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      detached: process.platform !== "win32",
    });
    if (child.pid) activeChildren.set(child.pid, child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const startedAt = Date.now();
    const heartbeatMs = progress.heartbeatMs ?? 10000;
    const label = progress.label ?? command;
    const outputPath = progress.outputPath;
    const outputKind = outputPath ? "capture" : "stdout";
    const stopTimers = () => {
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
    };
    const printHeartbeat = (kind = "WAIT", force = false) => {
      if (progress.suppressHeartbeat && !force) return;
      const elapsed = Date.now() - startedAt;
      const outputSize = outputPath ? fileSizeLabel(outputPath) : `${stdout.length}B`;
      const stderrTail = tailLine(stderr);
      console.log(
        `[${kind}] ${label} elapsed=${formatDuration(elapsed)} / timeout=${formatDuration(timeoutMs)} ` +
          `${outputKind}=${outputSize} stderr=${stderr.length}B${stderrTail ? ` last="${stderrTail}"` : ""}`,
      );
    };
    const timer = setTimeout(() => {
      timedOut = true;
      printHeartbeat("TIMEOUT", true);
      killChildProcess(child, "SIGTERM");
      setTimeout(() => killChildProcess(child, "SIGKILL"), 3000).unref();
    }, timeoutMs);
    const heartbeat = heartbeatMs > 0 && !progress.suppressHeartbeat
      ? setInterval(() => printHeartbeat(), heartbeatMs)
      : null;
    heartbeat?.unref();
    if (!progress.suppressSpawn) {
      console.log(`[SPAWN] ${label} pid=${child.pid ?? "?"} timeout=${formatDuration(timeoutMs)}`);
    }
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      stopTimers();
      if (child.pid) activeChildren.delete(child.pid);
      reject(shutdownRequested ? makeInterruptedError() : error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      stopTimers();
      if (child.pid) activeChildren.delete(child.pid);
      const elapsed = Date.now() - startedAt;
      if (shutdownRequested) {
        reject(makeInterruptedError(signal || "SIGINT"));
      } else if (timedOut) {
        reject(new Error(`timeout after ${timeoutMs}ms`));
      } else if (code === 0) {
        if (!progress.suppressDone) {
          console.log(`[DONE] ${label} elapsed=${formatDuration(elapsed)} ${outputKind}=${outputPath ? fileSizeLabel(outputPath) : `${stdout.length}B`}`);
        }
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`exit code=${code} signal=${signal || ""} stderr=${stderr.trim().slice(0, 400)}`));
      }
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
function makeModelState(chain, degradeAfter, windowMs) {
  return {
    chain: chain.length ? chain : [undefined],
    index: 0,
    degradeAfter,
    windowMs,
    failures: [], // 时间戳数组：仅在窗口内频繁可用性失败才降级
  };
}
function currentModel(modelState) {
  return modelState.chain[modelState.index];
}
// 只有“可用性失败”（进程超时/非零退出/端点限流/不可用）才计入降级；
// “内容失败”（模型出了 JSON 但没过校验）属于该篇正常重试，不触发降级。
// 用滑动窗口（默认 60s）判断：只有“短时间内连续频繁”可用性失败才降级，避免偶发 429 立刻切模型。
function pruneWindow(timestamps, windowMs, now) {
  const cutoff = now - windowMs;
  while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
}
function noteModelResult(modelState, result) {
  const now = Date.now();
  pruneWindow(modelState.failures, modelState.windowMs, now);
  if (result.ok) return; // 成功不重置——窗口里其他失败仍然要计数，自然过期即可
  if (!result.availabilityFailure) return;
  modelState.failures.push(now);
  if (modelState.failures.length >= modelState.degradeAfter && modelState.index < modelState.chain.length - 1) {
    modelState.index += 1;
    modelState.failures = [];
    console.log(
      `[DEGRADE] ${Math.round(modelState.windowMs / 1000)}s 窗口内可用性失败 ≥ ${modelState.degradeAfter} 次，` +
        `降级到：${currentModel(modelState) ?? "CLI 默认"}（链 ${modelState.index + 1}/${modelState.chain.length}）`,
    );
  }
}

// ===== 动态判官（LLM 8 维评审；只读/plan 预设，零写/工具权限）=====
// 判官输入全内嵌 prompt、输出一个小 review JSON 到 stdout，不需要任何写或工具执行权限。
function applyJudgePreset(cli, timeoutMs) {
  const base = cli.split("/").pop().toLowerCase();
  const presets = {
    qwen: { baseArgs: [], modelArg: "--model", promptArg: "-p", promptMode: "flag", extraArgs: ["--approval-mode", "auto-edit"], usePty: true },
    gemini: { baseArgs: [], modelArg: "--model", promptArg: "-p", promptMode: "flag", extraArgs: ["--approval-mode", "auto_edit"], usePty: true },
    claude: { baseArgs: ["-p"], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: [], usePty: false },
    opencode: { baseArgs: ["run"], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: [], usePty: false },
    codex: { baseArgs: ["exec", "--skip-git-repo-check"], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: ["--sandbox", "workspace-write"], usePty: false },
    generic: { baseArgs: [], modelArg: "--model", promptArg: "-p", promptMode: "flag", extraArgs: [], usePty: false },
  };
  const key = base === "qwen-code" || base === "qwen" ? "qwen"
    : base === "claude-code" || base === "claudecode" ? "claude"
    : presets[base] ? base
    : "generic";
  return { ...presets[key], timeoutMs };
}

function buildJudgeFilePrompt(prompt, cachePath, previousError = "") {
  const retryBlock = previousError
    ? `\n【上一次输出无效，必须修正】${previousError}\n这一次不要复述原因，只写一个合法 JSON 对象到文件。\n`
    : "";
  return `${prompt}

【最终输出协议：覆盖上文所有“返回 JSON/输出 JSON”的说法】
不要在 stdout 输出 JSON，不要解释，不要 Markdown 代码围栏。把唯一的评审 JSON 对象写入下面这个绝对路径的文件：
${cachePath}

写入规则：
1. 文件初始为空。一次写不完就按追加(append)模式分片写入，最终拼起来必须是一个合法 JSON 对象。
2. 全部写完后，必须在文件末尾追加一行结束标记：
//---END---
3. 完成后 stdout 只输出一行：
WROTE:${cachePath}
${retryBlock}`;
}

function judgeProtocolError(message) {
  const error = new Error(message);
  error.judgeProtocolFailure = true;
  return error;
}

function strictParseJudgeJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw judgeProtocolError(`${label} 写入的评审 JSON 非法：${error.message}`);
  }
}

// 单次判官调用：内嵌 prompt -> 本地文件 JSON（和精修器写缓存协议一致，避免 stdout 大 JSON 被截断/污染）。
async function runJudgeProcessJson(prompt, judge, model, ref, index) {
  const attempts = judge.jsonRetries + 1;
  let previousError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const outDir = path.join(judge.cacheDir, "outputs");
    await mkdir(outDir, { recursive: true });
    const safeRef = String(ref).replace(/[^a-z0-9]+/gi, "-").slice(0, 80);
    const outputPath = path.join(outDir, `${Date.now()}-${safeRef}-${index + 1}-${attempt}-${sha256(`${ref}|${model ?? "default"}|${Math.random()}`).slice(0, 10)}.json`);
    await rm(outputPath, { force: true });
    const filePrompt = buildJudgeFilePrompt(prompt, outputPath, previousError);
    const args = buildCliArgs(judge.cfg, filePrompt, model);
    const label = `JUDGE ${ref} m=${model ?? "默认"} #${index + 1} json=${attempt}/${attempts}`;
    const progress = { suppressSpawn: true, suppressDone: true, suppressHeartbeat: true, heartbeatMs: 0, label };
    let stdout = "";
    try {
      if (judge.cfg.usePty && process.platform === "darwin") {
        const tmp = mkdtempSync(path.join(tmpdir(), "quality-judge-"));
        const capture = path.join(tmp, "judge.txt");
        try {
          await runProcess("script", ["-q", capture, judge.cliPath, ...args], { cwd: root, stdio: ["ignore", "ignore", "pipe"] }, judge.cfg.timeoutMs, progress);
          stdout = readFileSync(capture, "utf8");
        } finally {
          await rm(tmp, { recursive: true, force: true });
        }
      } else {
        const result = await runProcess(judge.cliPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }, judge.cfg.timeoutMs, progress);
        stdout = result.stdout;
      }

      let cacheContent;
      try {
        cacheContent = readFileSync(outputPath, "utf8");
      } catch (readError) {
        throw judgeProtocolError(`判官未按文件协议写入 ${path.relative(root, outputPath)}（stdout="${tailLine(stdout)}"，readError=${readError.code ?? readError.message}）`);
      }
      const endMarker = "//---END---";
      const endIdx = cacheContent.lastIndexOf(endMarker);
      if (endIdx < 0) {
        throw judgeProtocolError(`判官输出缺少 //---END--- 结束标记（file=${path.relative(root, outputPath)}，尾部="${tailLine(cacheContent)}"）`);
      }
      const jsonText = cacheContent.slice(0, endIdx).trim();
      return strictParseJudgeJson(jsonText, label);
    } catch (error) {
      previousError = error.message;
      if (attempt >= attempts) throw error;
      console.log(`[JUDGE] JSON 文件协议失败，重试 ${attempt}/${attempts} ${ref}: ${error.message}`);
    }
  }
  throw new Error(`判官 JSON 文件协议失败：${ref}`);
}

function judgeCacheFile(topic, judge) {
  const contentHash = sha256(JSON.stringify(topic));
  return path.join(judge.cacheDir, `${contentHash.slice(0, 16)}-${JUDGE_RUBRIC_VERSION}-${judge.setHash}.json`);
}

function readJudgeCache(topic, judge) {
  try {
    return JSON.parse(readFileSync(judgeCacheFile(topic, judge), "utf8"));
  } catch {
    return null;
  }
}

async function writeJudgeCache(topic, judge, review) {
  try {
    await mkdir(judge.cacheDir, { recursive: true });
    await writeFile(judgeCacheFile(topic, judge), `${JSON.stringify(review, null, 2)}\n`);
  } catch {
    // 缓存写失败不影响主流程
  }
}

// 对一篇内容跑全部判官（模型 × 数量），按 contentHash 缓存聚合结果。判官全失败时返回 null（退回静态护栏）。
async function runJudges(topic, ref, judge) {
  if (!judge?.enabled) return null;
  const cached = readJudgeCache(topic, judge);
  if (cached) return cached;
  const prompt = buildJudgePrompt(topic, ref);
  const reviews = [];
  for (const model of judge.models) {
    for (let index = 0; index < judge.count; index += 1) {
      if (shutdownRequested) break;
      try {
        const parsed = await runJudgeProcessJson(prompt, judge, model, ref, index);
        reviews.push(normalizeJudgeReview(parsed));
      } catch (error) {
        if (error.judgeProtocolFailure) throw error;
        console.log(`[JUDGE] 评审失败 ${ref} m=${model ?? "默认"} #${index + 1}: ${error.message}`);
      }
    }
  }
  if (!reviews.length) return null;
  const agg = aggregateReviews(reviews);
  await writeJudgeCache(topic, judge, agg);
  return agg;
}

async function runJudgeBatch(items, judge) {
  if (!items.length) return new Map();
  const byRef = new Map(items.map((item) => [item.ref, []]));
  const prompt = buildJudgeBatchPrompt(items);
  for (const model of judge.models) {
    for (let index = 0; index < judge.count; index += 1) {
      if (shutdownRequested) break;
      const parsed = await runJudgeProcessJson(prompt, judge, model, `batch:${items.length}`, index);
      const normalized = normalizeJudgeBatchReviews(parsed, items);
      for (const { ref, review } of normalized) byRef.get(ref).push(review);
    }
  }
  const out = new Map();
  for (const item of items) {
    const agg = aggregateReviews(byRef.get(item.ref) ?? []);
    if (agg) {
      out.set(item.ref, agg);
      await writeJudgeCache(item.topic, judge, agg);
    }
  }
  return out;
}

async function warmJudgeCacheForTargets(refs, judge) {
  if (!judge?.enabled || judge.batchSize <= 1) return;
  const missing = [];
  for (const ref of refs) {
    try {
      const topic = JSON.parse(readFileSync(path.join(root, ref), "utf8"));
      if (!readJudgeCache(topic, judge)) missing.push({ ref, topic });
    } catch {
      // 读不到的 topic 交给后续单篇流程报错。
    }
  }
  if (!missing.length) return;
  const batches = [];
  for (let i = 0; i < missing.length; i += judge.batchSize) {
    batches.push(missing.slice(i, i + judge.batchSize));
  }
  for (const batch of batches) {
    await runJudgeBatch(batch, judge);
  }
}

function blockJudgeCacheFile(blocks, ref, judge) {
  const hash = sha256(JSON.stringify({ ref, blocks, setHash: judge.setHash }));
  return path.join(judge.cacheDir, `${hash.slice(0, 16)}-${BLOCK_JUDGE_RUBRIC_VERSION}-${judge.setHash}.json`);
}

async function runBlockJudges({ ref, title, blocks }, judge) {
  if (!judge?.enabled || !blocks.length) return null;
  const cacheFile = blockJudgeCacheFile(blocks, ref, judge);
  try {
    return JSON.parse(readFileSync(cacheFile, "utf8"));
  } catch {
    // 无缓存，继续真跑
  }
  const byKey = new Map(blocks.map((block) => [block.key, []]));
  const prompt = buildBlockJudgePrompt({ ref, title, blocks });
  for (const model of judge.models) {
    for (let index = 0; index < judge.count; index += 1) {
      if (shutdownRequested) break;
      try {
        const parsed = await runJudgeProcessJson(prompt, judge, model, `block:${ref}`, index);
        const reviews = normalizeBlockJudgeReview(parsed, blocks);
        for (const review of reviews) byKey.get(review.key)?.push(review);
      } catch (error) {
        if (error.judgeProtocolFailure) throw error;
        console.log(`[JUDGE] 块级评审失败 ${ref} m=${model ?? "默认"} #${index + 1}: ${error.message}`);
      }
    }
  }
  if (![...byKey.values()].some((reviews) => reviews.length)) return null;
  const verdictRank = { blocking: 4, regressed: 3, same: 2, improved: 1 };
  const result = blocks.map((block) => {
    const reviews = byKey.get(block.key) ?? [];
    if (!reviews.length) return { key: block.key, verdict: "same", reason: "block judge unavailable", fix: "" };
    const worst = reviews.reduce((selected, review) =>
      verdictRank[review.verdict] > verdictRank[selected.verdict] ? review : selected, reviews[0]);
    if (reviews.some((review) => review.verdict === "improved") && !reviews.some((review) => review.verdict === "regressed" || review.verdict === "blocking")) {
      return {
        key: block.key,
        verdict: "improved",
        reason: reviews.map((review) => review.reason).filter(Boolean).join(" | "),
        fix: "",
      };
    }
    return worst;
  });
  try {
    await mkdir(judge.cacheDir, { recursive: true });
    await writeFile(cacheFile, `${JSON.stringify(result, null, 2)}\n`);
  } catch {
    // 缓存失败不阻断主流程
  }
  return result;
}

// ===== 确定性审计（唯一事实源 + 验收门禁）=====
function runAudit(minScore) {
  const startedAt = Date.now();
  console.log(`[AUDIT] 开始确定性审计 minScore=${minScore}`);
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
  console.log(
    `[AUDIT] 完成 overall=${audit.overallScore}/100 failing=${audit.failingTopicCount}/${audit.topicCount} ` +
      `elapsed=${formatDuration(Date.now() - startedAt)}`,
  );
  return audit;
}

// 进程内构建语料库，供 keep-best 用同一套 scoreTopic 算法给“候选 vs 现版”打分做对比。
// 用当前磁盘全量内容建库（含本 topic 旧版）：候选若照抄已在 ≥4 篇出现的句子，corpus 里有那些副本即可判出跨 topic 模板；
// 候选自创、之后才扩散的新句子由下一轮全量审计兜底。每轮建一次即可，本轮内其他篇的新写入造成的轻微滞后可接受。
function buildRefineCorpus() {
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  const all = [];
  for (const domainEntry of manifest.domains ?? []) {
    const domain = JSON.parse(readFileSync(path.join(root, domainEntry.entry), "utf8"));
    for (const category of domain.categories ?? []) {
      for (const ref of category.topics ?? []) {
        try {
          all.push({ topic: JSON.parse(readFileSync(path.join(root, ref), "utf8")), ref });
        } catch {
          // 单篇读取失败不应阻断整轮 keep-best 建库。
        }
      }
    }
  }
  return buildCorpus(all);
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

function buildRefinePrompt(topic, failingInfo, templates, minScore, deterministicScore, cachePath, findingLines = []) {
  const todayYmd = new Date().toISOString().slice(0, 10);
  const spec = REFINE_SPEC.split("${todayYmd}").join(todayYmd);
  const issues = failingInfo?.issues ?? [];
  const tmpl = templates ?? [];
  const judgeBlock = findingLines.length
    ? `\n【动态判官（资深评审）指出的具体缺口——这是“每一块更精准”的重点，逐条消除】\n${findingLines
        .map((line, index) => `${index + 1}. ${line}`)
        .join("\n")}\n`
    : "";
  const issueBlock = issues.length
    ? issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
    : "（确定性审计未列出扣分明细，可能已经达到静态阈值；这不是内容达标证明。请按上面 8 维重新做专家级审读，找出静态规则遗漏的事实薄弱、表达空泛、结构不顺、面试不可用、图表泛化、追问浅等问题。）";
  const templateBlock = tmpl.length
    ? `\n【跨 topic 模板句——下列句子在多篇里逐字重复，必须改写成本题专属的具体表达，禁止照抄】\n${tmpl
        .map((entry) => `- （在 ${entry.count} 篇里重复）${entry.sentence}`)
        .join("\n")}\n`
    : "";
  return `${spec}

【本篇当前确定性审计分】${deterministicScore ?? failingInfo?.score ?? "?"}/100，静态验收线 ${minScore}。
静态分数只是验收兜底，不是跳过理由。你必须先在内部按真人专家口径重新评分和找问题，再直接输出精修后的完整 JSON；不要输出评分过程。

【本篇被扣分的具体缺口（务必逐条消除）】
${issueBlock}
${templateBlock}${judgeBlock}
【输出要求】不要在 stdout 输出 JSON 内容、不要解释、不要 markdown 代码围栏。把改写后的完整 topic JSON 对象（从 { 开始到 } 结束、单一对象、合法 JSON）写入下面这个绝对路径的文件：
${cachePath}

写入规则（重要，必须遵守）：
1. 文件初始为空。如果你的写文件工具一次能写下完整 JSON，就一次写完；如果 JSON 很长担心被工具/响应截断，请分多次调用写文件工具，按"追加(append)"模式把 JSON 切成 2~5 个连续片段顺序写入同一个文件，最终拼起来仍是一个合法 JSON 对象。
2. 全部写完后，必须再调用一次写文件工具，往该文件末尾追加一行结束标记：
//---END---
这行是给主进程识别"写完了"用的，不要省略，也不要写成别的样子（区分大小写）。
3. 完成上述写入后，在 stdout 只输出一行：
WROTE:${cachePath}
不要在 stdout 输出 JSON 内容或任何其它文字。

今天日期是 ${todayYmd}，updatedAt 必须设为该值。

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
  // difficulty 不得下调：下调会软化审计的所有难度阈值（字数/必备 explain 数/取舍-失败 cap），是直白的“把难题伪装成简单题”刷分通道。
  if (typeof original.difficulty === "number") {
    if (typeof parsed.difficulty !== "number") return `difficulty 缺失或非数字（原 ${original.difficulty}）`;
    if (parsed.difficulty < original.difficulty) return `difficulty 被下调（${original.difficulty} -> ${parsed.difficulty}），禁止下调`;
  }
  // 元数据值锁定：精修只改“内容”，这些字段是身份/排序/打分输入，改动多半是刷分（如改 tags 让 topicAlignment 虚高）或漂移。
  const lockedMetaKeys = ["tags", "group", "order", "interviewFrequency", "recommendWeight", "prerequisites", "leetcodeUrl", "sourceRef"];
  for (const key of lockedMetaKeys) {
    if (key in original && JSON.stringify(parsed[key]) !== JSON.stringify(original[key])) {
      return `${key} 被改动（元数据字段必须原样保留，不得用于刷分/漂移）`;
    }
  }
  // 不得删除原有字段、不得改键名（spec 要求 leetcodeUrl/sourceRef/prerequisites/... 原样保留）。
  for (const key of Object.keys(original)) {
    if (!(key in parsed)) return `原有字段被删除：${key}（不得删除、不得改键名）`;
  }
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

  // mermaid 子集校验：仅允许 flowchart/graph + 基本边；禁用 subgraph/classDef/style 与其他图种。
  const mermaidHeadRe = /^\s*(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)\b/;
  const mermaidBlacklist = /\b(?:subgraph|classDef|style|sequenceDiagram|classDiagram|stateDiagram|mindmap|gantt|pie|journey|erDiagram)\b/;
  for (const card of cards) {
    if (card.type === "diagram" && card.format === "mermaid") {
      const content = typeof card.content === "string" ? card.content : "";
      if (!mermaidHeadRe.test(content)) {
        return `diagram(mermaid) 必须以 flowchart|graph 开头并跟 TB|TD|BT|LR|RL：${card.title ?? ""}`;
      }
      if (mermaidBlacklist.test(content)) {
        return `diagram(mermaid) 含禁用语法（subgraph/classDef/style/其他图种）：${card.title ?? ""}`;
      }
    }
  }

  // recallPrompts 每条必须含 id 与 mode ∈ {text, code, voice}
  if (Array.isArray(parsed.recallPrompts)) {
    const allowedModes = new Set(["text", "code", "voice"]);
    for (let i = 0; i < parsed.recallPrompts.length; i += 1) {
      const item = parsed.recallPrompts[i];
      if (!item || typeof item !== "object") return `recallPrompts[${i}] 不是对象`;
      if (typeof item.id !== "string" || item.id.length === 0) return `recallPrompts[${i}].id 缺失或非字符串`;
      if (!allowedModes.has(item.mode)) return `recallPrompts[${i}].mode 必须为 text|code|voice，实际 ${item.mode}`;
    }
  }

  // updatedAt 必须严格匹配 YYYY-MM-DD
  if (typeof parsed.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.updatedAt)) {
    return `updatedAt 必须为 YYYY-MM-DD 格式，实际 ${parsed.updatedAt}`;
  }

  return null;
}

async function writeTopicAtomic(ref, parsed) {
  const abs = path.join(root, ref);
  const tmp = `${abs}.refine.tmp`;
  await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`);
  await rename(tmp, abs);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function keyedItems(items, baseKeyFn) {
  const counts = new Map();
  return (items ?? []).map((item, index) => {
    const base = baseKeyFn(item, index);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return { item, index, key: count ? `${base}#${count + 1}` : base };
  });
}

function recallBaseKey(prompt, index) {
  if (prompt?.id) return `id:${prompt.id}`;
  return `index:${index}`;
}

function normalizeForMatch(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[\s、，,。:：/()（）\-_.+【】\[\]#*_`|>~"'“”‘’]+/g, "")
    .replace(/与/g, "和");
}

function cardComparableText(card = {}) {
  const parts = [card.title ?? "", card.content ?? "", card.fallback ?? "", card.caption ?? ""];
  if (Array.isArray(card.items)) parts.push(...card.items);
  if (Array.isArray(card.columns)) parts.push(...card.columns);
  if (Array.isArray(card.rows)) parts.push(...card.rows.flat());
  if (card.type === "interviewAnswer" && Array.isArray(card.followUpQuestions)) {
    for (const item of card.followUpQuestions) parts.push(item.question ?? "", item.answer ?? "");
  }
  return parts.filter(Boolean).join("\n");
}

function tokenSet(text = "") {
  const normalized = normalizeForMatch(text);
  const tokens = new Set();
  for (const token of normalized.match(/[a-z0-9][a-z0-9+#.-]{1,}/g) ?? []) tokens.add(token);
  for (const run of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) tokens.add(run.slice(index, index + size));
    }
  }
  return tokens;
}

function localTokenJaccard(left = "", right = "") {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function cardSimilarity(original, candidate, originalIndex, candidateIndex) {
  if (!original || !candidate || original.type !== candidate.type) return 0;
  if (original.id && candidate.id && original.id === candidate.id) return 1;
  const titleA = normalizeForMatch(original.title ?? "");
  const titleB = normalizeForMatch(candidate.title ?? "");
  const titleScore = titleA && titleA === titleB ? 0.45 : titleA && titleB && (titleA.includes(titleB) || titleB.includes(titleA)) ? 0.22 : 0;
  const contentScore = localTokenJaccard(cardComparableText(original), cardComparableText(candidate)) * 0.5;
  const orderScore = Math.max(0, 1 - Math.abs(originalIndex - candidateIndex) / 6) * 0.05;
  return titleScore + contentScore + orderScore;
}

function matchCards(originalCardsRaw = [], candidateCardsRaw = []) {
  const originalEntries = originalCardsRaw.map((item, index) => ({ item, index, key: `card:${index}`, matched: false }));
  const candidateEntries = candidateCardsRaw.map((item, index) => ({ item, index, key: null, originalEntry: null }));

  function assign(candidateEntry, originalEntry) {
    candidateEntry.originalEntry = originalEntry;
    candidateEntry.key = originalEntry.key;
    originalEntry.matched = true;
  }

  for (const candidateEntry of candidateEntries) {
    const id = candidateEntry.item?.id;
    if (!id) continue;
    const matches = originalEntries.filter((entry) => !entry.matched && entry.item?.type === candidateEntry.item?.type && entry.item?.id === id);
    if (matches.length === 1) assign(candidateEntry, matches[0]);
  }

  for (const candidateEntry of candidateEntries.filter((entry) => !entry.key)) {
    const title = normalizeForMatch(candidateEntry.item?.title ?? "");
    if (!title) continue;
    const matches = originalEntries
      .filter((entry) => !entry.matched && entry.item?.type === candidateEntry.item?.type && normalizeForMatch(entry.item?.title ?? "") === title)
      .sort((a, b) => Math.abs(a.index - candidateEntry.index) - Math.abs(b.index - candidateEntry.index));
    if (matches.length) assign(candidateEntry, matches[0]);
  }

  for (const candidateEntry of candidateEntries.filter((entry) => !entry.key)) {
    const scored = originalEntries
      .filter((entry) => !entry.matched && entry.item?.type === candidateEntry.item?.type)
      .map((entry) => ({ entry, score: cardSimilarity(entry.item, candidateEntry.item, entry.index, candidateEntry.index) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    if (best && best.score >= 0.32 && (!second || best.score - second.score >= 0.05 || Math.abs(best.entry.index - candidateEntry.index) <= 1)) {
      assign(candidateEntry, best.entry);
    }
  }

  for (const candidateEntry of candidateEntries.filter((entry) => !entry.key)) {
    candidateEntry.key = `new-card:${candidateEntry.index}`;
  }

  return {
    originalCards: originalEntries,
    candidateCards: candidateEntries,
  };
}

function stripFollowUps(card) {
  const clone = cloneJson(card ?? {});
  delete clone.followUpQuestions;
  return clone;
}

function blockLabel(descriptor) {
  if (descriptor.kind === "card" || descriptor.kind === "interviewContent") {
    const title = descriptor.candidate?.title ? `:${descriptor.candidate.title}` : "";
    const prefix = descriptor.kind === "interviewContent" ? "interviewContent" : descriptor.candidate?.type === "compareTable" ? "compareTable" : "learningCard";
    return `${prefix}:${descriptor.candidate?.type ?? "unknown"}${title}`;
  }
  if (descriptor.kind === "followUp") return `followUp:${descriptor.cardTitle || descriptor.cardKey}#${descriptor.index + 1}`;
  if (descriptor.kind === "recall") return `recallPrompt#${descriptor.index + 1}`;
  return descriptor.kind;
}

function buildBlockDescriptors(original, candidate) {
  const descriptors = [];
  const { originalCards, candidateCards } = matchCards(original.learningCards ?? [], candidate.learningCards ?? []);

  for (const entry of candidateCards) {
    const originalEntry = entry.originalEntry;
    if (entry.item?.type === "interviewAnswer") {
      if (!originalEntry || !sameJson(stripFollowUps(originalEntry.item), stripFollowUps(entry.item))) {
        descriptors.push({
          kind: "interviewContent",
          key: `interviewContent:${entry.key}`,
          cardKey: entry.key,
          original: originalEntry ? stripFollowUps(originalEntry.item) : undefined,
          originalCard: originalEntry?.item,
          originalIndex: originalEntry?.index,
          candidate: stripFollowUps(entry.item),
          candidateCard: entry.item,
          candidateIndex: entry.index,
        });
      }
      continue;
    }
    if (!originalEntry || !sameJson(originalEntry.item, entry.item)) {
      descriptors.push({
        kind: "card",
        key: `card:${entry.key}`,
        cardKey: entry.key,
        original: originalEntry?.item,
        originalIndex: originalEntry?.index,
        candidate: entry.item,
        candidateIndex: entry.index,
      });
    }
  }

  for (const entry of candidateCards.filter((cardEntry) => cardEntry.item?.type === "interviewAnswer")) {
    const originalEntry = entry.originalEntry;
    const originalFollowUps = originalEntry?.item?.followUpQuestions ?? [];
    const candidateFollowUps = entry.item?.followUpQuestions ?? [];
    for (let index = 0; index < candidateFollowUps.length; index += 1) {
      if (!sameJson(originalFollowUps[index], candidateFollowUps[index])) {
        descriptors.push({
          kind: "followUp",
          key: `followUp:${entry.key}:${index}`,
          cardKey: entry.key,
          cardTitle: entry.item?.title,
          originalIndex: originalEntry?.index,
          candidateIndex: entry.index,
          index,
          original: originalFollowUps[index],
          candidate: candidateFollowUps[index],
        });
      }
    }
  }

  const originalRecalls = keyedItems(original.recallPrompts ?? [], recallBaseKey);
  const candidateRecalls = keyedItems(candidate.recallPrompts ?? [], recallBaseKey);
  const originalRecallByKey = new Map(originalRecalls.map((entry) => [entry.key, entry]));
  for (const entry of candidateRecalls) {
    const originalEntry = originalRecallByKey.get(entry.key);
    if (!originalEntry || !sameJson(originalEntry.item, entry.item)) {
      descriptors.push({
        kind: "recall",
        key: `recall:${entry.key}`,
        recallKey: entry.key,
        originalIndex: originalEntry?.index,
        candidateIndex: entry.index,
        original: originalEntry?.item,
        candidate: entry.item,
      });
    }
  }

  return { descriptors, originalCards, candidateCards };
}

function mergedCardForDescriptor(descriptor) {
  if (descriptor.kind === "interviewContent" && descriptor.originalCard) {
    const next = cloneJson(descriptor.candidateCard);
    next.followUpQuestions = cloneJson(descriptor.originalCard.followUpQuestions ?? []);
    return next;
  }
  return cloneJson(descriptor.candidateCard ?? descriptor.candidate);
}

function mergeCardsByDescriptors(original, cardDescriptors, originalCards, candidateCards) {
  if (!cardDescriptors.length) return cloneJson(original.learningCards ?? []);

  const originalByKey = new Map(originalCards.map((entry) => [entry.key, entry]));
  const next = (original.learningCards ?? []).map((card) => cloneJson(card));
  const currentKeys = originalCards.map((entry) => entry.key);

  for (const descriptor of cardDescriptors.filter((item) => originalByKey.has(item.cardKey))) {
    next[descriptor.originalIndex] = mergedCardForDescriptor(descriptor);
  }

  for (const descriptor of cardDescriptors
    .filter((item) => !originalByKey.has(item.cardKey))
    .sort((a, b) => a.candidateIndex - b.candidateIndex)) {
    let insertAt = next.length;
    for (const later of candidateCards.slice(descriptor.candidateIndex + 1)) {
      const originalIndex = currentKeys.indexOf(later.key);
      if (originalIndex >= 0) {
        insertAt = originalIndex;
        break;
      }
    }
    next.splice(insertAt, 0, mergedCardForDescriptor(descriptor));
    currentKeys.splice(insertAt, 0, descriptor.cardKey);
  }

  return next;
}

function findCardIndexByKey(keyOrder, cardKey) {
  return keyOrder.indexOf(cardKey);
}

function applyBlockDescriptors(original, candidate, selectedDescriptors, blockIndex) {
  const selected = selectedDescriptors instanceof Set
    ? blockIndex.descriptors.filter((descriptor) => selectedDescriptors.has(descriptor.key))
    : selectedDescriptors;
  const merged = cloneJson(original);
  if (candidate.updatedAt) merged.updatedAt = candidate.updatedAt;

  const cardDescriptors = selected.filter((descriptor) => descriptor.kind === "card" || descriptor.kind === "interviewContent");
  merged.learningCards = mergeCardsByDescriptors(original, cardDescriptors, blockIndex.originalCards, blockIndex.candidateCards);
  const keyOrder = blockIndex.originalCards.map((entry) => entry.key);
  for (const descriptor of cardDescriptors.filter((item) => !blockIndex.originalCards.some((entry) => entry.key === item.cardKey)).sort((a, b) => a.candidateIndex - b.candidateIndex)) {
    let insertAt = keyOrder.length;
    for (const later of blockIndex.candidateCards.slice(descriptor.candidateIndex + 1)) {
      const originalIndex = keyOrder.indexOf(later.key);
      if (originalIndex >= 0) {
        insertAt = originalIndex;
        break;
      }
    }
    keyOrder.splice(insertAt, 0, descriptor.cardKey);
  }

  for (const descriptor of selected.filter((item) => item.kind === "followUp")) {
    const cardIndex = findCardIndexByKey(keyOrder, descriptor.cardKey);
    if (cardIndex < 0) continue;
    const card = merged.learningCards[cardIndex];
    if (card.type !== "interviewAnswer") continue;
    const followUps = Array.isArray(card.followUpQuestions) ? [...card.followUpQuestions] : [];
    followUps[descriptor.index] = cloneJson(descriptor.candidate);
    card.followUpQuestions = followUps.filter((item) => item !== undefined);
  }

  const recallDescriptors = selected.filter((item) => item.kind === "recall");
  if (recallDescriptors.length) {
    const recalls = cloneJson(original.recallPrompts ?? []);
    const keyedOriginal = keyedItems(original.recallPrompts ?? [], recallBaseKey);
    const originalIndexByKey = new Map(keyedOriginal.map((entry) => [entry.key, entry.index]));
    for (const descriptor of recallDescriptors.sort((a, b) => a.candidateIndex - b.candidateIndex)) {
      const originalIndex = originalIndexByKey.get(descriptor.recallKey);
      if (originalIndex !== undefined) {
        recalls[originalIndex] = cloneJson(descriptor.candidate);
      } else {
        recalls.splice(Math.min(descriptor.candidateIndex, recalls.length), 0, cloneJson(descriptor.candidate));
      }
    }
    merged.recallPrompts = recalls;
  }

  return merged;
}

function duplicateBlockStats(topic) {
  const cards = topic.learningCards ?? [];
  const exact = new Map();
  const semanticPairs = [];
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    const title = normalizeForMatch(card.title ?? "");
    if (title) {
      const key = `${card.type}:${title}`;
      exact.set(key, (exact.get(key) ?? 0) + 1);
    }
    for (let j = i + 1; j < cards.length; j += 1) {
      const other = cards[j];
      if (card.type !== other.type) continue;
      const similarity = localTokenJaccard(cardComparableText(card), cardComparableText(other));
      const sameTitle = title && title === normalizeForMatch(other.title ?? "");
      if ((sameTitle && similarity >= 0.25) || similarity >= 0.72) {
        semanticPairs.push(`${card.type}:${i}:${j}`);
      }
    }
  }
  return { exact, semanticPairCount: semanticPairs.length };
}

function duplicateBlockRegression(original, candidate) {
  const before = duplicateBlockStats(original);
  const after = duplicateBlockStats(candidate);
  for (const [key, count] of after.exact.entries()) {
    const prior = before.exact.get(key) ?? 0;
    if (count > Math.max(1, prior)) return `引入重复块标题：${key}（${prior} -> ${count}）`;
  }
  if (after.semanticPairCount > before.semanticPairCount) {
    return `引入语义重复块（${before.semanticPairCount} -> ${after.semanticPairCount}）`;
  }
  return null;
}

function dimensionDropFree(beforeReport, afterReport) {
  const before = beforeReport.metrics?.dimensions ?? {};
  const after = afterReport.metrics?.dimensions ?? {};
  for (const key of Object.keys(before)) {
    if (typeof before[key] === "number" && typeof after[key] === "number" && after[key] + 0.05 < before[key]) {
      return false;
    }
  }
  return true;
}

function staticImproved(beforeReport, afterReport) {
  const beforeDims = beforeReport.metrics?.dimensions ?? {};
  const afterDims = afterReport.metrics?.dimensions ?? {};
  const dimensionUp = Object.keys(afterDims).some((key) =>
    typeof beforeDims[key] === "number" && typeof afterDims[key] === "number" && afterDims[key] > beforeDims[key] + 0.05,
  );
  return afterReport.score > beforeReport.score || afterReport.issueCount < beforeReport.issueCount || dimensionUp;
}

function staticRegressionVectorAccepts(beforeReport, afterReport) {
  const floor = beforeReport.score >= 90 ? 90 : beforeReport.score;
  return afterReport.score >= floor
    && afterReport.issueCount <= beforeReport.issueCount
    && dimensionDropFree(beforeReport, afterReport)
    && staticImproved(beforeReport, afterReport);
}

function blockJudgePayload(descriptor) {
  return {
    key: descriptor.key,
    label: blockLabel(descriptor),
    kind: descriptor.kind,
    before: descriptor.original ?? null,
    after: descriptor.candidate ?? null,
  };
}

async function tryBlockKeepBest({ original, candidate, ref, corpus, beforeStaticReport, beforeReview, judge }) {
  const blockIndex = buildBlockDescriptors(original, candidate);
  const changed = blockIndex.descriptors.filter((descriptor) => !sameJson(descriptor.original, descriptor.candidate));
  if (!changed.length) return { attempted: false, accept: false, reason: "候选没有块级变化" };

  let selected = [];
  const rejected = [];
  for (const descriptor of changed) {
    const variant = applyBlockDescriptors(original, candidate, [descriptor], blockIndex);
    const bad = checkInvariants(original, variant);
    if (bad) {
      rejected.push({ key: descriptor.key, label: blockLabel(descriptor), reason: `不变量失败：${bad}` });
      continue;
    }
    const duplicate = duplicateBlockRegression(original, variant);
    if (duplicate) {
      rejected.push({ key: descriptor.key, label: blockLabel(descriptor), reason: `重复块守卫：${duplicate}` });
      continue;
    }
    const report = scoreTopic(variant, ref, corpus);
    if (staticRegressionVectorAccepts(beforeStaticReport, report)) {
      selected.push({ descriptor, staticAfter: report.score, issueCount: report.issueCount });
    } else {
      rejected.push({
        key: descriptor.key,
        label: blockLabel(descriptor),
        reason: `静态未改善或有退步（${beforeStaticReport.score}/${beforeStaticReport.issueCount} -> ${report.score}/${report.issueCount}）`,
      });
    }
  }

  if (judge?.enabled && beforeReview && selected.length) {
    const blockReviews = await runBlockJudges({
      ref,
      title: original.title,
      blocks: selected.map((entry) => blockJudgePayload(entry.descriptor)),
    }, judge);
    if (blockReviews) {
      const byKey = new Map(blockReviews.map((review) => [review.key, review]));
      const accepted = [];
      for (const entry of selected) {
        const review = byKey.get(entry.descriptor.key);
        if (!review || review.verdict !== "improved") {
          rejected.push({
            key: entry.descriptor.key,
            label: blockLabel(entry.descriptor),
            reason: `块级判官未判 improved（${review?.verdict ?? "missing"}${review?.reason ? `：${review.reason}` : ""}）`,
          });
          continue;
        }
        accepted.push({ ...entry, blockVerdict: review.verdict, blockReason: review.reason });
      }
      selected = accepted;
    }
  }

  if (!selected.length) {
    return {
      attempted: true,
      accept: false,
      reason: `无可吸收的改善块（候选变化 ${changed.length} 块）`,
      changedBlocks: changed.length,
      rejectedBlocks: rejected,
    };
  }

  const merged = applyBlockDescriptors(original, candidate, selected.map((entry) => entry.descriptor), blockIndex);
  if (sameJson(original, merged)) {
    return { attempted: true, accept: false, reason: "块级合并后与旧版相同", changedBlocks: changed.length };
  }
  const bad = checkInvariants(original, merged);
  if (bad) {
    return { attempted: true, accept: false, reason: `块级合并不变量失败：${bad}`, changedBlocks: changed.length };
  }
  const duplicate = duplicateBlockRegression(original, merged);
  if (duplicate) {
    return { attempted: true, accept: false, reason: `块级合并重复块守卫：${duplicate}`, changedBlocks: changed.length };
  }

  const mergedStaticReport = scoreTopic(merged, ref, corpus);
  let mergedReview = null;
  let decision;
  if (judge?.enabled && beforeReview) {
    mergedReview = await runJudges(merged, ref, judge);
    decision = mergedReview
      ? acceptByJudge({ before: beforeReview, after: mergedReview, staticBefore: beforeStaticReport.score, staticAfter: mergedStaticReport.score, minStatic: 90 })
      : { accept: false, reason: "块级合并后判官失败，降级整篇接受/拒绝" };
  } else {
    decision = staticRegressionVectorAccepts(beforeStaticReport, mergedStaticReport)
      ? { accept: true, reason: `块级静态改善 ${beforeStaticReport.score}/${beforeStaticReport.issueCount} -> ${mergedStaticReport.score}/${mergedStaticReport.issueCount}` }
      : { accept: false, reason: `块级合并整篇静态未通过 ${beforeStaticReport.score}/${beforeStaticReport.issueCount} -> ${mergedStaticReport.score}/${mergedStaticReport.issueCount}` };
  }

  return {
    attempted: true,
    accept: decision.accept,
    reason: decision.reason,
    topic: merged,
    staticAfter: mergedStaticReport.score,
    dynamicAfter: mergedReview?.score,
    review: mergedReview,
    changedBlocks: changed.length,
    mergedBlocks: selected.map((entry) => ({
      key: entry.descriptor.key,
      label: blockLabel(entry.descriptor),
      staticAfter: entry.staticAfter,
      issueCount: entry.issueCount,
      blockVerdict: entry.blockVerdict,
      blockReason: entry.blockReason,
    })),
    rejectedBlocks: rejected,
  };
}

// writeTo 不为空时写到该路径（预览模式，不动仓库）；否则原子写回仓库 ref。
// corpus 用于落盘前的静态 keep-best：候选静态分不严格高于现版就保留旧版（“越跑越高、不许改烂”）。
async function refineOneTopic(ref, audit, templates, cfg, cliPath, runDir, minScore, model, writeTo, corpus, judge) {
  const original = JSON.parse(readFileSync(path.join(root, ref), "utf8"));
  const attempts = cfg.retries + 1;
  const mode = writeTo ? "PREVIEW" : "REFINE";
  const score = audit.scoreMap.get(ref) ?? "?";
  const detailedProgress = cfg.progressStyle === "topic";
  const processProgress = {
    suppressHeartbeat: !detailedProgress,
    suppressSpawn: !detailedProgress,
    suppressDone: !detailedProgress,
    heartbeatMs: cfg.heartbeatMs,
  };
  const safeRef = ref.replace(/[^a-z0-9]+/gi, "-");
  const cacheDir = path.join(runDir, "topic-cache");
  await mkdir(cacheDir, { recursive: true });
  let lastError = null;
  let availabilityFailure = false;
  let keptOld = false; // 最近一次结果是“候选合法但未优于现版、保留旧版”（非执行失败）
  let bestRejectedAfter = null; // 被 keep-best 拒掉的候选里最高的静态分，用于诊断
  // 静态基线（现版）：候选与现版用同一 corpus/算法对比；original 不随 attempt 变，算一次即可。
  const staticBeforeReport = corpus
    ? scoreTopic(original, ref, corpus)
    : { score: audit.scoreMap.get(ref) ?? 0, issueCount: audit.failingMap.get(ref)?.issues?.length ?? 0, issues: audit.failingMap.get(ref)?.issues ?? [], metrics: { dimensions: {} } };
  const staticBefore = staticBeforeReport.score;
  // 判前：对现版判一次（按 contentHash 缓存）。用于 ①“已达标则不浪费改写” ②keep-best 基线 ③findings 喂改写。
  let beforeReview = null;
  let findingLines = [];
  if (!writeTo && judge?.enabled) {
    beforeReview = await runJudges(original, ref, judge);
    if (beforeReview) {
      findingLines = findingsToPromptLines(beforeReview);
      if (staticBefore >= minScore && judgePasses(beforeReview, judge.dynamicSkipMin)) {
        if (cfg.progressStyle !== "quiet") {
          console.log(`[TOPIC] 已达标，跳过改写 ${ref}（static ${staticBefore} + 动态 ${beforeReview.score}，8 维全过、无事实问题）`);
        }
        return {
          ok: true,
          attempts: 0,
          availabilityFailure: false,
          alreadyGood: true,
          action: "alreadyGood",
          decisionReason: "static + dynamic 已达标",
          staticBefore,
          staticAfter: staticBefore,
          dynamicBefore: beforeReview.score,
          dynamicAfter: beforeReview.score,
        };
      }
    }
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const tmp = mkdtempSync(path.join(tmpdir(), "quality-refine-"));
    const attemptLabel = `${mode} ${ref} attempt=${attempt}/${attempts} model=${model ?? "CLI默认"}`;
    const cachePath = path.join(cacheDir, `${safeRef}.attempt${attempt}.json`);
    // 旧产物先删，避免子 agent 没写而我们读到上次 attempt 的内容。
    await rm(cachePath, { force: true });
    const prompt = buildRefinePrompt(original, audit.failingMap.get(ref), templates.get(ref), minScore, audit.scoreMap.get(ref), cachePath, findingLines);
    let raw = "";
    try {
      const args = buildCliArgs(cfg, prompt, model);
      if (cfg.progressStyle !== "quiet") {
        console.log(`[TOPIC] 开始 ${attemptLabel} score=${score}/100 cli=${cfg.cli}`);
      }
      try {
        if (cfg.usePty && process.platform === "darwin") {
          const capture = path.join(tmp, "capture.txt");
          await runProcess(
            "script",
            ["-q", capture, cliPath, ...args],
            { cwd: root, stdio: ["ignore", "ignore", "pipe"] },
            cfg.timeoutMs,
            { ...processProgress, label: attemptLabel, outputPath: capture },
          );
          raw = readFileSync(capture, "utf8");
        } else {
          const result = await runProcess(
            cliPath,
            args,
            { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
            cfg.timeoutMs,
            { ...processProgress, label: attemptLabel },
          );
          raw = result.stdout;
        }
      } catch (spawnError) {
        availabilityFailure = true; // 进程级失败：超时 / 非零退出 / 端点不可用 -> 计入降级信号
        throw spawnError;
      }
      availabilityFailure = false; // 进程已正常产出 -> 不是可用性问题
      if (detailedProgress) console.log(`[TOPIC] CLI 已返回，开始读缓存 ${ref}`);

      // 子 agent 把 JSON 分多次 append 到 cachePath，最后一行追加 //---END--- 表示写完。
      // 这样 LLM 输出长度上限只受磁盘限制，不再被 stdout / max_tokens 截断。
      let cacheContent;
      try {
        cacheContent = readFileSync(cachePath, "utf8");
      } catch (readError) {
        // 缓存文件不存在：要么子 agent 没遵循指令（写工具不可用 / 直接 stdout 输出 JSON），
        // 要么进程退出但实际未完成。先用文本兜底判断可用性，再报"未写入缓存"。
        const hit = availabilityFailureMatch(raw);
        if (hit) {
          availabilityFailure = true;
          throw new Error(
            `CLI 输出疑似服务不可用/限流：命中关键词「${hit.keyword}」@${hit.position}/${hit.totalLen} 上下文="${hit.context}"`,
          );
        }
        throw new Error(
          `子 agent 未把 JSON 写入缓存路径 ${path.relative(root, cachePath)}（stdout 长度 ${clean(raw).length}，尾部="${tailLine(raw) || ""}"，readError=${readError.code ?? readError.message}）`,
        );
      }

      // 切掉 //---END--- 之后的内容；找不到标记就视为写入未完成（agent 中途退出 / 工具崩溃）。
      const endMarker = "//---END---";
      const endIdx = cacheContent.lastIndexOf(endMarker);
      if (endIdx < 0) {
        throw new Error(
          `缓存文件缺少 //---END--- 结束标记，子 agent 写入未完成（cache 长度 ${clean(cacheContent).length}，尾部="${tailLine(cacheContent) || ""}"）`,
        );
      }
      const jsonText = cacheContent.slice(0, endIdx);

      let parsed;
      try {
        parsed = extractJson(jsonText);
      } catch (jsonError) {
        throw new Error(`${jsonError.message}（cache 长度 ${clean(jsonText).length}，尾部="${tailLine(jsonText) || ""}"）`);
      }
      // JSON 解析成功，先用黑名单识别错误响应（429/限流/上游错误等），再用白名单确认是 topic 契约。
      // 这样 LLM/网关返回 {code:429,message,details} 之类合法 JSON 但非 topic 契约时，
      // 能给出明确的"限流/上游错误"提示并触发可用性降级，而不是被当成 topic 进 invariant 检查报"id 被改动"。
      if (looksLikeErrorResponseJson(parsed)) {
        const summary = summarizeErrorResponse(parsed) || "no detail";
        const code = parsed.code ?? parsed.status ?? parsed.statusCode ?? parsed.status_code ?? parsed.httpStatus;
        const codeNum = typeof code === "number" ? code : Number(code);
        const isRateLimit = codeNum === 429
          || parsed.retry_after !== undefined
          || parsed.retryAfter !== undefined
          || parsed["Retry-After"] !== undefined
          || /rate.?limit|too many requests|throttl|quota|限流|请求过多|额度/i.test(summary);
        const isUpstream5xx = Number.isFinite(codeNum) && codeNum >= 500 && codeNum < 600;
        if (isRateLimit || isUpstream5xx) {
          availabilityFailure = true; // 限流/上游错误 -> 计入降级，触发并发收敛和模型降级
          throw new Error(`CLI 输出为${isRateLimit ? "限流" : "上游错误"}响应 JSON：${summary}`);
        }
        throw new Error(`CLI 输出为错误响应 JSON 而非 topic 契约：${summary}`);
      }
      if (!looksLikeTopicContract(parsed, original)) {
        // JSON 合法、不是已知错误格式，但也不是本 topic 的契约（如改了 id、丢了 learningCards）。
        // 不计入可用性失败——这是模型内容失败，应该按本篇正常重试。
        const previewKeys = Object.keys(parsed).slice(0, 8).join(",");
        throw new Error(`CLI 输出 JSON 不是当前 topic 契约（id=${parsed.id ?? "?"} domain=${parsed.domain ?? "?"} keys=${previewKeys}）`);
      }
      const bad = checkInvariants(original, parsed);
      if (bad) throw new Error(`schema 不变量失败：${bad}`);
      if (writeTo) {
        // 预览模式：直接写候选产物，不做 keep-best（预览本就是看“这次会改成什么样”）。
        await mkdir(path.dirname(writeTo), { recursive: true });
        await writeFile(writeTo, `${JSON.stringify(parsed, null, 2)}\n`);
        if (detailedProgress) console.log(`[TOPIC] 预览产物已写入 ${path.relative(root, writeTo)}`);
        if (detailedProgress) console.log(`[TOPIC] 完成 ${attemptLabel}`);
        return { ok: true, attempts: attempt, availabilityFailure: false };
      }
      // 正式落盘 = keep-best：候选与现版用同一 corpus/算法算静态分；判官开启时再叠加“回归向量”动态判据。
      const afterStaticReport = corpus
        ? scoreTopic(parsed, ref, corpus)
        : { score: staticBefore + 1, issueCount: 0, issues: [], metrics: { dimensions: {} } };
      const after = afterStaticReport.score;

      // Phase 3：块级 keep-best。先只吸收“单独替换也能让静态向量不退且有改善”的块，
      // 再对拼好的整篇复判；复判不过则降级为下面的整篇接受/拒绝。
      let blockResult = null;
      if (corpus) {
        blockResult = await tryBlockKeepBest({ original, candidate: parsed, ref, corpus, beforeStaticReport: staticBeforeReport, beforeReview, judge });
        if (blockResult.accept) {
          await writeTopicAtomic(ref, blockResult.topic);
          if (detailedProgress) {
            console.log(
              `[TOPIC] 块级合并已写回 ${ref}（${blockResult.reason}，吸收 ${blockResult.mergedBlocks.length}/${blockResult.changedBlocks} 块` +
                `${blockResult.review ? `，动态 ${beforeReview.score}->${blockResult.review.score}` : ""}）`,
            );
          }
          if (detailedProgress) console.log(`[TOPIC] 完成 ${attemptLabel}`);
          return {
            ok: true,
            attempts: attempt,
            availabilityFailure: false,
            merged: true,
            action: "merged",
            decisionReason: blockResult.reason,
            staticBefore,
            staticAfter: blockResult.staticAfter,
            dynamicBefore: beforeReview?.score,
            dynamicAfter: blockResult.dynamicAfter,
            mergedBlocks: blockResult.mergedBlocks,
            changedBlocks: blockResult.changedBlocks,
            rejectedBlocks: blockResult.rejectedBlocks,
          };
        }
        if (blockResult.attempted && detailedProgress) {
          console.log(`[TOPIC] 块级合并未采用 ${ref}: ${blockResult.reason}，降级整篇判定`);
        }
      }

      let decision;
      let afterReview = null;
      if (judge?.enabled && beforeReview) {
        // 判后：对候选判一次。回归向量（不退步任一维 + 不新增事实问题 + 静态≥90 + 至少一处改善）才接受。
        // 不拿“总分”当唯一开关，避免误杀“部分更好但总分波动”的候选（这是块级合并前的整篇近似）。
        afterReview = await runJudges(parsed, ref, judge);
        if (afterReview) {
          decision = acceptByJudge({ before: beforeReview, after: afterReview, staticBefore, staticAfter: after, minStatic: 90 });
        } else {
          // 判后失败：退回静态严格护栏，宁可保留旧版也不在“无动态信号”下放行。
          decision = { accept: after > staticBefore, reason: after > staticBefore ? `静态↑(判后失败,退回静态护栏)` : `静态未升且判后失败` };
        }
      } else {
        // --no-judge 或判前失败：Phase 1 静态严格护栏（候选静态分必须严格高于现版）。
        decision = { accept: after > staticBefore, reason: after > staticBefore ? `static ${staticBefore} -> ${after}` : `static ${after} <= ${staticBefore}` };
      }
      const duplicate = duplicateBlockRegression(original, parsed);
      if (decision.accept && duplicate) {
        decision = { accept: false, reason: `重复块守卫：${duplicate}` };
      }
      if (decision.accept) {
        await writeTopicAtomic(ref, parsed);
        if (detailedProgress) console.log(`[TOPIC] 已写回 ${ref}（${decision.reason}${afterReview ? `，动态 ${beforeReview.score}->${afterReview.score}` : ""}）`);
        if (detailedProgress) console.log(`[TOPIC] 完成 ${attemptLabel}`);
        return {
          ok: true,
          attempts: attempt,
          availabilityFailure: false,
          action: "accepted",
          decisionReason: decision.reason,
          staticBefore,
          staticAfter: after,
          dynamicBefore: beforeReview?.score,
          dynamicAfter: afterReview?.score,
          blockMerge: blockResult ? { attempted: blockResult.attempted, reason: blockResult.reason, changedBlocks: blockResult.changedBlocks, mergedBlocks: blockResult.mergedBlocks?.length ?? 0 } : null,
        };
      }
      // 候选未优于现版：保留旧版、本 attempt 不写。记为 keptOld，继续重试（下个 attempt 可能更好）。
      keptOld = true;
      bestRejectedAfter = bestRejectedAfter === null ? after : Math.max(bestRejectedAfter, after);
      lastError = new Error(`候选未优于现版，保留旧版（${decision.reason}）`);
      console.log(`[TOPIC] 保留旧版 ${attemptLabel}: ${decision.reason}`);
      lastError.decisionReason = decision.reason;
      continue;
    } catch (error) {
      if (error.interrupted || shutdownRequested) throw error;
      keptOld = false; // 本 attempt 是真失败（CLI/解析/契约/不变量），不是“保留旧版”
      lastError = error;
      console.log(`[TOPIC] 失败 ${attemptLabel}: ${error.message}`);
      if (attempt < attempts) console.log(`[RETRY] ${ref} ${attempt}/${attempts}: ${error.message}`);
    } finally {
      // raw 始终落盘（无论成功失败），用于失败诊断；attempt 编号区分重试。
      if (raw) {
        const safeRef = ref.replace(/[^a-z0-9]+/gi, "-");
        const rawPath = path.join(runDir, `${safeRef}.attempt${attempt}.raw.txt`);
        await writeFile(rawPath, `${clean(raw)}\n`).catch(() => {});
      }
      await rm(tmp, { recursive: true, force: true });
    }
  }
  return {
    ok: false,
    attempts,
    error: lastError?.message ?? "unknown error",
    availabilityFailure,
    keptOld,
    action: keptOld ? "retained" : "failed",
    decisionReason: lastError?.decisionReason,
    staticBefore,
    staticAfter: bestRejectedAfter,
    dynamicBefore: beforeReview?.score,
  };
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

function startPoolHeartbeat(counters, active, heartbeatMs, cfg) {
  if (!heartbeatMs || heartbeatMs <= 0) return () => {};
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const now = Date.now();
    const activeItems = [...active.entries()]
      .slice(0, 4)
      .map(([ref, item]) => `${ref} ${formatDuration(now - item.startedAt)} m=${item.model ?? "默认"}`);
    const suffix = activeItems.length ? ` current=${activeItems.join(" | ")}` : "";
    console.log(
      `[RUNNING] ${counters.processed}/${counters.total} ★${counters.good ?? 0} ✓${counters.written} ⇄${counters.merged ?? 0} ◦${counters.kept ?? 0} ✗${counters.failed} ` +
        `concurrency=${cfg.concurrency} active=${active.size} elapsed=${formatDuration(now - startedAt)}${suffix}`,
    );
  }, heartbeatMs);
  heartbeat.unref();
  return () => clearInterval(heartbeat);
}

async function refinePool(targets, audit, templates, cfg, cliPath, runDir, minScore, progressPath, modelState, counters, corpus, judge) {
  const results = [];
  let index = 0;
  const active = new Map();
  const stopHeartbeat = cfg.progressStyle === "summary"
    ? startPoolHeartbeat(counters, active, cfg.heartbeatMs, cfg)
    : () => {};
  async function worker() {
    while (index < targets.length) {
      if (shutdownRequested) throw makeInterruptedError();
      const ref = targets[index++];
      const model = currentModel(modelState);
      active.set(ref, { model: model ?? "默认", startedAt: Date.now() });
      let result;
      try {
        result = await refineOneTopic(ref, audit, templates, cfg, cliPath, runDir, minScore, model, undefined, corpus, judge);
      } finally {
        active.delete(ref);
      }
      noteModelResult(modelState, result);
      results.push({ ref, ...result });
      counters.processed += 1;
      // 五种结果：good=判官判定已达标无需改写；written=整篇改写被 keep-best 接受；
      // merged=块级 keep-best 吸收好块后写回；
      // kept=候选合法但未优于现版（保留旧版，不算失败）；failed=真出错。
      const outcome = result.ok ? (result.alreadyGood ? "good" : result.merged ? "merged" : "written") : result.keptOld ? "kept" : "failed";
      if (outcome === "good") counters.good += 1;
      else if (outcome === "written") counters.written += 1;
      else if (outcome === "merged") counters.merged += 1;
      else if (outcome === "kept") counters.kept += 1;
      else counters.failed += 1;
      const snapshot = {
        processed: counters.processed,
        total: counters.total,
        good: counters.good,
        written: counters.written,
        merged: counters.merged,
        kept: counters.kept,
        failed: counters.failed,
      };
      await appendFile(
        progressPath,
        `${JSON.stringify({
          ref,
          status: outcome,
          attempts: result.attempts,
          model: model ?? "default",
          action: result.action,
          decisionReason: result.decisionReason,
          staticBefore: result.staticBefore,
          staticAfter: result.staticAfter,
          dynamicBefore: result.dynamicBefore,
          dynamicAfter: result.dynamicAfter,
          changedBlocks: result.changedBlocks,
          mergedBlocks: result.mergedBlocks?.map((block) => block.label),
          error: result.error,
          ts: new Date().toISOString(),
        })}\n`,
      );
      const domain = ref.split("/")[1];
      const label = outcome === "good" ? "GOOD" : outcome === "written" ? "OK  " : outcome === "merged" ? "MERG" : outcome === "kept" ? "KEEP" : "FAIL";
      console.log(
        `[${snapshot.processed}/${snapshot.total} ★${snapshot.good} ✓${snapshot.written} ⇄${snapshot.merged} ◦${snapshot.kept} ✗${snapshot.failed} | ${domain} | m=${model ?? "默认"}] ` +
          `c=${cfg.concurrency} ${label} ${ref}${result.error ? ` (${result.error})` : ""}`,
      );
    }
  }
  try {
    await Promise.all(Array.from({ length: cfg.concurrency }, worker));
  } finally {
    stopHeartbeat();
  }
  return results;
}

async function refinePoolWithConcurrencyFallback(targets, audit, templates, cfg, cliPath, runDir, minScore, progressPath, modelState, counters, corpus, judge) {
  let pending = [...targets];
  const allResults = [];
  // 池级滑动窗口：仅当短时间内频繁可用性失败才降并发；偶发 429 由该篇内重试自行消化。
  const poolFailures = []; // 时间戳数组
  const windowMs = modelState.windowMs;
  const threshold = Math.max(2, modelState.degradeAfter); // 至少 2 次才算“频繁”
  while (pending.length) {
    const results = await refinePool(pending, audit, templates, cfg, cliPath, runDir, minScore, progressPath, modelState, counters, corpus, judge);
    allResults.push(...results);
    const availabilityFailures = [...new Set(results
      .filter((result) => !result.ok && result.availabilityFailure)
      .map((result) => result.ref))];
    if (!availabilityFailures.length) break;

    const now = Date.now();
    for (let i = 0; i < availabilityFailures.length; i += 1) poolFailures.push(now);
    pruneWindow(poolFailures, windowMs, now);

    if (cfg.autoConcurrencyMin <= 0 || cfg.concurrency <= cfg.autoConcurrencyMin) {
      console.log(
        `[CONCURRENCY] ${availabilityFailures.length} 个可用性失败，但并发已到下限 ${cfg.concurrency}；不再降并发，停止重试。`,
      );
      break;
    }
    if (poolFailures.length < threshold) {
      console.log(
        `[CONCURRENCY] ${availabilityFailures.length} 个可用性失败，窗口内累计 ${poolFailures.length}/${threshold}（${Math.round(windowMs / 1000)}s），未达频繁阈值，仅按本篇重试不降并发。`,
      );
      break;
    }

    const nextConcurrency = Math.max(cfg.autoConcurrencyMin, cfg.concurrency - 1);
    console.log(
      `[CONCURRENCY] ${Math.round(windowMs / 1000)}s 窗口内累计 ${poolFailures.length} 次可用性失败 ≥ ${threshold}，` +
        `并发 ${cfg.concurrency} → ${nextConcurrency} 并重试 ${availabilityFailures.length} 个失败项。`,
    );
    cfg.concurrency = nextConcurrency;
    poolFailures.length = 0; // 降并发后重新观察新一轮窗口
    pending = availabilityFailures;
    counters.total += pending.length;
  }
  return allResults;
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

// 启动时 GC：保留 .quality-refine/ 下最近 keep 轮 runDir，其余 rm -rf。
// 只清理形如时间戳前缀的目录（preview/ 等特殊目录跳过）。
async function gcOldRuns(qualityDir, keep) {
  let entries;
  try {
    entries = await readdir(qualityDir, { withFileTypes: true });
  } catch {
    return; // 目录不存在等情况静默
  }
  const runDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(entry.name)) continue;
    const dir = path.join(qualityDir, entry.name);
    const st = await stat(dir).catch(() => null);
    if (!st) continue;
    runDirs.push({ dir, mtimeMs: st.mtimeMs });
  }
  runDirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const stale = runDirs.slice(keep);
  for (const { dir } of stale) {
    await rm(dir, { recursive: true, force: true }).catch((err) => {
      console.warn(`[gc] 清理旧 runDir 失败 ${path.relative(qualityDir, dir)}: ${err.message}`);
    });
  }
}

async function main() {
  const args = parseArgs();
  const scope = String(args.scope ?? "all").trim();
  const minScore = Number(args["min-score"] ?? 90);
  const concurrency = Number(args.concurrency ?? 2);
  const autoConcurrencyMin = Number(args["auto-concurrency-min"] ?? (concurrency > 3 ? 3 : concurrency));
  const maxRounds = Number(args["max-rounds"] ?? 3);
  const retries = Number(args.retries ?? 1);
  const timeoutMs = Number(args["timeout-ms"] ?? 600000);
  const limit = args.limit ? Number(args.limit) : Infinity;
  const dryRun = Boolean(args["dry-run"]);
  const auditOnly = Boolean(args["audit-only"]);
  const previewMode = Boolean(args.preview);
  const topicFilters = parseTopicList(args);
  const degradeAfter = Number(args["degrade-after"] ?? 3);
  // 滑动窗口长度：仅当窗口内可用性失败次数 ≥ degradeAfter 才视为“频繁”，触发并发降级 / 模型降级。
  const degradeWindowSeconds = Number(args["degrade-window-seconds"] ?? 60);
  const progressStyle = String(
    args["progress-style"] ?? process.env.QUALITY_REFINE_PROGRESS_STYLE ?? (previewMode ? "topic" : "summary"),
  ).trim();
  const defaultHeartbeatSeconds = progressStyle === "summary" ? 30 : 10;
  const heartbeatSeconds = Number(args["heartbeat-seconds"] ?? process.env.QUALITY_REFINE_HEARTBEAT_SECONDS ?? defaultHeartbeatSeconds);
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
  ensureInt(autoConcurrencyMin, "auto-concurrency-min", 0, maxConcurrency);
  if (autoConcurrencyMin > concurrency) {
    throw new Error(`--auto-concurrency-min 不能大于 --concurrency（${autoConcurrencyMin} > ${concurrency}）`);
  }
  ensureInt(maxRounds, "max-rounds", 1, 10);
  ensureInt(retries, "retries", 0, 5);
  ensureInt(degradeAfter, "degrade-after", 1, 50);
  if (!(degradeWindowSeconds >= 5 && degradeWindowSeconds <= 3600)) {
    throw new Error(`--degrade-window-seconds 必须在 [5, 3600] 范围内，实际 ${degradeWindowSeconds}`);
  }
  ensureInt(heartbeatSeconds, "heartbeat-seconds", 0, 600);
  if (!["quiet", "summary", "topic"].includes(progressStyle)) {
    throw new Error("--progress-style 必须是 quiet | summary | topic");
  }
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
    heartbeatMs: heartbeatSeconds * 1000,
    progressStyle,
    autoConcurrencyMin,
  });
  const cliPath = commandPath(cfg.cli);
  if (!cliPath) throw new Error(`找不到 CLI：${cfg.cli}。请先安装或换一个 --cli。`);

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha256(scope).slice(0, 6)}`;
  const qualityDir = path.join(root, ".quality-refine");
  await gcOldRuns(qualityDir, 3);
  const runDir = path.join(qualityDir, runId);
  await mkdir(runDir, { recursive: true });
  const progressPath = path.join(runDir, "progress.jsonl");
  const modelState = makeModelState(modelChain, degradeAfter, degradeWindowSeconds * 1000);

  // ===== 动态判官配置（默认开；模型默认跟精修主模型一致；支持多模型 × 每模型多实例）=====
  const judgeDisabled = Boolean(args["no-judge"]);
  const judgeCli = args["judge-cli"] ?? cli;
  const judgeModels = args["judge-models"]
    ? String(args["judge-models"]).split(",").map((entry) => entry.trim()).filter(Boolean)
    : [modelChain[0]]; // 默认 = 精修主模型（modelChain[0]，可能是 undefined=CLI 默认）
  const judgeCount = Number(args["judge-count"] ?? 1);
  const dynamicSkipMin = Number(args["dynamic-skip-min"] ?? args["dynamic-pass-min"] ?? args["dynamic-min"] ?? 85);
  const judgeBatchSize = Number(args["judge-batch-size"] ?? 5);
  const judgeJsonRetries = Number(args["judge-json-retries"] ?? 2);
  ensureInt(judgeCount, "judge-count", 1, 8);
  ensureInt(judgeBatchSize, "judge-batch-size", 1, 10);
  ensureInt(judgeJsonRetries, "judge-json-retries", 0, 5);
  if (!Number.isInteger(dynamicSkipMin) || dynamicSkipMin < 1 || dynamicSkipMin > 100) {
    throw new Error("--dynamic-skip-min 必须在 [1,100]（--dynamic-min 仍可作为兼容别名）");
  }
  let judge = null;
  if (!judgeDisabled) {
    const judgeCliPath = commandPath(judgeCli);
    if (!judgeCliPath) throw new Error(`找不到判官 CLI：${judgeCli}（用 --judge-cli 指定，或 --no-judge 关闭判官）。`);
    const judgeCfg = applyJudgePreset(judgeCli, timeoutMs);
    judgeCfg.cli = judgeCli;
    const setHash = sha256(`${judgeCli}|${judgeModels.map((entry) => entry ?? "default").join(",")}|x${judgeCount}`).slice(0, 8);
    judge = {
      enabled: true,
      cli: judgeCli,
      cliPath: judgeCliPath,
      cfg: judgeCfg,
      models: judgeModels,
      count: judgeCount,
      dynamicSkipMin,
      batchSize: judgeBatchSize,
      jsonRetries: judgeJsonRetries,
      cacheDir: path.join(qualityDir, "judge-cache"),
      setHash,
    };
    console.log(
      `判官：cli=${judgeCli} 模型=[${judgeModels.map((entry) => entry ?? "CLI默认").join(", ")}] × ${judgeCount} 实例，动态免改线 ${dynamicSkipMin}，batch=${judgeBatchSize}，json重试=${judgeJsonRetries}（contentHash 缓存复用）`,
    );
  } else {
    console.log("判官：已关闭（--no-judge），仅静态 keep-best。");
  }

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
    const result = await refineOneTopic(ref, audit, templates, cfg, cliPath, runDir, minScore, currentModel(modelState), outPath, null, null);
    if (!result.ok) {
      console.error(`预览失败：${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`PREVIEW_OUTPUT=${path.relative(root, outPath)}`); // 供 sh 解析渲染
    return;
  }

  console.log(
    `精修启动：cli=${cfg.cli} (${cliPath})，模型链=[${modelChain.map((entry) => entry ?? "CLI默认").join(" → ")}]（${degradeWindowSeconds}s 窗口内可用性失败 ≥ ${degradeAfter} 次才降级），` +
      `scope=${scope}${topicFilters.length ? ` topics=${topicFilters.length}` : " topics=scope全部"}，concurrency=${cfg.concurrency}` +
      `${cfg.autoConcurrencyMin > 0 && cfg.autoConcurrencyMin < cfg.concurrency ? `（可用性失败自动降至 ${cfg.autoConcurrencyMin}）` : ""}，` +
      `maxRounds=${maxRounds}，minScore=${minScore}`,
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
    lastOk: null,
    lastError: null,
  }]));
  const stuck = new Set();

  for (let round = 1; round <= maxRounds; round += 1) {
    if (shutdownRequested) throw makeInterruptedError();
    const audit = runAudit(minScore);
    const templates = templatesByRef(audit);
    const corpus = buildRefineCorpus(); // keep-best：候选与现版用同一套 scoreTopic + 语料库对比
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

    await warmJudgeCacheForTargets(ordered, judge);

    const counters = { total: ordered.length, processed: 0, good: 0, written: 0, merged: 0, kept: 0, failed: 0 };
    const results = await refinePoolWithConcurrencyFallback(ordered, audit, templates, cfg, cliPath, runDir, minScore, progressPath, modelState, counters, corpus, judge);
    for (const result of results) {
      const item = state.get(result.ref);
      item.attempts += 1;
      item.lastOk = result.ok;
      item.lastKeptOld = result.keptOld ?? false;
      item.lastAlreadyGood = result.alreadyGood ?? false;
      item.lastError = result.error ?? null;
      item.lastResult = result;
    }
    console.log(
      `[round ${round}] 完成：已达标(免改) ${counters.good}，整篇写回 ${counters.written}，块级合并 ${counters.merged}，保留旧版(未改善) ${counters.kept}，失败 ${counters.failed}`,
    );
  }

  // 最终审计 + 汇总
  const finalAudit = runAudit(minScore);
  const processed = targetRefs.filter((ref) => state.get(ref).attempts > 0);
  const unprocessed = targetRefs.filter((ref) => state.get(ref).attempts === 0);
  // 执行失败 = 真出错（CLI/解析/契约/不变量），不含 keptOld（候选合法但未优于现版、保留旧版）。
  const failedExecutions = targetRefs.filter((ref) => {
    const s = state.get(ref);
    return s.attempts > 0 && s.lastOk === false && !s.lastKeptOld;
  });
  // keptOld：试过但没产出更优候选、保留了旧版。仍 <minScore 的会同时出现在 stillFailing（真问题）；
  // 已 ≥minScore 的只是“当前判定下已最优、暂时推不高”，不算失败、不阻断同步。
  const keptOldRefs = targetRefs.filter((ref) => state.get(ref).attempts > 0 && state.get(ref).lastKeptOld);
  const goodRefs = targetRefs.filter((ref) => state.get(ref).attempts > 0 && state.get(ref).lastAlreadyGood);
  const writtenRefs = targetRefs.filter((ref) => {
    const s = state.get(ref);
    return s.attempts > 0 && s.lastOk === true && !s.lastAlreadyGood && !s.lastResult?.merged;
  });
  const mergedRefs = targetRefs.filter((ref) => {
    const s = state.get(ref);
    return s.attempts > 0 && s.lastOk === true && Boolean(s.lastResult?.merged);
  });
  const stillFailing = targetRefs.filter((ref) => finalAudit.failingMap.has(ref));
  const fixed = [...initialFailing].filter((ref) => !finalAudit.failingMap.has(ref));
  const topicResults = targetRefs.map((ref) => {
    const s = state.get(ref);
    const result = s.lastResult;
    const status = s.attempts === 0
      ? "unprocessed"
      : result?.alreadyGood
        ? "alreadyGood"
        : result?.merged
          ? "merged"
          : result?.ok
            ? "accepted"
            : result?.keptOld
              ? "retained"
              : "failed";
    return {
      ref,
      status,
      attempts: s.attempts,
      staticBefore: result?.staticBefore ?? initialAudit.scoreMap.get(ref),
      staticAfter: result?.staticAfter ?? finalAudit.scoreMap.get(ref),
      dynamicBefore: result?.dynamicBefore,
      dynamicAfter: result?.dynamicAfter,
      decisionReason: result?.decisionReason,
      mergedBlocks: result?.mergedBlocks?.map((block) => block.label) ?? [],
      changedBlocks: result?.changedBlocks,
      error: result?.error ?? null,
    };
  });
  const summary = {
    runId,
    scope,
    selectedTargets: targetRefs.length,
    minScore,
    cli: cfg.cli,
    modelChain: modelChain.map((entry) => entry ?? "CLI default"),
    degradeAfter,
    degradeWindowSeconds,
    endedOnModel: currentModel(modelState) ?? "CLI default",
    judge: judge ? {
      cli: judge.cli,
      models: judge.models.map((entry) => entry ?? "CLI default"),
      count: judge.count,
      dynamicSkipMin: judge.dynamicSkipMin,
      batchSize: judge.batchSize,
      jsonRetries: judge.jsonRetries,
      outputProtocol: "file+END",
    } : null,
    startedFailing: initialFailing.size,
    processed: processed.length,
    unprocessed,
    alreadyGood: goodRefs.length,
    written: writtenRefs.length,
    merged: mergedRefs.length,
    keptOld: keptOldRefs.length,
    failedExecutions: failedExecutions.map((ref) => ({ ref, error: state.get(ref).lastError })),
    fixed: fixed.length,
    stillFailing: stillFailing.length,
    stuck: [...stuck],
    overallScoreAfter: finalAudit.overallScore,
    topicResults,
    stillFailingDetail: stillFailing
      .map((ref) => ({ ref, score: finalAudit.failingMap.get(ref).score, issues: finalAudit.failingMap.get(ref).issues }))
      .sort((a, b) => a.score - b.score),
  };
  await writeFile(path.join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`\n==== 精修完成 ====`);
  console.log(`处理：${processed.length}/${targetRefs.length}    已达标(免改)：${goodRefs.length}    整篇写回：${writtenRefs.length}    块级合并：${mergedRefs.length}    保留旧版(未改善)：${keptOldRefs.length}    执行失败：${failedExecutions.length}    修好原静态未达标：${fixed.length}/${initialFailing.size}    仍 <${minScore}：${stillFailing.length}    放弃(stuck)：${stuck.size}`);
  if (unprocessed.length) console.log(`未处理：${unprocessed.length} 篇（通常是 limit/max-rounds 不足）`);
  console.log(`全量 overall：${initialAudit.overallScore} -> ${finalAudit.overallScore}`);
  console.log(`产物：${path.relative(root, runDir)}（progress.jsonl / summary.json / 每篇 raw 输出）`);
  if (stillFailing.length) {
    console.log(`仍未达标（按分数升序，前 20）：`);
    for (const item of summary.stillFailingDetail.slice(0, 20)) console.log(`- ${item.score}/100  ${item.ref}`);
  }
  if (failedExecutions.length) {
    console.log(`执行失败（前 20）：`);
    for (const ref of failedExecutions.slice(0, 20)) console.log(`- ${ref}: ${state.get(ref).lastError}`);
  }
  // 退出码只反映“是否还有目标 <minScore 或没跑完”。keptOld / 已达标篇上的执行失败不阻断同步，
  // 因为磁盘上留的是合格的旧版内容（“越跑越高、不许改烂”：失败时绝不退步）。
  if (stillFailing.length || unprocessed.length) {
    process.exitCode = 1;
  }
}

installSignalHandlers();

main().catch((error) => {
  if (error?.interrupted) {
    console.error("[INTERRUPT] 精修已中断。");
    process.exitCode = 130;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
