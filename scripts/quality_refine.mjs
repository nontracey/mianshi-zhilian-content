#!/usr/bin/env node
// 内容精修驱动器（API 模式）：
//   - 每个精修/评审/块级评审调用都走 scripts/llm/runner.mjs（统一 OpenAI 兼容 API + 模型链 + 自动降级）。
//   - 目标集由 scope/topic 选择决定；确定性审计只提供上下文、验收和重试信号。
//   - 弱模型只负责"改"：调用返回整篇 topic JSON（response_format=json_schema 强约束）。
//   - 验收门禁 = 现有 content_quality_audit.mjs（≥minScore、9 维有地板、反刷分），不放宽任何口径。
//   - .env 加载、模型清单、采样参数都由 scripts/llm/env-config.mjs 统一管理；本文件不再探测 CLI / 不再 spawn 子进程。
import { mkdir, readdir, rename, rm, stat, writeFile, appendFile } from "node:fs/promises";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, getChangedFiles, sha256 } from "./quality_llm_common.mjs";
import { scoreTopic, buildCorpus } from "./content_quality_audit.mjs";
import {
  BLOCK_JUDGE_RUBRIC_VERSION,
  JSON_STRING_RULES,
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
  JUDGE_REVIEW_SCHEMA,
  QWEN_JUDGE_BATCH_SCHEMA,
  QWEN_BLOCK_JUDGE_SCHEMA,
} from "./quality_llm_judge.mjs";
import { llmRunner } from "./llm/runner.mjs";
import { liveEvents, newReqId } from "./llm/live-events.mjs";
import { pauseBus } from "./llm/pause-bus.mjs";
import { QuotaSkipped } from "./llm/router.mjs";
import { envConfig } from "./llm/env-config.mjs";
import { createRouter } from "./llm/router.mjs";
import {
  CONTENT_STANDARD_VERSION,
  PRODUCTION_STRICT_MIN_SCORE,
  diagramPolicyPrompt,
} from "./quality_standard.mjs";

const root = process.cwd();
// .quality-refine 产物根目录（runDir / judge-cache / preview 全在这下面）。
// 默认在仓库根，但可用 QUALITY_REFINE_DIR 覆盖到隔离目录——回归测试指向临时目录，
// 这样 run.sh 的 `rm -rf .../judge-cache` 只会清隔离缓存，绝不误删用户辛苦攒的真预热缓存。
const qualityRoot = process.env.QUALITY_REFINE_DIR
  ? path.resolve(process.env.QUALITY_REFINE_DIR)
  : path.join(root, ".quality-refine");
const allowComplexMermaid = /^(1|true|yes)$/i.test(envConfig.getEnv("REFINE_ALLOW_COMPLEX_MERMAID", "false"));
const maxConcurrency = 8;
// activeChildren 已弃用 —— CLI 子进程路径已删除,API 模式无 spawn。但 installSignalHandlers / runProcess 仍引用 → 改写为 noop
const activeChildren = new Map(); // noop 占位,后续 edit 会从 runProcess 里移走
let shutdownRequested = false; // 保留:Ctrl-C 时设 true,所有循环检查后退出
let activeRunDir = null;

// 处理顺序：先小后大，便于早期发现问题、降低单次回滚成本（与 manual-refine 一致）。
const DOMAIN_ORDER = [
  "go", "self-media", "data-engineering", "devops", "security", "network",
  "design-pattern", "database", "os", "architecture", "python", "agent",
  "dotnet", "frontend", "java", "algorithm",
];

// ===== 内嵌精修规范（弱模型唯一参照，不读 81KB 大文档；要求只增不减）=====
// 调用 buildRefinePrompt 时会把字面量 ${todayYmd} 替换为实际的 YYYY-MM-DD 日期串。
const REFINE_SPEC = `你是资深技术面试内容主笔 + 领域专家。任务：把下面这一篇 topic 改写到"真人专家会认可、面试能直接用"的高质量，使其通过确定性质量审计（满分 100，合格线见下，9 个维度各有地板分，强项不能补偿短板）。

【目标层次——技术类对标 P7/P7+，非技术类对标对应专家纵深】
- 技术域：内容深度按资深/专家（P7、可到 P7+）的知识储备来写。difficulty 4-5 必须达到源码级机制、架构链路、极端规模与工程权衡的深度，能真正区分资深与专家；difficulty 3 至少要能区分资深；difficulty 1-2 的基础题保持诚实标注、紧凑不注水，不强行拔高（拔高基础题等于难度虚标）。
- 非技术域（如自媒体）：按该职业资深从业者的纵深写——要有可量化方法、真实数据口径与来源、失败复盘和取舍，不停留在常识科普。
- 区分度天花板：一篇题"能筛到哪个职级"由它的 recallPrompts + followUpQuestions 决定。若全部问题只考"是什么/列举"，区分度封顶"仅中级"；要具备资深（P7）区分度，difficulty≥3 必须至少有一条"为什么这样设计而非另一种 / 线上如何排查 / 取舍权衡 / 极端场景如何应对"的深问，且正文要能支撑该深问的答案。

【核心原则——只调内容，不动格式】
你的唯一任务是优化内容质量（深度、准确性、面试可用性）。不得改变 JSON 结构和字段格式——每个字段的键名、类型、取值范围必须与原 topic 完全一致。如果原 topic 某个字段用的是 A 格式，精修后必须还是 A 格式。格式错误等于精修失败。

【输出格式（违反任意一条会被驱动判失败并重试）】
- 你必须只输出一个 JSON 对象，第一个非空白字符必须是 \`{\`，最后一个非空白字符必须是 \`}\`。
- 禁止任何 markdown 代码围栏（不要 \`\`\`json / \`\`\`），禁止解释性前后缀，禁止任何额外文字。
- 禁止 JSON 注释（不要 //、不要 /* */），禁止 trailing comma（最后一个属性、最后一个数组元素后面禁止逗号）。
（字符串的转义/换行规则随输出协议不同，见文末"字符串排版规则"那一节，按那里的要求执行。）

【9 个评估维度——每一项都要做到位，不能为了一项牺牲另一项】
1. 结构完整性：必须含 explain + interviewAnswer + checklist；至少一张 compareTable / diagram / code；rubric 四维权重之和=100。
2. 内容深度：每张 explain 要讲清机制/触发条件/关键指标/失败路径/工程取舍，不是清单堆砌、不是大白话复述定义。
3. 专家证据：给出具体抓手——真实函数名/类名/参数、版本边界、命令与配置项、数值量级、生产现象与定位线索。禁止"通常、一般、很重要"这类空话。
4. 讲解清晰度：遵循认知顺序——先动机/痛点 → 机制 → 具体例子 → 边界/反例 → 面试如何表达；逻辑连贯不跳跃。
5. 图示/对比：diagram 节点必须是本题专属概念（不是"输入→处理→输出"这种万能图），且边必须表达真实机制（调用顺序/数据流/状态转移/分支/失败路径）——纯线性关键词链（A→B→C→D→…，无分支/汇合/状态转移）、或终点是"面试结论/答题要点/总结"这类汇聚节点的，即使节点专属也算假图，必须重画；compareTable 行列对齐，且每一行都含真正的结论而非同义复述。
【何时用什么图——按 topic 类型评估，不是所有 topic 都需要 SVG、Mermaid 或其他 diagram】
- 先判断是否需要图解：如果文字、代码卡或 compareTable 已经更清楚，就不要为了凑图新增 diagram；recommendedFormat 可以是 code、compareTable、text 或 none。
- 协议/状态机/分布式类（TCP 握手/挥手、拥塞控制、Paxos/Raft、OAuth2 流程、事务状态机）：首选 mermaid stateDiagram 或 sequenceDiagram 展示"参与者交互/状态转移/分支条件"；sources: [{kind: "mermaid", content: ...}, {kind: "text", content: ...}]。
- 架构/跨系统边界类（微服务拓扑、数据血缘、CI/CD 流水线、消息流转）：首选 mermaid flowchart/graph + subgraph 展示"模块分组/调用链路/隔离边界"；sources: [{kind: "mermaid", content: ...}, {kind: "text", content: ...}]。
- 纯概念/对比/分类类（设计模式对比、数据结构选型、安全攻击分类）：不需要 diagram 卡，用 compareTable 就够了。不要为了凑"有图"给纯概念对比画流程图。
- 算法/数据结构/空间状态类（数组窗口、双指针、DP 表、树/图遍历 frontier、堆、链表指针、回溯搜索树）：若需要图解，优先使用 SVG 表达真实布局、状态变化或多步骤面板；Mermaid 只能用于控制流/状态机，不能把真实数据结构弱化成四个流程节点。
- difficulty 1-2 基础题：不主动加复杂图，保持简洁；已有的简单 flowchart 或对比表保留即可。
- 如有 svg 静态资源（assets/diagrams/*.svg），可放在 sources[0] 作为第一展示层，sources[1]=mermaid、sources[2]=text 作为降级兜底。
- 降级链最少要有一层 mermaid 或 text 兜底。
- SVG 不是天然更好：如果 SVG 只是 Mermaid 换皮、文字过密、移动端看不清、没有表达更多机制，应改用 Mermaid/compareTable/text。
- Mermaid 不是天然低级：如果 sequenceDiagram/stateDiagram/flowchart+subgraph 已经清楚表达交互、状态或架构边界，不要为了"高级"强行生成 SVG。
- 严禁图解退化：原 topic 已有 SVG 且表达了真实空间结构、步骤状态或数据结构细节时，候选必须保留同等或更强的信息量；可以移除装饰性/错误 SVG，但必须证明文字、表格、Mermaid 或重画后的图更清楚。
6. 面试可用性：interviewAnswer 用三层结构——30 秒结论 → 机制要点列表 → 边界/追问应对；followUpQuestions ≥2 条，且答案是本题专属、不复述题面。
7. rubric 评估质量：mustHave 是具体知识点名词（如"本地队列+全局队列+work stealing 三层调度"），不是"能说明「X」在「Y」里的作用和判断标准"这类套娃句；commonMistakes 是真实的坑，不是泛化。mustHave / goodToHave / commonMistakes 只能是知识点名词短语或自然语句，禁止内嵌代码片段（如 throw new ...()、function、=>、带分号的语句、缩进代码块）——代码只放 code 卡。
8. 模板与语言卫生：逐字消除下列 P0 模板句式（命中必改写成本题专属的具体表达）：
   - explain 结尾三段式："把 X 放到真实场景里看…"/"判断 X 是否答到位时…"/"学透 X 的关键是…追问/复述校验"。
   - code 高亮注释套话："这里定义示例的核心入口或结构…"/"这里给出最终结果或提前退出条件…"/"并发控制点：说明它保护的…"/"这里体现状态推进或遍历过程…"/"需要说明终止条件、复杂度和异常输入"等一切非本题专属的通用说明。
   - interviewAnswer 四段式骨架："结论：X 要先说清它解决什么问题，再展开…/我会这样回答：1.先定位核心问题…2.再串起关键机制…3.接着补充边界…4.最后验证…"——必须改写为本题独有的自然表达。
   - rubric.mustHave：所有以"能说明/能解释/能准确解释 X 的 Y"开头的泛化句式，都应替换为具体知识点名词（如"弱引用 key 回收后 value 仍被 Thread 强持有"而非"能说明 value 泄漏原因"）。
   - interviewerFocus：四词排比模板（"考察是否能解释 X 的 a、b、c、d"）和两段式泛化（"考察对 X 的理解深度，能否区分 Y 和 Z"）都应改写为本题考察的具体能力点。
   - followUpQuestions："X 一般怎么定位/怎么排查"这种通用骨架但答案没有本题专属抓手。
   - 任何"今日笔记/今日练习/第 X 天/Day X"。
9. 区分度天花板（对标 P7/P7+）：技术类 difficulty≥3 的内容必须深到能区分资深（P7），difficulty 4-5 要到 P7+（源码级机制 / 架构权衡 / 极端规模 / 疑难定位）；非技术类按对应职业的专家纵深。判据见上【目标层次】——只考"是什么/列举"、recallPrompts/followUpQuestions 缺"为什么这样设计 / 如何排查 / 取舍 / 极端场景"深问的，本维不合格。difficulty 1-2 的基础题豁免"区分资深"，但不得为凑深度注水或虚标难度。

【准确性与时效】所有事实、版本、API、默认值、数值必须正确且贴合当前主流实践；不确定的断言宁可不写，不要编造。算法题要给正确复杂度与边界条件。

【字段结构契约（schema 不变量，任何一条违反都会被驱动判失败并重试）】
- 顶层字段：保持 id / domain / category 完全不变；status 必须保持 "production"；difficulty 不得下调；topic 原本已存在的任何字段都必须原样保留（包括但不限于 leetcodeUrl / sourceRef / prerequisites / interviewFrequency / interviewerFocus / recommendWeight / order / tags / group / summary / estimatedMinutes），不得删除、不得改键名。
- updatedAt：必须更新为 \${todayYmd}（格式 YYYY-MM-DD，短横线分隔；这是 topic 文件用的格式，与 manifest.json 的 contentVersion 点号格式不同），不要带时分秒、不要带时区。
- estimatedMinutes：是用户首次阅读该 topic 卡片所需的分钟数（一般 15-40），不是练习时长，原值合理就别动。
- learningCards：必须是非空数组；类型集合必须同时包含 explain / interviewAnswer / checklist 三类，且至少额外含一张 compareTable / diagram / code。每张卡片的 type / title 必填。

【learningCards 各类型的合法字段与格式（必须严格遵守，不得增删字段、不得改换格式）】
- explain：合法字段有 type / title / content。content 为 Markdown 字符串。禁止在 explain 的 content 里使用 box-drawing 字符画（┌─┐│└┘├─等），需要画图就用 diagram 卡片。
- interviewAnswer：合法字段有 type / title / content / followUpQuestions。content 为 Markdown 字符串，涉及多个要点必须使用 Markdown 列表（\`-\` 或 \`1.\` 开头），禁止行内编号（"1）…2）…"）。followUpQuestions 必须是 \`[{question, answer}]\` 对象数组，长度至少 2，禁止退化为字符串数组。
- checklist：合法字段有 type / title / items。items 必须是字符串数组，每项是一条可核验的能力点。
- code：合法字段有 type / title / content / language / highlights。language 必填，取值仅限 java / python / javascript / typescript / bash / sql / json / yaml / c / cpp / go / rust 之一。highlights 为 \`[{line, note}]\` 数组，line 是从 1 开始的行号，note 是该行的具体语义说明（禁止"关键行"/"核心入口"等泛化占位，必须是本题专属的具体解释）；禁止在 code 卡片里使用 box-drawing 字符画（┌─┐│└┘ 等），需要画图就用 diagram 卡片。
- compareTable：合法字段有 type / title / content / columns / rows。两种合法形态——（A）Markdown 表格字符串放在 content（以 \`|\` 开头）；（B）结构化表格，columns 为表头字符串数组、rows 为二维字符串数组。**保留原 topic 用的那种形态，不要互换。** 若原 topic 用 columns+rows 形态，则每行 rows 的列数必须与 columns 对齐；若原 topic 用 content 形态，则精修后仍用 content 形态。
- diagram：合法字段有 type / title / content / format / items / fallback / caption / svgPath / asset / svg / sources。format 取值 mermaid / svg / image / text 之一；当 format=mermaid 时，content 必须是合法 Mermaid 头：\`flowchart|graph + TB/TD/BT/LR/RL\`，若 REFINE_ALLOW_COMPLEX_MERMAID=true 也可使用 stateDiagram(-v2)、sequenceDiagram、subgraph(≤2层)、classDef 5 色板。items 为字符串数组，是图示要点列表，**原 topic 有 items 字段就必须保留**。必须提供 fallback（一句话纯文本概括）。caption 为图注。节点文案必须紧扣本 topic 主题，禁止使用"输入→处理→输出"这类万能节点。sources 可选，格式 [{kind:"svg"|"mermaid"|"text", path?:"...", content?:"..."}]，按数组顺序降级（svg 资源 → mermaid 结构图 → text 兜底）；只要 sources 含 svg，就必须同时含 mermaid 或 text 兜底。
- animation：合法字段有 type / title / asset / sources / fallback / caption。asset 为资源路径，fallback 必填。sources 规则同 diagram。

- recallPrompts：至少 1 条；第一条必须是该 topic 最核心、面试官最常开口问的那个问题（首轮练习兼容旧版 App 用）；每条对象结构必须是 \`{id, prompt, mode}\`，id 形如 \`<topic.id>.recall.<n>\`，mode 取值仅限 text / code / voice；可选附加 expectedMinutes（数字，分钟）、difficulty（1-5）。
- rubric：必须含 mustHave（≥1 条）/ goodToHave / commonMistakes / scoreWeights 四个字段；scoreWeights 必须包含 coverage / accuracy / interviewExpression / depth 四个键，每个值是 0-100 的整数，**四个值之和必须严格等于 100**。mustHave / goodToHave / commonMistakes 的每一项只能是知识点描述短语，禁止内嵌代码片段。
- 总长度：精修后用 JSON.stringify 序列化的字符串长度不得少于原 topic 的 60%（信息量只增不减）。`;

// CLI 预设探测已删除 —— 改用 scripts/llm/env-config.mjs 的 OpenAI 兼容端点配置。

// ===== API 模式（v3）=====
// 不再 spawn CLI：所有 LLM 调用走 scripts/llm/runner.mjs。
// response_format=json_schema + 截断自动重试 + 模型链降级，全在 runner.mjs 里处理。
// 旧版 qwen headless / computer-use / MCP 不变量已不适用，全部弃用。

// qwen 显式路由 + 结构化输出 schema 旧实现已删除 ——
// ① 路由（--bare + OPENAI_BASE_URL 直连）由 env-config.mjs 的 baseUrl 字段直接管，runner.mjs 透传；
// ② 结构化 schema 由 quality_llm_judge.mjs 的 JUDGE_REVIEW_SCHEMA / QWEN_JUDGE_BATCH_SCHEMA / QWEN_BLOCK_JUDGE_SCHEMA 提供（顶层 additionalProperties:false + required 钉键），在 quality_refine.mjs 顶部已 import。
// 精修结构化 schema：递归镜像当前 topic 的结构，给每一层 array/object/标量都显式标 type。
// 关键修复（2026-06-14）：原实现只把每个顶层 key 列成空 schema {}（无 type）。火山 minimax-m3 在
// structured_output 下遇到"无 type 的属性 + 数组值"会把数组包成 {"item":[...]} 对象——learningCards /
// recallPrompts / tags / rubric.mustHave / interviewAnswer.followUpQuestions / checklist.items 全中招，
// 于是 looksLikeTopicContract 的 Array.isArray(learningCards) 必失败 → 凡是真调了模型的篇统统报
// "CLI 输出 JSON 不是当前 topic 契约"（实测一次 run 里 model-invoked 篇 100% 挂、只有 alreadyGood 的篇幸免）。
// 这正是 QWEN_JUDGE_SCHEMA 注释里早就踩过的"无 type → 模型套一层包装"坑；判官 schema 当初显式 typed 才好用。
// 修法：显式 type 把输出钉成数组/对象；递归且合并异构数组元素的键，让 followUpQuestions/items/columns/rows
// 这些"只在某类卡片里出现"的嵌套数组也拿到 type。required 钉顶层全部键（同 checkInvariants 防丢字段口径），
// 嵌套层不设 required（卡片类型异构，避免误拒），additionalProperties:true 全程容错让模型自由改写文字。
function schemaForArrayItems(arr) {
  if (!arr.length) return null;
  if (arr.every((el) => el && typeof el === "object" && !Array.isArray(el))) {
    const merged = {};
    for (const el of arr) {
      for (const [k, v] of Object.entries(el)) {
        if (!(k in merged)) merged[k] = schemaForValue(v);
      }
    }
    const node = { type: "object", additionalProperties: true };
    if (Object.keys(merged).length) node.properties = merged;
    return node;
  }
  if (arr.every((el) => Array.isArray(el))) return schemaForValue(arr[0]);
  if (arr.every((el) => typeof el === "number")) return { type: "number" };
  if (arr.every((el) => typeof el === "boolean")) return { type: "boolean" };
  return { type: "string" };
}
function schemaForValue(value) {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value)) {
    const items = schemaForArrayItems(value);
    return items ? { type: "array", items } : { type: "array" };
  }
  if (typeof value === "object") {
    const node = { type: "object", additionalProperties: true };
    const entries = Object.entries(value);
    if (entries.length) {
      node.properties = {};
      for (const [k, v] of entries) node.properties[k] = schemaForValue(v);
    }
    return node;
  }
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
}
function buildTopicSchema(original) {
  const properties = {};
  for (const [key, value] of Object.entries(original || {})) properties[key] = schemaForValue(value);
  return { type: "object", properties, required: Object.keys(original || {}), additionalProperties: true };
}
// 旧 CLI 路径(qwenRoutes / setQwenRoutes / resolveQwenRoute / STRUCTURED_OUTPUT_OVERRIDE / STRUCTURED_STRING_RULES /
// applyPreset / commandPath / runQwenStructured 等)已彻底删除 —— v3 全 API 模式。
// 上层调用统一走 callRefineApi(prompt, schema, { model, sampling, signal, onProgress })。
async function callRefineApi(prompt, schema, { model, sampling, timeoutMs, signal, onProgress } = {}) {
  await pauseBus.awaitResume();
  if (shutdownRequested) throw makeInterruptedError();
  const t0 = Date.now();
  const result = await llmRunner.runRefine({
    systemPrompt: "你是内容精修助手,通过 structured_output 工具返回 JSON。",
    userPrompt: prompt,
    schema,
    sampling,
    modelChain: model ? [model] : undefined,
    timeoutMs,
    signal,
    onProgress,
  });
  return { parsed: result.parsed, model: result.model, durationMs: Date.now() - t0, usage: result.usage };
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

// 容错修复：剥行/块注释 + 去 trailing comma（均在 stripJsonComments 里做成字符串感知），再尝试 parse。
function repairAndParseJson(source) {
  // 注释剥离与 trailing comma 去除都只作用于字符串外，字符串值里的 // 、, ] 等原样保留。
  return JSON.parse(stripJsonComments(source));
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
    // 字符串外的 trailing comma（逗号后跳过空白紧跟 } 或 ]）才丢弃；字符串内的逗号原样保留，
    // 避免把 code 卡里 `{1, 2, }` / `arr[i, ]` 这类字符串值里的逗号误删、静默改坏内容。
    if (ch === ",") {
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j])) j++;
      if (source[j] === "}" || source[j] === "]") {
        i++;
        continue;
      }
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

// 点名 looksLikeTopicContract 具体挂在哪一条，给报错带上可定位的因果（而不是只列前几个键）。
function describeContractMiss(parsed, original) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return `不是 JSON 对象（${Array.isArray(parsed) ? "数组" : typeof parsed}）`;
  if (typeof parsed.id !== "string") return `id 缺失或非字符串（${typeof parsed.id}）`;
  if (typeof parsed.domain !== "string") return `domain 缺失或非字符串（${typeof parsed.domain}）`;
  if (!Array.isArray(parsed.learningCards)) {
    const lc = parsed.learningCards;
    const shape = lc && typeof lc === "object" ? `对象{${Object.keys(lc).slice(0, 4).join(",")}}` : typeof lc;
    // 结构化输出把数组包成 {item:[...]} 是最常见成因，单独点出来便于一眼认出 schema 问题。
    const hint = lc && typeof lc === "object" && Array.isArray(lc.item) ? "（疑似结构化输出把数组包成 {item:[...]}，检查 buildTopicSchema 的 type 标注）" : "";
    return `learningCards 不是数组而是 ${shape}${hint}`;
  }
  if (original && parsed.id !== original.id) return `id 被改动：${parsed.id} ≠ ${original.id}`;
  if (original && parsed.domain !== original.domain) return `domain 被改动：${parsed.domain} ≠ ${original.domain}`;
  return `id=${parsed.id} domain=${parsed.domain} keys=${Object.keys(parsed).slice(0, 8).join(",")}`;
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
  const re = /(rate.?limit|too many requests|\b429\b|\b50[023]\b|\b40[123]\b|quota exceeded|insufficient balance|payment required|invalid[ _]api[ _]key|unauthorized|authentication (?:failed|error)|permission denied|throttl|overloaded|service busy|server busy|temporar(?:y|ily) unavailable|service unavailable|gateway timeout|connection reset|econnreset|etimedout|eai_again|enotfound|限流|请求过多|额度不足|余额不足|欠费|鉴权失败|服务繁忙|暂时不可用|网关超时)/i;
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
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
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

// killChildProcess / terminateActiveChildren 已弃用 —— CLI 子进程路径已删除(API 模式无 spawn)。
// 保留为 noop stub,防 runProcess / installSignalHandlers 旧引用炸。
function killChildProcess(_child, _signal = "SIGTERM") { /* noop,API 模式无 spawn */ }
function terminateActiveChildren(_signal = "SIGTERM") { /* noop,API 模式无 spawn */ }

function makeInterruptedError(signal = "SIGINT") {
  const error = new Error(`interrupted by ${signal}`);
  error.interrupted = true;
  return error;
}

// installSignalHandlers 简化版 —— 只设 shutdownRequested,所有循环自动检查后退出。
// API 模式没有外部 CLI 子进程,所以不再需要 terminateActiveChildren。
function installSignalHandlers() {
  let interrupted = false;
  const handle = (signal) => {
    shutdownRequested = true;
    if (interrupted) {
      console.log(`[INTERRUPT] 再次收到 ${signal}，强制退出。`);
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
    interrupted = true;
    console.log(`\n[INTERRUPT] 收到 ${signal}，正在停止当前精修任务。`);
    setTimeout(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    }, 3000).unref();
  };
  process.once("SIGINT", () => handle("SIGINT"));
  process.once("SIGTERM", () => handle("SIGTERM"));
}

// 暂停时键盘交互:Enter 继续 / a 自动探活 / s 跳过当前 / p 切回手动
function installPauseKeyboard() {
  if (!process.stdin.isTTY) return;
  process.stdin.setEncoding("utf8");
  let rawOn = false;
  const tryRaw = () => {
    if (rawOn) return;
    try { process.stdin.setRawMode(true); rawOn = true; } catch {}
  };
  const tryUnraw = () => {
    if (!rawOn) return;
    try { process.stdin.setRawMode(false); rawOn = false; } catch {}
  };
  const printHelp = () => {
    process.stdout.write(`\n[KEYS] [p] 暂停/手动模式  [Enter] 继续  [a] 自动探活  [s] 跳过当前  [Ctrl-C] 安全停止\n`);
  };
  tryRaw();
  process.stdin.resume();
  printHelp();
  pauseBus.on("pause", () => {
    tryRaw();
    process.stdin.resume();
    process.stdout.write(`\n[PAUSED] ${pauseBus.reason}\n[Enter] 继续 / [a] 自动探活 / [s] 跳过当前 / [p] 手动模式\n`);
  });
  pauseBus.on("resume", () => {
    process.stdout.write(`\n[RESUMED] 已恢复 (${pauseBus.describe().state})\n`);
  });
  process.on("exit", tryUnraw);
  process.stdin.on("data", (buf) => {
    const ch = buf.toString();
    if (ch === "") {
      tryUnraw();
      process.kill(process.pid, "SIGINT");
      return;
    }
    if (!pauseBus.isPaused() && ch.toLowerCase() === "p") {
      pauseBus.setPolicy("manual");
      pauseBus.pause({ reason: "用户主动暂停" });
      return;
    }
    if (!pauseBus.isPaused()) return;
    if (ch === "\r" || ch === "\n") {
      pauseBus.resume({ source: "manual-key" });
    } else if (ch.toLowerCase() === "a") {
      pauseBus.setPolicy("auto-probe");
      process.stdout.write("[POLICY] auto-probe(自动探活,额度恢复即续)\n");
      pauseBus.resume({ source: "manual-key" });
    } else if (ch.toLowerCase() === "s") {
      pauseBus.setPolicy("skip");
      process.stdout.write("[POLICY] skip(本篇丢弃,继续下一篇)\n");
      pauseBus.resume({ source: "manual-key-skip" });
    } else if (ch.toLowerCase() === "p") {
      pauseBus.setPolicy("manual");
      process.stdout.write("[POLICY] manual(手动继续)\n");
    }
  });
}

// runProcess: 仅用于跑确定性审计 / validate / sync 这类 Node 子脚本(不是 LLM 调用)。
// LLM 调用一律走 llmRunner.runRefine/runJudge/runBlockJudge(API 模式)。
async function runProcess(command, args, options, timeoutMs, progress = {}) {
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
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000).unref();
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
      } else if (code === 0 || progress.allowNonZero) {
        if (!progress.suppressDone) {
          console.log(`[DONE] ${label} elapsed=${formatDuration(elapsed)} ${outputKind}=${outputPath ? fileSizeLabel(outputPath) : `${stdout.length}B`}`);
        }
        resolve({ stdout, stderr, code });
      } else {
        const stderrTail = stderr.trim().slice(-600);
        const stdoutTail = stdout.trim().slice(-600);
        reject(new Error(
          `exit code=${code} signal=${signal || ""} ` +
          `stderr.tail=${stderrTail || "(empty)"} ` +
          `stdout.tail=${stdoutTail || "(empty)"}`,
        ));
      }
    });
  });
}

// buildCliArgs 已弃用 —— CLI 模式已删,API 模式不构造命令行参数。
function buildCliArgs(_cfg, _prompt, _model) { throw new Error("buildCliArgs 已弃用 —— API 模式不构造 CLI 参数"); }

// ===== 模型降级链已弃用 —— 由 scripts/llm/router.mjs 的 createRouter 接管（10min 滑动窗口 + 自动降级） =====
// 保留为空 stub 防旧调用点(refinePool / main)炸。
function makeModelState(_chain, _degradeAfter, _windowMs) { return { chain: [undefined], index: 0, degradeAfter: 0, windowMs: 0, failures: [] }; }
function currentModel(_modelState) { return undefined; }
function pruneWindow(_timestamps, _windowMs, _now) { /* noop */ }
function noteModelResult(_modelState, _result) { /* noop,降级由 router.mjs 内部管 */ }

// ===== 动态判官（LLM 9 维评审；只读/plan 预设，零写/工具权限）=====
// 判官输入全内嵌 prompt、输出一个小 review JSON 到 stdout，不需要任何写或工具执行权限。
// applyJudgePreset / buildJudgeFilePrompt / judgeProtocolError / extractJsonErrorLocation 已弃用
// —— CLI 文件协议路径已删除(API 模式用 response_format=json_schema strict,工具自动序列化,无需"文件协议+重试")。
// 保留为 stub 防旧引用炸。
function applyJudgePreset(_cli, timeoutMs) { return { baseArgs: [], modelArg: "--model", promptArg: null, promptMode: "positional", extraArgs: [], usePty: false, timeoutMs }; }
function buildJudgeFilePrompt(prompt, _cachePath, _previousError = "") { return prompt; }
function judgeProtocolError(message, extras = {}) { const err = new Error(message); err.judgeProtocolFailure = true; Object.assign(err, extras); return err; }
function extractJsonErrorLocation(_text, _error) { return null; /* API 模式 schema strict 校验,不需 line/col 定位 */ }

function strictParseJudgeJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const jsonLocation = extractJsonErrorLocation(text, error);
    throw judgeProtocolError(`${label} 写入的评审 JSON 非法：${error.message}`, { jsonLocation });
  }
}

// 单次判官调用：API 模式 —— 调 llmRunner.runJudge（自动应用 JUDGE_MODEL_CHAIN + 默认采样 + 降级 + 截断重试）。
async function runJudgeProcessJson(prompt, judge, model, ref, index, schema) {
  void judge; // API 模式不需要 judge.cliPath / judge.cfg
  const finalSchema = schema ?? JUDGE_REVIEW_SCHEMA;
  const attempts = judge?.jsonRetries ? judge.jsonRetries + 1 : 1;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (shutdownRequested) throw makeInterruptedError();
    await pauseBus.awaitResume();
    if (shutdownRequested) throw makeInterruptedError();
    const reqId = newReqId();
    liveEvents.emitEvent("llm.request", { reqId, topicRef: ref, kind: "judge", spec: model ?? null, attempt, attempts });
    try {
      const result = await llmRunner.runJudge({
        systemPrompt: "你是独立的内容质量评审 agent,只返回符合 schema 的 JSON 对象。",
        userPrompt: prompt,
        schema: finalSchema,
        modelChain: model ? [model] : undefined,
        onProgress: (e) => {
          if (e.type === "token") {
            liveEvents.emitEvent("llm.token", {
              reqId, topicRef: ref, tokens: e.tokens, lastLine: e.lastLine, spec: e.spec, kind: "judge",
            });
          }
        },
      });
      liveEvents.emitEvent("llm.done", { reqId, topicRef: ref, ok: true, kind: "judge", model: result.model, usage: result.usage });
      return result.parsed;
    } catch (error) {
      liveEvents.emitEvent("llm.done", { reqId, topicRef: ref, ok: false, kind: "judge", error: error.message });
      lastError = error;
      if (shutdownRequested || error.interrupted) throw error;
      const hit = availabilityFailureMatch(error.message ?? "");
      if (hit) error.availabilityFailure = true;
      if (attempt >= attempts) throw error;
      console.log(`[JUDGE] 评审失败,重试 ${attempt}/${attempts} ${ref}: ${error.message.slice(0, 200)}`);
    }
  }
  throw lastError ?? new Error(`判官失败：${ref}`);
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
        if (error.interrupted) throw error;
        // 判官协议失败（多次重试仍写坏 JSON）也只降级、绝不上抛——否则判前 runJudges 会一路抛穿
        // worker(无 catch) 把整轮 run 崩掉。这里当"该判官此次不可用"，reviews 为空时返回 null → 退回静态护栏。
        const tag = error.judgeProtocolFailure ? "JSON协议失败(降级静态)" : "评审失败";
        console.log(`[JUDGE] ${tag} ${ref} m=${model ?? "默认"} #${index + 1}: ${error.message}`);
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
  let batchFatal = null; // 批量协议失败时记下，后面降级单篇兜底
  const errorSamples = [];
  for (const model of judge.models) {
    for (let index = 0; index < judge.count; index += 1) {
      if (shutdownRequested) break;
      try {
        const parsed = await runJudgeProcessJson(prompt, judge, model, `batch:${items.length}`, index, QWEN_JUDGE_BATCH_SCHEMA);
        const normalized = normalizeJudgeBatchReviews(parsed, items);
        for (const { ref, review } of normalized) byRef.get(ref).push(review);
      } catch (error) {
        if (error.interrupted) throw error;
        // 批量 prompt 一旦坏掉（JSON 非法 / 模型遗漏 ref / 进程失败），整批 16 篇都拿不到结果。
        // 单批失败先记下来，整批所有 model × count 跑完后再决定要不要降级到单篇模式。
        batchFatal = batchFatal ?? error;
        const tag = error.judgeProtocolFailure ? "JSON 协议" : "进程";
        const tagModel = model ?? "默认";
        if (errorSamples.length < 3) errorSamples.push(`${tagModel} #${index + 1}: ${tag} ${error.message}`);
        console.log(
          `[JUDGE] 批量评审${tag}失败 m=${tagModel} #${index + 1}/${judge.count} ` +
            `size=${items.length}：${error.message}`,
        );
      }
    }
  }
  const out = new Map();
  const fallbackQueue = [];
  for (const item of items) {
    const agg = aggregateReviews(byRef.get(item.ref) ?? []);
    if (agg) {
      out.set(item.ref, agg);
      await writeJudgeCache(item.topic, judge, agg);
    } else if (batchFatal) {
      fallbackQueue.push(item);
    }
  }
  // 整批拿不到任何结果 -> 退到"单篇 runJudges"模式，避免一篇坏 JSON 把同批 N 篇全部拖垮。
  if (fallbackQueue.length) {
    console.log(
      `[JUDGE] 批量整批失败，降级为单篇模式重跑 ${fallbackQueue.length}/${items.length} 篇：` +
        `${fallbackQueue.map((item) => item.ref).slice(0, 4).join(",")}` +
        (fallbackQueue.length > 4 ? ` …+${fallbackQueue.length - 4}` : ""),
    );
    for (const item of fallbackQueue) {
      if (shutdownRequested) break;
      try {
        const agg = await runJudges(item.topic, item.ref, judge);
        if (agg) out.set(item.ref, agg); // writeJudgeCache 已在 runJudges 内部完成
      } catch (error) {
        if (errorSamples.length < 5) errorSamples.push(`single ${item.ref}: ${error.message}`);
        console.log(`[JUDGE] 单篇兜底仍失败 ${item.ref}：${error.message}`);
      }
    }
  }
  // 让上层（如 warmJudgeCacheForTargets）能识别"整批 model × count × 单篇兜底全部失败"。
  out.allFailed = items.length > 0 && out.size === 0 && batchFatal != null;
  out.firstError = batchFatal;
  out.errorSamples = errorSamples;
  return out;
}

function startJudgeHeartbeat(state, heartbeatMs, cfg) {
  if (!heartbeatMs || heartbeatMs <= 0 || cfg.progressStyle !== "summary") return () => {};
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    console.log(
      `[判官] 心跳 ${state.doneTopics}/${state.totalTopics} ${pct(state.doneTopics, state.totalTopics)} ` +
        `批次=${state.doneBatches}/${state.totalBatches} 缓存=${state.cachedTopics} ` +
        `运行=${state.activeBatches?.length ?? 0} ` +
        `剩余=${formatDuration(state.doneTopics ? remainingEtaByThroughput(state.doneTopics, state.totalTopics, state.startedAt) : (state.etaMs ?? 0))} 已用=${formatDuration(Date.now() - state.startedAt)}`,
    );
  }, heartbeatMs);
  heartbeat.unref();
  return () => clearInterval(heartbeat);
}

async function warmJudgeCacheForTargets(refs, judge, cfg = {}) {
  if (!judge?.enabled) return;
  const missing = [];
  for (const ref of refs) {
    try {
      const topic = JSON.parse(readFileSync(path.join(root, ref), "utf8"));
      if (!readJudgeCache(topic, judge)) missing.push({ ref, topic });
    } catch {
      // 读不到的 topic 交给后续单篇流程报错。
    }
  }
  const cachedTopics = refs.length - missing.length;
  if (!missing.length) {
    if (cfg.progressStyle !== "quiet") console.log(`[判官] 判前缓存命中 ${refs.length}/${refs.length}，无需预热`);
    return;
  }
  const batches = [];
  const batchSize = Math.max(1, judge.batchSize);
  for (let i = 0; i < missing.length; i += batchSize) {
    batches.push(missing.slice(i, i + batchSize));
  }
  // 并发数：默认 = 主流程 cfg.concurrency；可被 judge.warmConcurrency 覆盖；不超过批次数
  const requestedWarm = Math.max(1, Number(judge.warmConcurrency ?? cfg.concurrency ?? 1));
  const warmConcurrency = Math.min(requestedWarm, batches.length);
  // 起步 ETA：按 batch 单耗约 = min(timeoutMs, 180s) / 4 估算（保守占位）
  const initialBatchMs = Math.min(judge.cfg?.timeoutMs ?? 600000, 180000) / 4;
  const initialEtaMs = Math.ceil(batches.length / warmConcurrency) * initialBatchMs;
  if (cfg.progressStyle !== "quiet") {
    console.log(
      `[判官] 判前预热 missing=${missing.length} cached=${cachedTopics} batches=${batches.length} ` +
        `batchSize=${batchSize} 并发=${warmConcurrency} 预计=${formatDuration(initialEtaMs)}`,
    );
    if (cfg.progressStyle === "summary" && !dashboard.enabled) console.log(progressHeader("JUDGE"));
  }
  const state = {
    doneTopics: 0,
    totalTopics: missing.length,
    doneBatches: 0,
    totalBatches: batches.length,
    cachedTopics,
    startedAt: Date.now(),
    etaMs: initialEtaMs,
    activeBatches: [],
  };
  const useDashboard = dashboard.enabled;
  if (useDashboard) dashboard.updateJudge(state);
  // dashboard 启用时由它的 1s 重绘 timer 顶替心跳行；未启用时走旧的 console.log 心跳。
  const stopHeartbeat = useDashboard ? () => {} : startJudgeHeartbeat(state, cfg.heartbeatMs, cfg);
  let cursor = 0;
  let aborted = null;
  // 防呆：第一批整批失败 / 连续 N 批整批失败 -> 立刻 abort 整个预热。
  // 避免开局就配错（envKey 缺失、baseURL 不通、模型名错配）后还白跑剩下所有 batch。
  let firstBatchFailed = false;
  let consecutiveAllFailed = 0;
  const maxConsecutiveAllFailed = Math.min(3, batches.length);
  function buildAbortError(out, batchIdx) {
    const samples = (out.errorSamples || []).slice(0, 3);
    const judgeModels = (judge.models || []).map((m) => m ?? "默认").join(", ") || "(默认)";
    const cliPath = judge.cfg?.cliPath || judge.cfg?.cli || "(未知)";
    const stem = batchIdx === 0
      ? "判官预热第一批整批失败"
      : `判官预热连续 ${consecutiveAllFailed} 批整批失败`;
    const hint = "请检查：① 模型名是否正确（modelChain）② 对应的 envKey/API Key 是否已设置 ③ baseURL 是否可达 ④ CLI 是否能独立运行";
    const err = new Error(
      `${stem}（model × count × 单篇兜底全部失败），中止预热以避免空跑。\n` +
        `  judge models: ${judgeModels}\n` +
        `  judge CLI:    ${cliPath}\n` +
        (samples.length ? `  错误样例:\n    - ${samples.join("\n    - ")}\n` : "") +
        `  ${hint}`,
    );
    err.cause = out.firstError;
    return err;
  }
  async function warmWorker() {
    while (true) {
      if (shutdownRequested || aborted) return;
      const idx = cursor;
      if (idx >= batches.length) return;
      cursor += 1;
      const batch = batches[idx];
      let result;
      try {
        state.activeBatches.push({ idx, refs: batch.map((item) => item.ref), startedAt: Date.now() });
        if (useDashboard) {
          dashboard.updateJudge(state);
        } else if (cfg.progressStyle !== "quiet") {
          console.log(`[判官] start batch ${idx + 1}/${state.totalBatches} refs=${batch.map((item) => item.ref).join(",")}`);
        }
        result = await runJudgeBatch(batch, judge);
      } catch (error) {
        if (cfg.progressStyle !== "quiet") console.log(`[判官] fail batch ${idx + 1}/${state.totalBatches} refs=${batch.map((item) => item.ref).join(",")} error=${error.message}`);
        aborted = error;
        return;
      } finally {
        state.activeBatches = state.activeBatches.filter((entry) => entry.idx !== idx);
        if (useDashboard) dashboard.updateJudge(state);
      }
      if (result?.allFailed) {
        if (idx === 0) firstBatchFailed = true;
        consecutiveAllFailed += 1;
        if (firstBatchFailed && idx === 0) {
          aborted = buildAbortError(result, 0);
          return;
        }
        if (consecutiveAllFailed >= maxConsecutiveAllFailed) {
          aborted = buildAbortError(result, idx);
          return;
        }
      } else {
        consecutiveAllFailed = 0;
      }
      state.doneBatches += 1;
      state.doneTopics += batch.length;
      state.etaMs = remainingEtaByThroughput(state.doneTopics, state.totalTopics, state.startedAt);
      if (useDashboard) {
        dashboard.updateJudge(state);
      } else if (cfg.progressStyle === "summary") {
        console.log(
          formatJudgeProgress(
            state.doneBatches,
            state.totalBatches,
            state.doneTopics,
            state.totalTopics,
            cachedTopics,
            batch.map((item) => item.ref),
            state.startedAt,
          ),
        );
      } else if (cfg.progressStyle === "topic") {
        console.log(
          `[判官] batch ${state.doneBatches}/${state.totalBatches} done=${state.doneTopics}/${state.totalTopics} ` +
            `refs=${batch.map((item) => item.ref).join(",")}`,
        );
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: warmConcurrency }, () => warmWorker()));
    if (aborted) throw aborted;
    if (cfg.progressStyle !== "quiet") {
      console.log(`[判官] 判前预热完成 missing=${missing.length} cached=${cachedTopics} batches=${state.doneBatches}/${state.totalBatches} 用时=${formatDuration(Date.now() - state.startedAt)}`);
    }
  } finally {
    stopHeartbeat();
    if (useDashboard) dashboard.clearJudge();
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
        const parsed = await runJudgeProcessJson(prompt, judge, model, `block:${ref}`, index, QWEN_BLOCK_JUDGE_SCHEMA);
        const reviews = normalizeBlockJudgeReview(parsed, blocks);
        for (const review of reviews) byKey.get(review.key)?.push(review);
      } catch (error) {
        if (error.interrupted) throw error;
        // 同 runJudges：块级判官协议失败也只降级（返回 null → 块级 keep-best 退回静态/整篇判定），不上抛崩溃。
        const tag = error.judgeProtocolFailure ? "块级JSON协议失败(降级)" : "块级评审失败";
        console.log(`[JUDGE] ${tag} ${ref} m=${model ?? "默认"} #${index + 1}: ${error.message}`);
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
async function runAudit(minScore, cfg = {}) {
  const startedAt = Date.now();
  if (cfg.progressStyle !== "quiet") console.log(`[AUDIT] 开始 minScore=${minScore}`);
  const result = await runProcess(
    process.execPath,
    ["scripts/content_quality_audit.mjs", "--json", `--min-score=${minScore}`],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    Math.max(cfg.timeoutMs ?? 600000, 600000),
    {
      label: "AUDIT",
      heartbeatMs: cfg.heartbeatMs ?? 60000,
      suppressSpawn: true,
      suppressDone: true,
      suppressHeartbeat: cfg.progressStyle === "quiet",
      allowNonZero: true,
    },
  );
  if (!result.stdout) {
    throw new Error(`审计未产出结果：${result.stderr || `exit ${result.code}`}`);
  }
  const audit = JSON.parse(result.stdout);
  audit.failingMap = new Map((audit.failingTopics ?? []).map((topic) => [topic.ref, topic]));
  audit.scoreMap = new Map((audit.allTopics ?? []).map((topic) => [topic.ref, topic.score]));
  if (cfg.progressStyle !== "quiet") {
    console.log(`[AUDIT] 完成 overall=${audit.overallScore}/100 failing=${audit.failingTopicCount}/${audit.topicCount} elapsed=${formatDuration(Date.now() - startedAt)}`);
  }
  return audit;
}

// 进程内构建语料库，供 keep-best 用同一套 scoreTopic 算法给"候选 vs 现版"打分做对比。
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

function buildRefinePrompt(topic, failingInfo, templates, minScore, deterministicScore, cachePath, findingLines = [], previousError = null) {
  const todayYmd = new Date().toISOString().slice(0, 10);
  const spec = REFINE_SPEC.split("${todayYmd}").join(todayYmd);
  const issues = failingInfo?.issues ?? [];
  const tmpl = templates ?? [];
  // 上一次输出解析失败 → 把"具体哪坏了 + 位置上下文"喂回去，让模型精准修格式，而不是同 prompt 再撞一次。
  // 关键诉求：失败要因为内容不够好，而不是少括号/少逗号/裸引号/中英文标点这种格式问题。
  let retryBlock = "";
  if (previousError) {
    const message = typeof previousError === "string" ? previousError : previousError.message;
    const jsonLocation = typeof previousError === "string" ? null : previousError.jsonLocation;
    const locLine = jsonLocation
      ? `\n上次失败位置：line ${jsonLocation.line} column ${jsonLocation.column}（offset=${jsonLocation.position}）。该位置上下文（| 标断点附近）：\n${jsonLocation.context}\n最常见原因：某个字符串值里写了未转义的 ASCII 双引号或裸换行，把字符串/对象提前截断了。\n`
      : "";
    retryBlock = `\n【上一次输出无法被程序解析，必须修正——这是 JSON 格式问题，不是内容问题，不要因此删改内容】${message}${locLine}修正要点：① 整份必须是一个能被 JSON.parse 通过的对象；② 字符串值里的双引号一律转义为 \\\\" 或改用中文「」/反引号；③ 换行用 \\\\n，不要写裸换行；④ 不要漏逗号、不要留多余 trailing comma、所有括号要配对闭合。请以下面【当前 topic JSON】为基底重写、只改文字内容，不要解释。\n`;
  }
  const judgeBlock = findingLines.length
    ? `\n【动态判官（资深评审）指出的具体缺口——这是"每一块更精准"的重点，逐条消除】\n${findingLines
        .map((line, index) => `${index + 1}. ${line}`)
        .join("\n")}\n`
    : "";
  const issueBlock = issues.length
    ? issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
    : "（确定性审计未列出扣分明细，可能已经达到静态阈值；这不是内容达标证明。请按上面 9 维重新做专家级审读，找出静态规则遗漏的事实薄弱、表达空泛、结构不顺、面试不可用、图表泛化、追问浅等问题。）";
  const templateBlock = tmpl.length
    ? `\n【跨 topic 模板句——下列句子在多篇里逐字重复，必须改写成本题专属的具体表达，禁止照抄】\n${tmpl
        .map((entry) => `- （在 ${entry.count} 篇里重复）${entry.sentence}`)
        .join("\n")}\n`
    : "";
  const dynamicRules = allowComplexMermaid
    ? "REFINE_ALLOW_COMPLEX_MERMAID=true: diagram uses subgraph(<=2 levels), stateDiagram(-v2), sequenceDiagram, classDef 5-color palette; banned: classDiagram/gantt/pie/journey/erDiagram/mindmap and bare style. sources: svg -> mermaid -> text."
    : "REFINE_ALLOW_COMPLEX_MERMAID=false: diagram only simple flowchart/graph + direction header, sources only svg/mermaid/text.";
  return `${spec}
${retryBlock}
【统一知识精修标准】
标准版本：${CONTENT_STANDARD_VERSION}。production-strict 目标静态/动态均 ≥${PRODUCTION_STRICT_MIN_SCORE}；当前命令行 minScore 只是本次运行门槛，不代表内容已经达到人工精品。

${diagramPolicyPrompt()}

【本次精修功能开关】
${dynamicRules}

【本篇当前确定性审计分】${deterministicScore ?? failingInfo?.score ?? "?"}/100，静态验收线 ${minScore}。
静态分数只是验收兜底，不是跳过理由。你必须先在内部按真人专家口径重新评分和找问题，再直接输出精修后的完整 JSON；不要输出评分过程。

【本篇被扣分的具体缺口（务必逐条消除）】
${issueBlock}
${templateBlock}${judgeBlock}
【降低格式出错的关键做法（务必照做）】下面【当前 topic JSON】本身就是一份格式完全正确的模板。请把它当基底：保持所有字段名、括号层级、引号转义方式与它一致，只改写需要提升的"文字内容"，不要重排结构、不要新造字段名、不要改动你没必要改的部分的标点与转义。这样能把 JSON 格式出错概率降到最低——记住：我们要的失败是"内容不够好"，绝不接受"少括号/少逗号/裸引号/中英文标点"这类格式失败。

${cachePath ? `【输出要求】不要在 stdout 输出 JSON 内容、不要解释、不要 markdown 代码围栏。把改写后的完整 topic JSON 对象（从 { 开始到 } 结束、单一对象、合法 JSON）写入下面这个绝对路径的文件：
${cachePath}

写入规则（重要，必须遵守）：
1. 文件初始为空。如果你的写文件工具一次能写下完整 JSON，就一次写完；如果 JSON 很长担心被工具/响应截断，请分多次调用写文件工具，按"追加(append)"模式把 JSON 切成 2~5 个连续片段顺序写入同一个文件，最终拼起来仍是一个合法 JSON 对象。
2. 全部写完后，必须再调用一次写文件工具，往该文件末尾追加一行结束标记：
//---END---
这行是给主进程识别"写完了"用的，不要省略，也不要写成别的样子（区分大小写）。
3. 完成上述写入后，在 stdout 只输出一行：
WROTE:${cachePath}
不要在 stdout 输出 JSON 内容或任何其它文字。` : `【输出要求】通过 structured_output 工具一次性返回改写后的【完整 topic JSON 对象】：以下面【当前 topic JSON】为基底，保持所有字段名、层级、数组结构不变，只改写需要提升的文字内容；原有字段一个都不能少、不得缩水或删除。只调用一次 structured_output，不要解释、不要走普通文本输出。`}

今天日期是 ${todayYmd}，updatedAt 必须设为该值。
// API 模式: response_format=json_schema strict 工具自动序列化 JSON 字符串值,模型只需写真实换行 / 真实空格 / 中文「」/反引号,不再需要 STRUCTURED_STRING_RULES / JSON_STRING_RULES 那套手写转义规则。
// 旧 cachePath 路径已删,故此三元表达式直接固定返回空字符串(原本走 STRUCTURED_STRING_RULES 的分支已被 API 路径统一收编)。

【当前 topic JSON】
${JSON.stringify(topic, null, 2)}
`;
}

function isSvgAssetPath(value) {
  return typeof value === "string" && /\.svg(?:[?#].*)?$/i.test(value.trim());
}

function topicDiagramCards(topic) {
  return (topic.learningCards ?? []).filter((card) => card?.type === "diagram" || card?.type === "animation");
}

function cardHasSvg(card) {
  if (!card || typeof card !== "object") return false;
  if (card.format === "svg" || typeof card.svg === "string") return true;
  if (isSvgAssetPath(card.svgPath) || isSvgAssetPath(card.asset)) return true;
  return (Array.isArray(card.sources) ? card.sources : []).some((source) => source?.kind === "svg" || isSvgAssetPath(source?.path));
}

function cardHasMermaidOrTextFallback(card) {
  if (!card || typeof card !== "object") return false;
  if (typeof card.fallback === "string" && card.fallback.trim().length >= 12) return true;
  if (typeof card.caption === "string" && card.caption.trim().length >= 12) return true;
  return (Array.isArray(card.sources) ? card.sources : []).some(
    (source) =>
      (source?.kind === "mermaid" || source?.kind === "text") &&
      typeof source.content === "string" &&
      source.content.trim().length >= 12,
  );
}

function cardHasTextualFallback(card) {
  if (!card || typeof card !== "object") return false;
  if (typeof card.fallback === "string" && card.fallback.trim().length >= 12) return true;
  if (typeof card.caption === "string" && card.caption.trim().length >= 12) return true;
  return (Array.isArray(card.sources) ? card.sources : []).some(
    (source) => source?.kind === "text" && typeof source.content === "string" && source.content.trim().length >= 12,
  );
}

function collectSvgPaths(topic) {
  const paths = new Set();
  for (const card of topicDiagramCards(topic)) {
    for (const value of [card.svgPath, card.asset]) {
      if (isSvgAssetPath(value)) paths.add(value.trim());
    }
    for (const source of Array.isArray(card.sources) ? card.sources : []) {
      if (source?.kind === "svg" && isSvgAssetPath(source.path)) paths.add(source.path.trim());
    }
  }
  return paths;
}

function assetExists(relPath) {
  if (typeof relPath !== "string" || !relPath.startsWith("assets/") || relPath.includes("..") || path.isAbsolute(relPath)) {
    return false;
  }
  try {
    return statSync(path.join(root, relPath)).isFile();
  } catch {
    return false;
  }
}

function checkDiagramModalityInvariants(original, parsed) {
  const originalSvgPaths = collectSvgPaths(original);
  const candidateSvgPaths = collectSvgPaths(parsed);
  for (const svgPath of candidateSvgPaths) {
    if (!originalSvgPaths.has(svgPath) && !assetExists(svgPath)) {
      return `候选新增 SVG 路径但资源不存在：${svgPath}`;
    }
  }
  for (const card of topicDiagramCards(parsed)) {
    if (!cardHasTextualFallback(card)) {
      return `图解缺少可读 fallback/caption/text 兜底：${card.title ?? ""}`;
    }
    const sources = Array.isArray(card.sources) ? card.sources : [];
    if (sources.some((source) => source?.kind === "svg") && !sources.some((source) => source?.kind === "mermaid" || source?.kind === "text")) {
      return `diagram/animation sources 含 SVG 但缺少 mermaid/text 降级兜底：${card.title ?? ""}`;
    }
    if (cardHasSvg(card) && !cardHasMermaidOrTextFallback(card)) {
      return `SVG 图解缺少可读 fallback/caption/mermaid/text 兜底：${card.title ?? ""}`;
    }
  }
  return null;
}

// 落盘前的 schema 不变量：只防"身份被改 / 内容被掏空 / 结构损坏"，质量好坏交给审计判。
function checkInvariants(original, parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "输出不是 JSON 对象";
  for (const key of ["id", "domain", "category"]) {
    if (parsed[key] !== original[key]) return `${key} 被改动（${original[key]} -> ${parsed[key]}）`;
  }
  if (parsed.status !== "production") return `status 必须保持 production，实际为 ${parsed.status}`;
  // difficulty 不得下调：下调会软化审计的所有难度阈值（字数/必备 explain 数/取舍-失败 cap），是直白的"把难题伪装成简单题"刷分通道。
  if (typeof original.difficulty === "number") {
    if (typeof parsed.difficulty !== "number") return `difficulty 缺失或非数字（原 ${original.difficulty}）`;
    if (parsed.difficulty < original.difficulty) return `difficulty 被下调（${original.difficulty} -> ${parsed.difficulty}），禁止下调`;
  }
  // 元数据值锁定：精修只改"内容"，这些字段是身份/排序/打分输入，改动多半是刷分（如改 tags 让 topicAlignment 虚高）或漂移。
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
  const diagramModalityBad = checkDiagramModalityInvariants(original, parsed);
  if (diagramModalityBad) return diagramModalityBad;

  const mermaidHeadRe = allowComplexMermaid
    ? /^\s*(?:(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)|stateDiagram(?:-v2)?|sequenceDiagram)\b/
    : /^\s*(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)\b/;
  const mermaidBlacklist = allowComplexMermaid
    ? /\b(?:classDiagram|gantt|pie|journey|erDiagram|mindmap)\b/
    : /\b(?:subgraph|classDef|style|sequenceDiagram|classDiagram|stateDiagram|mindmap|gantt|pie|journey|erDiagram)\b/;
  const sourceKinds = new Set(["svg", "mermaid", "text"]);
  for (const card of cards) {
    if (Array.isArray(card.sources)) {
      for (let i = 0; i < card.sources.length; i += 1) {
        const source = card.sources[i];
        if (!sourceKinds.has(source?.kind)) return `sources[${i}].kind 非法：${card.title ?? ""}`;
        const hasPath = typeof source.path === "string" && source.path.trim();
        const hasContent = typeof source.content === "string" && source.content.trim();
        if (Boolean(hasPath) === Boolean(hasContent)) return `sources[${i}] 必须且只能提供 path 或 content：${card.title ?? ""}`;
        if (hasPath && (!source.path.startsWith("assets/") || source.path.includes("..") || path.isAbsolute(source.path))) {
          return `sources[${i}].path 越界或不在 assets/：${card.title ?? ""}`;
        }
      }
    }
    const mermaidSources = Array.isArray(card.sources) ? card.sources.filter((source) => source?.kind === "mermaid") : [];
    const mermaidContents = card.type === "diagram" && card.format === "mermaid"
      ? [card.content, ...mermaidSources.map((source) => source.content)]
      : mermaidSources.map((source) => source.content);
    for (const contentValue of mermaidContents) {
      const content = typeof contentValue === "string" ? contentValue : "";
      if (!mermaidHeadRe.test(content)) {
        return `diagram(mermaid) 图类型头不合法：${card.title ?? ""}`;
      }
      if (mermaidBlacklist.test(content)) {
        return `diagram(mermaid) 含禁用语法：${card.title ?? ""}`;
      }
      if (allowComplexMermaid) {
        if (/^\s*style\s+/m.test(content)) return `diagram(mermaid) 禁止裸 style 行：${card.title ?? ""}`;
        for (const line of content.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.startsWith("classDef "))) {
          if (!/^classDef\s+(ok|warn|fail|async|highlight)\s+fill:#[0-9a-fA-F]{6}(?:,stroke:#[0-9a-fA-F]{6})?(?:,color:#[0-9a-fA-F]{6})?$/.test(line)) {
            return `diagram(mermaid) classDef 只能使用 5 色板：${card.title ?? ""}`;
          }
        }
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
    .replace(/[\s、，,。:：/()（）\-_.+【】\[\]#*_`|>~"'""‘’]+/g, "")
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
      // 地板用棘轮口径（与纯静态 staticRegressionVectorAccepts 一致）：现版 ≥90 才要求候选 ≥90；
      // 现版本来 <90 时只要求"候选不低于现版"，让 80->85 这类真实改善也能逐格上挪，而不是被 90 硬地板退回更差旧版。
      ? acceptByJudge({ before: beforeReview, after: mergedReview, staticBefore: beforeStaticReport.score, staticAfter: mergedStaticReport.score, minStatic: Math.min(90, beforeStaticReport.score) })
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
// corpus 用于落盘前的静态 keep-best：候选静态分不严格高于现版就保留旧版（"越跑越高、不许改烂"）。
// setPhase(phase): 可选回调，用于把当前阶段标签写回 pool 的 active map，
// 让 summary 心跳能区分子 agent 当前是 judgeBefore/refineCall/blockJudge/judgeAfter/merging 哪个阶段。
async function refineOneTopic(ref, audit, templates, cfg, cliPath, runDir, minScore, model, writeTo, corpus, judge, setPhase) {
  const phase = typeof setPhase === "function" ? setPhase : () => {};
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
    stallTimeoutMs: cfg.stallTimeoutMs,
  };
  const safeRef = ref.replace(/[^a-z0-9]+/gi, "-");
  const cacheDir = path.join(runDir, "topic-cache");
  await mkdir(cacheDir, { recursive: true });
  let lastError = null;
  let availabilityFailure = false;
  let keptOld = false; // 最近一次结果是"候选合法但未优于现版、保留旧版"（非执行失败）
  let bestRejectedAfter = null; // 被 keep-best 拒掉的候选里最高的静态分，用于诊断
  // 静态基线（现版）：候选与现版用同一 corpus/算法对比；original 不随 attempt 变，算一次即可。
  const staticBeforeReport = corpus
    ? scoreTopic(original, ref, corpus)
    : { score: audit.scoreMap.get(ref) ?? 0, issueCount: audit.failingMap.get(ref)?.issues?.length ?? 0, issues: audit.failingMap.get(ref)?.issues ?? [], metrics: { dimensions: {} } };
  const staticBefore = staticBeforeReport.score;
  // 判前：对现版判一次（按 contentHash 缓存）。用于 ①"已达标则不浪费改写" ②keep-best 基线 ③findings 喂改写。
  let beforeReview = null;
  let findingLines = [];
  if (!writeTo && judge?.enabled) {
    phase("judgeBefore");
    beforeReview = await runJudges(original, ref, judge);
    if (!beforeReview) {
      // 判官启用 = 判官必需。判前（已含 judge 内部 jsonRetries）仍拿不到动态评审 → 绝不退回"双静态"（那不是精修），
      // 直接判该篇失败、计入最终报告的"判官评审失败"。本轮该篇静态若仍 <minScore，下一轮会重新进队列再试（跨轮重试）。
      console.log(`[TOPIC] 判官评审失败（判前），判该篇失败 ${ref}`);
      return {
        ok: false,
        attempts: 0,
        error: "判官评审失败（判前无法获得动态评审，已重试到上限）",
        judgeFailure: true,
        availabilityFailure: false,
        keptOld: false,
        action: "failed",
        staticBefore,
        staticAfter: null,
        dynamicBefore: undefined,
      };
    }
    findingLines = findingsToPromptLines(beforeReview);
    if (staticBefore >= minScore && judgePasses(beforeReview, judge.dynamicSkipMin)) {
      console.log(`[TOPIC] 已达标，跳过改写 ${ref}（static ${staticBefore} + 动态 ${beforeReview.score}，9 维全过、无事实问题）`);
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
  // 上一次 attempt 若是"格式/解析类失败"（非 keptOld），把结构化错误喂回下一次 prompt 让模型精准修格式。
  let previousFormatError = null;
  let attemptsMade = 0; // 实际跑了几次（keptOld 会 break，真实次数 < 配置上限），用于汇总重试统计不虚高
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attemptsMade = attempt;
    phase("refineCall");
    const tmp = mkdtempSync(path.join(tmpdir(), "quality-refine-"));
    const attemptLabel = `${mode} ${ref} attempt=${attempt}/${attempts} model=${model ?? "默认链"}`;
    let parsed;
    let raw = ""; // 结构化路径不产文本；finally 的 raw 落盘诊断保留。
    try {
      // ====== API 模式统一走 callRefineApi（其内部已调 llmRunner.runRefine,自动应用 REFINE_MODEL_CHAIN + 截断重试 + 降级 + 流式 onProgress）======
      const prompt = buildRefinePrompt(original, audit.failingMap.get(ref), templates.get(ref), minScore, audit.scoreMap.get(ref), null, findingLines, previousFormatError);
      console.log(`[TOPIC] 开始 ${attemptLabel} score=${score}/100（API 模式）`);
      const reqId = newReqId();
      liveEvents.emitEvent("llm.request", { reqId, topicRef: ref, kind: "refine", spec: model ?? null, attempt, attempts });
      const onTokenProgress = (e) => {
        if (e.type === "token") {
          liveEvents.emitEvent("llm.token", {
            reqId, topicRef: ref, tokens: e.tokens, lastLine: e.lastLine, spec: e.spec,
          });
          // 把 token 进度写到 active map,固定栏即时可见
          phase(undefined, { tokens: e.tokens, lastLine: e.lastLine, spec: e.spec, kind: "refine" });
        } else if (e.type === "retry") {
          liveEvents.emitEvent("llm.retry", { reqId, topicRef: ref, attempt: e.attempt, reason: e.reason, spec: e.spec });
          phase(undefined, { lastLine: `重试: ${e.reason}` });
        } else if (e.type === "fallback-non-stream") {
          liveEvents.emitEvent("llm.fallback", { reqId, topicRef: ref, spec: e.spec, kind: "non-stream" });
          phase(undefined, { lastLine: "退化非流式" });
        } else if (e.type === "schema-fallback") {
          phase(undefined, { lastLine: `schema-fallback→${e.mode}` });
        }
      };
      try {
        const apiResult = await callRefineApi(prompt, buildTopicSchema(original), {
          model, sampling: undefined, timeoutMs: cfg.timeoutMs, onProgress: onTokenProgress,
        });
        parsed = apiResult.parsed;
        liveEvents.emitEvent("llm.done", {
          reqId, topicRef: ref, ok: true, durationMs: apiResult.durationMs,
          model: apiResult.model, usage: apiResult.usage,
        });
      } catch (apiError) {
        liveEvents.emitEvent("llm.done", { reqId, topicRef: ref, ok: false, error: apiError.message });
        if (apiError.availabilityFailure) availabilityFailure = true;
        throw apiError;
      }
      availabilityFailure = false;
      console.log(`[TOPIC] LLM 已返回（API）${ref}`);
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
        // 点名具体哪条契约挂了：之前只打 slice(0,8) 顶层键，曾把"learningCards 被结构化输出包成
        // {item:[...]} 对象"这种 schema 坑误导成"只剩 8 个键/丢内容"，排查走了弯路。
        throw new Error(`CLI 输出 JSON 不是当前 topic 契约（${describeContractMiss(parsed, original)}）`);
      }
      const bad = checkInvariants(original, parsed);
      if (bad) throw new Error(`schema 不变量失败：${bad}`);
      if (writeTo) {
        // 预览模式：直接写候选产物，不做 keep-best（预览本就是看"这次会改成什么样"）。
        await mkdir(path.dirname(writeTo), { recursive: true });
        await writeFile(writeTo, `${JSON.stringify(parsed, null, 2)}\n`);
        console.log(`[TOPIC] 预览产物已写入 ${path.relative(root, writeTo)}`);
        console.log(`[TOPIC] 完成 ${attemptLabel}`);
        return { ok: true, attempts: attempt, availabilityFailure: false };
      }
      // 正式落盘 = keep-best：候选与现版用同一 corpus/算法算静态分；判官开启时再叠加"回归向量"动态判据。
      const afterStaticReport = corpus
        ? scoreTopic(parsed, ref, corpus)
        : { score: staticBefore + 1, issueCount: 0, issues: [], metrics: { dimensions: {} } };
      const after = afterStaticReport.score;

      // Phase 3：块级 keep-best。先只吸收"单独替换也能让静态向量不退且有改善"的块，
      // 再对拼好的整篇复判；复判不过则降级为下面的整篇接受/拒绝。
      let blockResult = null;
      if (corpus) {
        phase("blockJudge");
        blockResult = await tryBlockKeepBest({ original, candidate: parsed, ref, corpus, beforeStaticReport: staticBeforeReport, beforeReview, judge });
        if (blockResult.accept) {
          phase("merging");
          await writeTopicAtomic(ref, blockResult.topic);
          console.log(
            `[TOPIC] 块级合并已写回 ${ref}（${blockResult.reason}，吸收 ${blockResult.mergedBlocks.length}/${blockResult.changedBlocks} 块` +
              `${blockResult.review ? `，动态 ${beforeReview.score}->${blockResult.review.score}` : ""}）`,
          );
          console.log(`[TOPIC] 完成 ${attemptLabel}`);
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
        if (blockResult.attempted) {
          console.log(`[TOPIC] 块级合并未采用 ${ref}: ${blockResult.reason}，降级整篇判定`);
        }
      }

      let decision;
      let afterReview = null;
      if (judge?.enabled && beforeReview) {
        // 判后：对候选判一次。回归向量（不退步任一维 + 不新增事实问题 + 静态≥90 + 至少一处改善）才接受。
        // 不拿"总分"当唯一开关，避免误杀"部分更好但总分波动"的候选（这是块级合并前的整篇近似）。
        phase("judgeAfter");
        afterReview = await runJudges(parsed, ref, judge);
        if (afterReview) {
          // 棘轮地板：现版 ≥90 守 90；现版 <90 时只要不低于现版即可接受真实改善（避免把更好的 <90 候选退回更差旧版）。
          decision = acceptByJudge({ before: beforeReview, after: afterReview, staticBefore, staticAfter: after, minStatic: Math.min(90, staticBefore) });
        } else {
          // 判官启用但判后拿不到评审：绝不退回"双静态"放行（那不是精修）。抛出 → 被 attempt catch 捕获 → 重试；
          // 重试到上限仍失败 → 该篇计入最终报告的"判官评审失败"。磁盘保留旧版（绝不在无动态信号下覆盖）。
          const judgeErr = new Error("判官评审失败（判后无法获得动态评审，已重试到上限）");
          judgeErr.judgeFailure = true; // 标记：这是判官坏了，不是精修输出格式坏了 —— 别把它当格式错误喂回 prompt
          throw judgeErr;
        }
      } else {
        // --no-judge（用户显式选择纯静态模式）：Phase 1 静态严格护栏（候选静态分必须严格高于现版）。
        // 注意：judge 启用时不会走到这里——判前拿不到评审已直接判失败，不存在"judge 启用却退静态"的路径。
        decision = { accept: after > staticBefore, reason: after > staticBefore ? `static ${staticBefore} -> ${after}` : `static ${after} <= ${staticBefore}` };
      }
      const duplicate = duplicateBlockRegression(original, parsed);
      if (decision.accept && duplicate) {
        decision = { accept: false, reason: `重复块守卫：${duplicate}` };
      }
      if (decision.accept) {
        phase("merging");
        await writeTopicAtomic(ref, parsed);
        console.log(`[TOPIC] 已写回 ${ref}（${decision.reason}${afterReview ? `，动态 ${beforeReview.score}->${afterReview.score}` : ""}）`);
        console.log(`[TOPIC] 完成 ${attemptLabel}`);
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
      // 候选未优于现版：保留旧版、本 attempt 不写。记为 keptOld。
      // 不在同一次调用里重试——本轮 prompt/findings 不变，同 prompt 再调一次对确定性模型是纯浪费（实测会 double 调用）；
      // retries 语义是"失败重试"，keptOld 是"合法但没更好"不算失败。真要再 roll，交给跨轮循环（下一轮带新审计/findings 再试）。
      keptOld = true;
      bestRejectedAfter = bestRejectedAfter === null ? after : Math.max(bestRejectedAfter, after);
      lastError = new Error(`候选未优于现版，保留旧版（${decision.reason}）`);
      console.log(`[TOPIC] 保留旧版 ${attemptLabel}: ${decision.reason}`);
      lastError.decisionReason = decision.reason;
      break;
    } catch (error) {
      if (error.interrupted || shutdownRequested) throw error;
      keptOld = false; // 本 attempt 是真失败（CLI/解析/契约/不变量），不是"保留旧版"
      lastError = error;
      // 把本次失败喂回下一次 attempt 的 prompt：解析/格式类错误带上 jsonLocation，让模型精准修格式而不是再撞一次。
      // 可用性失败（限流/超时）、判官失败（判官坏了不是精修输出坏了）都不喂回——否则会误导模型"你的 JSON 坏了"。
      previousFormatError = error.availabilityFailure || error.judgeFailure
        ? null
        : { message: error.message, jsonLocation: error.jsonLocation ?? null };
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
    attempts: attemptsMade, // 实际尝试次数（keptOld break 后 < 配置上限），避免汇总把"一次就保留旧版"误报成触发了重试
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

function pct(done, total) {
  if (!total) return "0.0%";
  return `${((done / total) * 100).toFixed(1)}%`;
}

function avgDuration(counters) {
  const count = counters.timed ?? 0;
  return count ? (counters.topicMs ?? 0) / count : 0;
}

function remainingEtaByAverage(counters, cfg) {
  const avg = avgDuration(counters);
  if (!avg || !counters.total || !counters.processed) return 0;
  const remaining = Math.max(0, counters.total - counters.processed);
  const concurrency = Math.max(1, Math.min(cfg.concurrency ?? 1, remaining || 1));
  return (remaining * avg) / concurrency;
}

function remainingEtaByThroughput(done, total, startedAt) {
  if (!done || !total || !startedAt) return 0;
  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, total - done);
  return remaining ? (elapsed / done) * remaining : 0;
}

function compactRef(ref, max = 42) {
  const text = String(ref).replace(/^topics\//, "").replace(/\.json$/, "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(8, max - 18))}...${text.slice(-15)}`;
}

function progressHeader(kind) {
  if (kind === "JUDGE") {
    return "[判官] 批次    完成     进度     已用    剩余    缓存  最新";
  }
  return "[精修] 完成     进度    免改 写回 合并 保留 失败 运行(判/生)   均时   剩余   已用  最新";
}

function maybePrintProgressHeader(kind, index) {
  if (index === 1 || (index - 1) % 24 === 0) console.log(progressHeader(kind));
}

function outcomeLabel(outcome) {
  return {
    good: "免改",
    ok: "写回",
    merg: "合并",
    keep: "保留",
    fail: "失败",
  }[outcome] ?? outcome;
}

function formatRefineProgress(snapshot, active, outcome, ref, cfg, counters) {
  const latest = `${outcomeLabel(outcome)} ${compactRef(ref)}`;
  const elapsed = Date.now() - (counters.startedAt ?? Date.now());
  const avg = avgDuration(counters);
  const eta = remainingEtaByAverage(counters, cfg);
  const buckets = { judge: 0, gen: 0, other: 0 };
  let activeSize = 0;
  if (active && typeof active.entries === "function") {
    for (const [, item] of active.entries()) {
      activeSize += 1;
      buckets[phaseBucket(item.phase)] += 1;
    }
  } else {
    activeSize = Number(active) || 0;
  }
  // 运行列：总并发(判官/生成)，让 summary 一行也能看出此刻有几个子 agent 在审判、几个在生成。
  const runCol = `${String(activeSize).padStart(2)}(${buckets.judge}/${buckets.gen})`;
  return `[精修] ${String(snapshot.processed).padStart(3)}/${String(snapshot.total).padEnd(3)} ` +
    `${pct(snapshot.processed, snapshot.total).padStart(6)} ` +
    `${String(snapshot.good).padStart(5)} ${String(snapshot.written).padStart(3)} ${String(snapshot.merged).padStart(6)} ` +
    `${String(snapshot.kept).padStart(4)} ${String(snapshot.failed).padStart(4)} ${runCol.padStart(8)} ` +
    `${formatDuration(avg).padStart(6)} ${formatDuration(eta).padStart(6)} ${formatDuration(elapsed).padStart(7)} ${latest}`;
}

function formatJudgeProgress(doneBatches, totalBatches, doneTopics, totalTopics, cachedTopics, latestRefs, startedAt) {
  const latest = latestRefs.map((ref) => compactRef(ref, 30)).join(", ");
  const elapsed = Date.now() - startedAt;
  const eta = remainingEtaByThroughput(doneTopics, totalTopics, startedAt);
  return `[判官] ${String(doneBatches).padStart(3)}/${String(totalBatches).padEnd(3)} ` +
    `${String(doneTopics).padStart(3)}/${String(totalTopics).padEnd(3)} ` +
    `${pct(doneTopics, totalTopics).padStart(6)} ` +
    `${formatDuration(elapsed).padStart(7)} ${formatDuration(eta).padStart(7)} ` +
    `${String(cachedTopics).padStart(6)} ${latest}`;
}

// ====== LiveDashboard：summary 模式下原地刷新的顶部仪表盘 ======
// 思路：
//   - 在 process.stdout.write 上挂一层 hook：外部任何 write 都会先把当前面板擦掉，
//     让原始内容自然写出去（事件、日志、子进程 inherit stdout 全保留滚动），写完后再
//     把面板重画到 cursor 当前位置。
//   - dashboard 自身的重绘也走同一通道；render() 只更新内部 state，setInterval 触发 paint。
//   - 非 TTY 或 --progress != summary 时不启用；调用 enable() 是 no-op，update/event 一律
//     回退到普通 console.log，保留旧的滚屏行为兼容 CI / 重定向。
//   - 退出（stop / process exit / shutdownRequested）时要把 cursor 恢复、面板擦干净，避免
//     终端留 ANSI 残影。
class LiveDashboard {
  constructor() {
    this.enabled = false;
    this.state = {
      title: "精修进度",
      counters: null,
      cfg: null,
      poolActive: null,
      judge: null,
      lastEvents: [],
      runStartedAt: null, // 全程墙钟起点：面板顶栏显示"全程已用"
      stage: "", // 当前阶段：审计 / 判官预热 / 精修 / 收尾审计
      round: 0,
      maxRounds: 0,
    };
    this.painted = 0; // 上次面板占了多少行
    this.repaintTimer = null;
    this.originalWrite = null;
    this.originalErrWrite = null;
    this.painting = false; // 防止 paint 内部 write 触发递归
    this.dirty = false;
  }

  enable(stream = process.stdout) {
    if (this.enabled) return;
    if (!stream || !stream.isTTY) return; // 非 TTY 不启用
    this.enabled = true;
    this.stream = stream;
    this.originalWrite = stream.write.bind(stream);
    // hook：任何外部写入 stdout 都先擦面板，让事件文本自然滚动，写完后立刻重画。
    stream.write = (chunk, encoding, cb) => {
      if (this.painting) return this.originalWrite(chunk, encoding, cb);
      this.clearPainted();
      const ret = this.originalWrite(chunk, encoding, cb);
      this.paint();
      return ret;
    };
    // stderr 也劫持一下，防止 process.stderr.write 的输出被面板盖住或乱位。
    if (process.stderr && process.stderr.isTTY) {
      this.originalErrWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk, encoding, cb) => {
        if (this.painting) return this.originalErrWrite(chunk, encoding, cb);
        this.clearPainted();
        const ret = this.originalErrWrite(chunk, encoding, cb);
        this.paint();
        return ret;
      };
    }
    // 1s 强制重绘：即便 state 没变，也要刷新顶栏"全程已用"和判官面板的"已用/剩余"等时间字段；
    // 否则单批长耗（如配错首批超时）阶段，dirty 始终是 false，仪表盘看上去会"卡死"。
    this.repaintTimer = setInterval(() => {
      this.paint();
    }, 1000);
    this.repaintTimer.unref?.();
  }

  disable() {
    if (!this.enabled) return;
    this.clearPainted();
    if (this.originalWrite) this.stream.write = this.originalWrite;
    if (this.originalErrWrite) process.stderr.write = this.originalErrWrite;
    if (this.repaintTimer) clearInterval(this.repaintTimer);
    this.repaintTimer = null;
    this.originalWrite = null;
    this.originalErrWrite = null;
    this.enabled = false;
  }

  setStatic({ title, cfg, runStartedAt }) {
    if (title) this.state.title = title;
    if (cfg) this.state.cfg = cfg;
    if (runStartedAt) this.state.runStartedAt = runStartedAt;
    this.dirty = true;
  }

  // 标记当前所处阶段（审计 / 判官预热 / 精修 / 收尾审计）+ 轮次，顶栏统一展示，让用户随时看清"现在在干嘛、第几轮"。
  setStage(stage, { round, maxRounds } = {}) {
    if (stage !== undefined) this.state.stage = stage;
    if (round !== undefined) this.state.round = round;
    if (maxRounds !== undefined) this.state.maxRounds = maxRounds;
    this.dirty = true;
    if (this.enabled) this.paint();
  }

  updateRefine({ counters, active }) {
    this.state.counters = counters ? { ...counters } : null;
    if (active && typeof active.entries === "function") {
      this.state.poolActive = [...active.entries()].map(([ref, item]) => ({
        ref,
        phase: item.phase,
        phaseStartedAt: item.phaseStartedAt ?? item.startedAt,
        startedAt: item.startedAt,
        model: item.model,
        tokens: item.tokens,
        lastLine: item.lastLine,
        spec: item.spec,
        kind: item.kind,
        paused: item.paused,
      }));
    } else {
      this.state.poolActive = null;
    }
    this.dirty = true;
    if (this.enabled) this.paint();
  }

  updateJudge(state) {
    this.state.judge = state ? { ...state } : null;
    this.dirty = true;
    if (this.enabled) this.paint();
  }

  clearJudge() {
    this.state.judge = null;
    this.dirty = true;
    if (this.enabled) this.paint();
  }

  clearPainted() {
    if (!this.enabled || !this.painted) return;
    this.painting = true;
    try {
      // 把 cursor 上移到面板第一行，再清屏到结尾。
      this.originalWrite(`\x1b[${this.painted}F\x1b[0J`);
      this.painted = 0;
    } finally {
      this.painting = false;
    }
  }

  paint() {
    if (!this.enabled) return;
    this.dirty = false;
    const lines = this.renderLines();
    this.painting = true;
    try {
      this.clearPaintedInternal();
      // 在 cursor 当前位置打印面板，每行末尾清行末，最后留一行空白把 cursor 停在面板底部。
      const text = lines.map((line) => `${line}\x1b[0K`).join("\n") + "\n";
      this.originalWrite(text);
      this.painted = lines.length + 1; // +1 = 末尾的换行让 cursor 落在下一行起点
    } finally {
      this.painting = false;
    }
  }

  clearPaintedInternal() {
    if (!this.painted) return;
    this.originalWrite(`\x1b[${this.painted}F\x1b[0J`);
    this.painted = 0;
  }

  renderLines() {
    const lines = [];
    const width = Math.max(40, Math.min(this.stream?.columns ?? 100, 160));
    const sep = "─".repeat(width);
    const counters = this.state.counters;
    const cfg = this.state.cfg ?? {};
    const judge = this.state.judge;

    lines.push(`╭─ ${this.state.title} ${"─".repeat(Math.max(0, width - this.state.title.length - 4))}`);
    // 顶栏：当前阶段 + 轮次 + 全程已用，让"总进度/已执行多久"一眼可见（不随单轮重置）。
    const runElapsed = this.state.runStartedAt ? Date.now() - this.state.runStartedAt : 0;
    const roundLabel = this.state.maxRounds ? ` · 轮次 ${this.state.round}/${this.state.maxRounds}` : "";
    const stageLabel = this.state.stage ? this.state.stage : "运行中";
    lines.push(` 阶段  ${stageLabel}${roundLabel} · 全程已用 ${formatDuration(runElapsed)}`);
    if (counters) {
      const total = counters.total ?? 0;
      const done = counters.processed ?? 0;
      const ratio = total ? done / total : 0;
      const barWidth = Math.max(10, Math.min(40, width - 30));
      const filled = Math.round(barWidth * ratio);
      const bar = "█".repeat(filled) + "░".repeat(Math.max(0, barWidth - filled));
      lines.push(` 本轮  [${bar}] ${done}/${total}  ${pct(done, total)}`);
      lines.push(
        ` 状态  免改 ${counters.good ?? 0}  写回 ${counters.written ?? 0}  合并 ${counters.merged ?? 0}  保留 ${counters.kept ?? 0}  失败 ${counters.failed ?? 0}`,
      );
      const buckets = { judge: 0, gen: 0, other: 0 };
      const active = this.state.poolActive ?? [];
      for (const item of active) buckets[phaseBucket(item.phase)] += 1;
      const concurrency = cfg.concurrency ?? "?";
      lines.push(
        ` 并发  运行 ${active.length}/${concurrency} · 判官 ${buckets.judge}  生成 ${buckets.gen}  其他 ${buckets.other}`,
      );
      const elapsed = counters.startedAt ? Date.now() - counters.startedAt : 0;
      const avg = avgDuration(counters);
      const eta = remainingEtaByAverage(counters, cfg);
      lines.push(
        ` 速度  本轮均时 ${formatDuration(avg)}  本轮剩余 ${formatDuration(eta)}  本轮已用 ${formatDuration(elapsed)}`,
      );
    } else {
      lines.push(" 本轮  （等待开始）");
    }

    const active = this.state.poolActive ?? [];
    if (active.length) {
      lines.push(`├─ active workers (${active.length}) ${"─".repeat(Math.max(0, width - 24 - String(active.length).length))}`);
      const now = Date.now();
      // 全展示，按 phaseStartedAt 升序（最久的排前），让长尾子 agent 一眼看见。
      const sorted = [...active].sort((a, b) => (a.phaseStartedAt ?? 0) - (b.phaseStartedAt ?? 0));
      for (const item of sorted) {
        const dur = formatDuration(now - (item.phaseStartedAt ?? item.startedAt ?? now));
        const phase = phaseLabel(item.phase);
        const ref = compactRef(item.ref, Math.max(20, Math.floor(width * 0.35)));
        const spec = item.spec ? ` · ${shortSpec(item.spec)}` : "";
        const tok = item.tokens != null ? ` · tok ${formatTok(item.tokens)}` : "";
        let tail = "";
        if (item.paused) {
          tail = ` · ⏸ 暂停(${item.paused})`;
        } else if (item.lastLine) {
          const remain = Math.max(10, width - ref.length - phase.length - dur.length - spec.length - tok.length - 12);
          tail = ` · ${truncate(item.lastLine, remain)}`;
        }
        lines.push(` · ${ref}  ${phase}  ${dur}${spec}${tok}${tail}`);
      }
    }

    if (judge) {
      lines.push(`├─ 判官预热（判前评审，走缓存）${"─".repeat(Math.max(0, width - 28))}`);
      const elapsed = judge.startedAt ? Date.now() - judge.startedAt : 0;
      const eta = judge.doneTopics ? remainingEtaByThroughput(judge.doneTopics, judge.totalTopics, judge.startedAt) : (judge.etaMs ?? 0);
      lines.push(
        ` 批次 ${judge.doneBatches ?? 0}/${judge.totalBatches ?? 0}  篇 ${judge.doneTopics ?? 0}/${judge.totalTopics ?? 0}  ` +
          `缓存命中 ${judge.cachedTopics ?? 0}  剩余 ${formatDuration(eta)}  已用 ${formatDuration(elapsed)}`,
      );
      const activeBatches = Array.isArray(judge.activeBatches) ? judge.activeBatches : [];
      if (activeBatches.length) {
        // 每个在跑的判官子进程单独一行——之前 slice(0,2) 只显示头两个，导致"并发 3 却只看见俩"。
        // 现在全部列出（按启动顺序），最多 8（=maxConcurrency），超出再折叠。
        lines.push(` 运行中 ${activeBatches.length} 个判官子进程：`);
        const shown = [...activeBatches].sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0)).slice(0, 8);
        for (const entry of shown) {
          const refs = (entry.refs ?? []).map((ref) => compactRef(ref, Math.max(20, width - 24))).join(",");
          const age = formatDuration(Date.now() - (entry.startedAt ?? Date.now()));
          lines.push(` · #${(entry.idx ?? 0) + 1} ${age}  ${refs}`);
        }
        if (activeBatches.length > shown.length) lines.push(` · …其余 ${activeBatches.length - shown.length} 个`);
      }
    }

    lines.push(`╰${sep.slice(1)}`);
    return lines;
  }
}

const dashboard = new LiveDashboard();

function phaseLabel(phase) {
  return {
    starting: "启动",
    judgeBefore: "判前",
    refineCall: "生成",
    blockJudge: "块判",
    judgeAfter: "判后",
    merging: "写回",
  }[phase] ?? phase ?? "?";
}

// 子 agent 行展示用的 spec 缩写: "volcengine:glm-5.1" → "glm-5.1@vol"
function shortSpec(spec) {
  if (!spec) return "";
  const idx = spec.indexOf(":");
  if (idx < 0) return spec;
  const provider = spec.slice(0, idx);
  const model = spec.slice(idx + 1);
  const provShort = provider === "volcengine" ? "vol" : provider === "deepseek" ? "ds" : provider === "opencode" ? "oc" : provider === "longcat" ? "lc" : provider === "baidu" ? "bd" : provider === "mimo" ? "mi" : provider.slice(0, 3);
  return `${model}@${provShort}`;
}

function formatTok(n) {
  if (n == null) return "?";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function truncate(s, max) {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function phaseBucket(phase) {
  // 把细粒度 phase 归到 3 个桶：判官（judgeBefore/blockJudge/judgeAfter）、生成（refineCall）、其他（starting/merging）。
  // 用于心跳行的 "判官=A 生成=B" 概览。
  if (phase === "judgeBefore" || phase === "blockJudge" || phase === "judgeAfter") return "judge";
  if (phase === "refineCall") return "gen";
  return "other";
}

function startPoolHeartbeat(counters, active, heartbeatMs, cfg) {
  if (!heartbeatMs || heartbeatMs <= 0) return () => {};
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const now = Date.now();
    const entries = [...active.entries()];
    const buckets = { judge: 0, gen: 0, other: 0 };
    for (const [, item] of entries) buckets[phaseBucket(item.phase)] += 1;
    const activeItems = entries
      .slice(0, 3)
      .map(([ref, item]) => {
        const phaseAt = item.phaseStartedAt ?? item.startedAt;
        return `${compactRef(ref, 22)}·${phaseLabel(item.phase)} ${formatDuration(now - phaseAt)}`;
      });
    const suffix = activeItems.length ? ` activeNow=${activeItems.join(" | ")}` : "";
    console.log(
      `[精修] 心跳 ${counters.processed}/${counters.total} ${pct(counters.processed, counters.total)} ` +
        `免改=${counters.good ?? 0} 写回=${counters.written} 合并=${counters.merged ?? 0} 保留=${counters.kept ?? 0} 失败=${counters.failed} ` +
        `运行=${active.size}/${cfg.concurrency}（判官${buckets.judge} 生成${buckets.gen} 其他${buckets.other}） ` +
        `均时=${formatDuration(avgDuration(counters))} 剩余=${formatDuration(remainingEtaByAverage(counters, cfg))} 已用=${formatDuration(now - startedAt)}${suffix}`,
    );
  }, heartbeatMs);
  heartbeat.unref();
  return () => clearInterval(heartbeat);
}

async function refinePool(targets, audit, templates, cfg, cliPath, runDir, minScore, progressPath, modelState, counters, corpus, judge) {
  const results = [];
  let index = 0;
  const active = new Map();
  counters.startedAt ??= Date.now();
  counters.topicMs ??= 0;
  counters.timed ??= 0;
  // dashboard 启用时由它的 setInterval 自己 1s 重绘一次，无需再单独 console.log 心跳行；
  // 未启用时（progressStyle != summary 或非 TTY）回退到旧的 console.log 心跳。
  const useDashboard = dashboard.enabled;
  if (useDashboard) dashboard.updateRefine({ counters, active });
  const stopHeartbeat = !useDashboard && cfg.progressStyle === "summary"
    ? startPoolHeartbeat(counters, active, cfg.heartbeatMs, cfg)
    : () => {};
  async function worker() {
    while (index < targets.length) {
      if (shutdownRequested) throw makeInterruptedError();
      const ref = targets[index++];
      const model = currentModel(modelState);
      const itemStartedAt = Date.now();
      // phase = 子 agent 当前所在阶段：starting / judgeBefore / refineCall / blockJudge / judgeAfter / merging
      // setPhase 由 refineOneTopic 在每个阶段切换时回调，让 summary 心跳能区分"审判 vs 生成"。
      active.set(ref, { model: model ?? "默认", startedAt: itemStartedAt, phase: "starting", phaseStartedAt: itemStartedAt });
      if (useDashboard) dashboard.updateRefine({ counters, active });
      const setPhase = (next, detail) => {
        const entry = active.get(ref);
        if (!entry) return;
        if (typeof next === "string") {
          entry.phase = next;
          entry.phaseStartedAt = Date.now();
        }
        if (detail && typeof detail === "object") {
          if (detail.tokens != null) entry.tokens = detail.tokens;
          if (detail.lastLine != null) entry.lastLine = detail.lastLine;
          if (detail.spec != null) entry.spec = detail.spec;
          if (detail.kind != null) entry.kind = detail.kind;
          if (detail.paused != null) entry.paused = detail.paused;
        }
        if (useDashboard) dashboard.updateRefine({ counters, active });
      };
      // 订阅本 topic 的 LLM token 事件,把进度反映到 active 行(覆盖判官/块级也能实时显示)
      const onTokenEvt = (evt) => {
        if (evt.topicRef !== ref) return;
        const entry = active.get(ref);
        if (!entry) return;
        entry.tokens = evt.tokens;
        if (evt.lastLine) entry.lastLine = evt.lastLine;
        if (evt.spec) entry.spec = evt.spec;
        if (evt.kind) entry.kind = evt.kind;
        if (useDashboard) dashboard.updateRefine({ counters, active });
      };
      liveEvents.on("llm.token", onTokenEvt);
      // pause 时给本 worker 标记,resume 时清掉
      const onPause = (evt) => {
        const entry = active.get(ref);
        if (!entry) return;
        entry.paused = `额度耗尽 ${evt.spec || ""}`;
        if (useDashboard) dashboard.updateRefine({ counters, active });
      };
      const onResume = () => {
        const entry = active.get(ref);
        if (!entry) return;
        entry.paused = null;
        if (useDashboard) dashboard.updateRefine({ counters, active });
      };
      liveEvents.on("llm.pause", onPause);
      liveEvents.on("llm.resume", onResume);
      let result;
      try {
        result = await refineOneTopic(ref, audit, templates, cfg, cliPath, runDir, minScore, model, undefined, corpus, judge, setPhase);
      } catch (error) {
        // 兜底：中断信号照常上抛（让 shutdown 生效）；其余任何意外错误（如 refineOneTopic 顶部读文件/打分抛错）
        // 都转成"该篇失败"，绝不让单篇的意外把整轮 run 崩掉——这是"跑完不用管"的最后一道防线。
        if (error?.interrupted || shutdownRequested) throw error;
        console.log(`[FAIL] ${compactRef(ref, 50)} 意外错误（已隔离为单篇失败）：${error.message}`);
        result = { ok: false, attempts: 0, error: `未捕获异常：${error.message}`, availabilityFailure: false, keptOld: false, action: "failed" };
      } finally {
        liveEvents.off("llm.token", onTokenEvt);
        liveEvents.off("llm.pause", onPause);
        liveEvents.off("llm.resume", onResume);
        active.delete(ref);
        if (useDashboard) dashboard.updateRefine({ counters, active });
      }
      counters.topicMs += Date.now() - itemStartedAt;
      counters.timed += 1;
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
      if (useDashboard) {
        // 面板自身已涵盖完整快照，这里只把每篇的"判定结果 + ref"作为事件行滚到面板下方，
        // 让用户能从滚动区追溯历史；面板会被 stdout hook 在写入后自动重绘。
        console.log(`[${label.trim()}] ${compactRef(ref, 50)}${result.error ? ` (${result.error})` : ""}`);
        dashboard.updateRefine({ counters, active });
      } else if (cfg.progressStyle === "summary") {
        maybePrintProgressHeader("REFINE", snapshot.processed);
        console.log(formatRefineProgress(snapshot, active, label.trim().toLowerCase(), ref, cfg, counters));
      } else if (cfg.progressStyle === "topic") {
        console.log(
          `[${snapshot.processed}/${snapshot.total} ★${snapshot.good} ✓${snapshot.written} ⇄${snapshot.merged} ◦${snapshot.kept} ✗${snapshot.failed} | ${domain} | m=${model ?? "默认"}] ` +
            `c=${cfg.concurrency} ${label} ${ref}${result.error ? ` (${result.error})` : ""}`,
        );
      }
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
  const threshold = Math.max(2, modelState.degradeAfter); // 至少 2 次才算"频繁"
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

// 把一条失败 error 文本归类，供汇总按原因统计（让用户一眼看出"坏在程序还是内容/上游"）。
function classifyFailure(error) {
  const text = String(error ?? "");
  if (/判官评审失败|判官.*不可用|动态评审/.test(text)) return "判官评审失败";
  if (/超时|timeout after|timed out/i.test(text)) return "超时";
  if (/限流|服务不可用|上游错误|rate.?limit|too many requests|\b429\b|\b50[023]\b|quota|throttl|overloaded|可用性|unavailable/i.test(text)) return "限流/服务不可用";
  if (/未把 JSON 写入缓存|未按文件协议|缺少 \/\/---END---|写入未完成/.test(text)) return "子agent未写入缓存";
  if (/不是当前 topic 契约|错误响应 JSON 而非 topic 契约/.test(text)) return "输出非topic契约";
  if (/没有 JSON 对象|JSON.*(?:非法|解析)|Unexpected (?:token|end)|parse/i.test(text)) return "JSON解析失败";
  if (/schema 不变量失败|不变量失败/.test(text)) return "schema不变量";
  if (/exit code|signal/i.test(text)) return "进程非零退出";
  return "其他";
}

// 汇总重试/恢复：basesByRef 累计每 ref 跨轮/跨 attempt 的处理情况，配合最终状态判断"重试后是否成功"。
function summarizeRetries(retryStats, state) {
  const triggered = [];
  for (const [ref, info] of retryStats.entries()) {
    if (info.maxAttempts > 1 || info.rounds > 1) triggered.push(ref);
  }
  let recovered = 0;
  let stillFailed = 0;
  let retained = 0;
  for (const ref of triggered) {
    const s = state.get(ref);
    if (s?.lastOk) recovered += 1;
    else if (s?.lastKeptOld) retained += 1;
    else stillFailed += 1;
  }
  return { triggered: triggered.length, recovered, stillFailed, retained, triggeredRefs: triggered };
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

// judge-cache/outputs/ 只存判官失败的现场样本（诊断用），从不参与命中判断，会无限增长。
// 启动时按 mtime 仅保留最近 keep 个，其余删掉，避免缓存目录越攒越大。
async function gcJudgeOutputs(outputsDir, keep) {
  let entries;
  try {
    entries = await readdir(outputsDir, { withFileTypes: true });
  } catch {
    return; // 目录不存在直接跳过
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(outputsDir, entry.name);
    const st = await stat(file).catch(() => null);
    if (st) files.push({ file, mtimeMs: st.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of files.slice(keep)) {
    await rm(file, { force: true }).catch(() => {});
  }
}

async function findLatestRunDir(qualityDir) {
  let entries;
  try {
    entries = await readdir(qualityDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T/.test(entry.name)) continue;
    const dir = path.join(qualityDir, entry.name);
    const st = await stat(dir).catch(() => null);
    if (st) candidates.push({ dir, mtimeMs: st.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.dir ?? null;
}

function resolveResumeRunDir(value, qualityDir) {
  if (!value) return null;
  const raw = value === true ? "latest" : String(value).trim();
  if (!raw || raw === "latest") return null;
  const direct = path.isAbsolute(raw) ? raw : path.resolve(root, raw);
  if (direct.startsWith(qualityDir)) return direct;
  return path.join(qualityDir, raw);
}

function readCompletedRefsFromProgress(progressPath) {
  let text;
  try {
    text = readFileSync(progressPath, "utf8");
  } catch {
    return new Map();
  }
  const completed = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item?.ref && ["good", "written", "merged", "kept"].includes(item.status)) completed.set(item.ref, item);
    } catch {
      // 忽略中断时可能写坏的最后一行。
    }
  }
  return completed;
}

async function writeRunState(runDir, patch) {
  const file = path.join(runDir, "run-state.json");
  let prior = {};
  try {
    prior = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  const next = { ...prior, ...patch, updatedAt: new Date().toISOString() };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`).catch(() => {});
}

async function main() {
  const runStartedAt = Date.now(); // 全程墙钟起点：汇总里报"本次执行多久"
  const args = parseArgs();
  // qwen 显式模型路由已弃用：API 模式由 env-config 的 baseUrl/apiKey 直管,无需 --qwen-routes。
  if (args["qwen-routes"]) {
    console.warn("[deprecated] --qwen-routes 在 API 模式下已无意义,忽略。");
  }
  const scope = String(args.scope ?? "all").trim();
  const minScore = Number(args["min-score"] ?? PRODUCTION_STRICT_MIN_SCORE);
  const concurrency = Number(args.concurrency ?? 2);
  const autoConcurrencyMin = Number(args["auto-concurrency-min"] ?? (concurrency > 3 ? 3 : concurrency));
  const maxRounds = Number(args["max-rounds"] ?? 3);
  const retries = Number(args.retries ?? 2); // 默认 2：给"格式失败带反馈重写"留足自愈空间（keptOld 已 break、不吃重试预算）
  const timeoutMs = Number(args["timeout-ms"] ?? 600000);
  const limit = args.limit ? Number(args.limit) : Infinity;
  const dryRun = Boolean(args["dry-run"]);
  const auditOnly = Boolean(args["audit-only"]);
  const previewMode = Boolean(args.preview);
  const topicFilters = parseTopicList(args);
  const degradeAfter = Number(args["degrade-after"] ?? 3);
  // 滑动窗口长度：仅当窗口内可用性失败次数 ≥ degradeAfter 才视为"频繁"，触发并发降级 / 模型降级。
  const degradeWindowSeconds = Number(args["degrade-window-seconds"] ?? 60);
  const progressStyle = String(
    args["progress-style"] ?? process.env.QUALITY_REFINE_PROGRESS_STYLE ?? (previewMode ? "topic" : "summary"),
  ).trim();
  const defaultHeartbeatSeconds = progressStyle === "summary" ? 60 : 20;
  const heartbeatSeconds = Number(args["heartbeat-seconds"] ?? process.env.QUALITY_REFINE_HEARTBEAT_SECONDS ?? defaultHeartbeatSeconds);
  const stallTimeoutMs = Number(args["stall-timeout-ms"] ?? process.env.QUALITY_REFINE_STALL_TIMEOUT_MS ?? 150000);
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
  if (!Number.isInteger(stallTimeoutMs) || stallTimeoutMs < 0) throw new Error("--stall-timeout-ms 必须是 >=0 的整数（0=关闭）");
  if (!["quiet", "summary", "topic"].includes(progressStyle)) {
    throw new Error("--progress-style 必须是 quiet | summary | topic");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 30000) throw new Error("--timeout-ms 必须是 >=30000 的整数");
  if (!Number.isInteger(minScore) || minScore < 1 || minScore > 100) throw new Error("--min-score 必须在 [1,100]");
  const progressCfg = { progressStyle, heartbeatMs: heartbeatSeconds * 1000, timeoutMs, stallTimeoutMs };

  // 审计预览：不调用任何 LLM，只看当前还差哪些篇、各篇缺口。
  if (auditOnly) {
    const audit = await runAudit(minScore, progressCfg);
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

  // API 模式不依赖本地 CLI；--cli 仅作为日志标签保留（缺省 "api"），兼容旧脚本/last-config。
  // QUALITY_LLM_CLI 仍可通过环境变量传入,但不再有路由意义,只影响日志显示。
  const cli = args.cli ?? process.env.QUALITY_LLM_CLI ?? "api";
  // 一组在 CLI 模式下生效、API 模式下已无意义的旗标:接受但打一次 deprecation 提示,避免静默吞参误导用户。
  for (const deprecated of ["qwen-routes", "use-pty", "no-default-extra-args", "model-arg", "prompt-arg", "prompt-mode", "judge-cli"]) {
    if (args[deprecated] !== undefined) {
      console.warn(`[deprecated] --${deprecated} 在 API 模式下已无意义,忽略(精修器现直接调 OpenAI 兼容 API,不再 spawn CLI)。`);
    }
  }
  const cfg = {
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
    stallTimeoutMs,
    progressStyle,
    autoConcurrencyMin,
  };
  // API 模式无 CLI 路径,cliPath 仅作展示标签。
  const cliPath = `__api_mode__/${cfg.cli}`;

  const qualityDir = qualityRoot;
  const resumeRequested = Boolean(args.resume || args["resume-run"]);
  let resumeRunDir = resolveResumeRunDir(args["resume-run"] ?? args.resume, qualityDir);
  if (resumeRequested && !resumeRunDir) resumeRunDir = await findLatestRunDir(qualityDir);
  if (!resumeRequested) await gcOldRuns(qualityDir, 3);
  await gcJudgeOutputs(path.join(qualityDir, "judge-cache", "outputs"), 50);
  const runId = resumeRunDir
    ? path.basename(resumeRunDir)
    : `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha256(scope).slice(0, 6)}`;
  const runDir = resumeRunDir ?? path.join(qualityDir, runId);
  activeRunDir = runDir;
  await mkdir(runDir, { recursive: true });
  const progressPath = path.join(runDir, "progress.jsonl");
  const completedFromProgress = resumeRequested ? readCompletedRefsFromProgress(progressPath) : new Map();
  if (resumeRequested) {
    console.log(`[RESUME] runDir=${path.relative(root, runDir)} 已有完成记录 ${completedFromProgress.size} 条`);
  }
  const modelState = makeModelState(modelChain, degradeAfter, degradeWindowSeconds * 1000);

  // ===== 动态判官配置（默认开；模型默认跟精修主模型一致；支持多模型 × 每模型多实例）=====
  const judgeDisabled = Boolean(args["no-judge"]);
  const judgeCli = args["judge-cli"] ?? cli;
  const judgeModels = args["judge-models"]
    ? String(args["judge-models"]).split(",").map((entry) => entry.trim()).filter(Boolean)
    : [modelChain[0]]; // 默认 = 精修主模型（modelChain[0]，可能是 undefined=CLI 默认）
  const judgeCount = Number(args["judge-count"] ?? 1);
  const dynamicSkipMin = Number(args["dynamic-skip-min"] ?? args["dynamic-pass-min"] ?? args["dynamic-min"] ?? PRODUCTION_STRICT_MIN_SCORE);
  const judgeBatchSize = Number(args["judge-batch-size"] ?? 1);
  const judgeJsonRetries = Number(args["judge-json-retries"] ?? 2);
  const judgeWarmConcurrency = Number(args["judge-warm-concurrency"] ?? concurrency);
  ensureInt(judgeCount, "judge-count", 1, 8);
  ensureInt(judgeBatchSize, "judge-batch-size", 1, 10);
  ensureInt(judgeJsonRetries, "judge-json-retries", 0, 5);
  ensureInt(judgeWarmConcurrency, "judge-warm-concurrency", 1, maxConcurrency);
  if (!Number.isInteger(dynamicSkipMin) || dynamicSkipMin < 1 || dynamicSkipMin > 100) {
    throw new Error("--dynamic-skip-min 必须在 [1,100]（--dynamic-min 仍可作为兼容别名）");
  }
  let judge = null;
  if (!judgeDisabled) {
    // API 模式无判官 CLI 路径,judgeCliPath 仅作展示标签。
    const judgeCliPath = `__api_mode__/${judgeCli}`;
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
      warmConcurrency: judgeWarmConcurrency,
      cacheDir: path.join(qualityDir, "judge-cache"),
      setHash,
    };
    console.log(
      `判官：cli=${judgeCli} 模型=[${judgeModels.map((entry) => entry ?? "CLI默认").join(", ")}] × ${judgeCount} 实例，` +
        `动态免改线 ${dynamicSkipMin}，batch=${judgeBatchSize}，判前预热并发=${judgeWarmConcurrency}，json重试=${judgeJsonRetries}（contentHash 缓存复用）`,
    );
  } else {
    console.log("判官：已关闭（--no-judge），仅静态 keep-best。");
  }

  // 测试/预览模式：精修单篇，结果写到 .quality-refine/preview/（不动仓库），打印路径供 sh 渲染。
  if (previewMode) {
    const audit = await runAudit(minScore, cfg);
    const templates = templatesByRef(audit);
    const candidates = resolveTargetRefs(audit, scope, options, topicFilters);
    let ref = candidates[0];
    if (!ref) {
      throw new Error(`scope=${scope} 内没有可预览 topic。`);
    }
    const outPath = path.join(qualityRoot, "preview", `${ref.replace(/[^a-z0-9]+/gi, "-")}.json`);
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
  const initialAudit = await runAudit(minScore, cfg);
  const targetRefs = resolveTargetRefs(initialAudit, scope, options, topicFilters);
  if (!targetRefs.length) throw new Error(`scope=${scope} 内没有可精修 topic。`);
  const targetSet = new Set(targetRefs);
  const initialFailing = new Set(initialAudit.failingTopics.map((topic) => topic.ref).filter((ref) => targetSet.has(ref)));
  console.log(
    `起始：目标 ${targetRefs.length} 篇（第一轮都会进入处理队列，判官达标会免改），其中静态 <${minScore} ${initialFailing.size} 篇  ` +
      `[${summarizeFailingByDomain([...initialFailing]) || "无"}]`,
  );

  // dashboard 仅在 summary 模式 + TTY 输出时启用；非 TTY / 重定向到日志文件 / topic|quiet 模式自动降级为原滚屏。
  if (cfg.progressStyle === "summary") {
    const modelsLabel = modelChain.map((entry) => entry ?? "CLI默认").join(" → ");
    const judgeLabel = judge ? `${judge.models.map((entry) => entry ?? "CLI默认").join(",")}×${judgeCount}` : "off";
    dashboard.setStatic({
      title: `quality_refine  scope=${scope}  cli=${cfg.cli}  精修=${modelsLabel}  判官=${judgeLabel}`,
      cfg: { concurrency: cfg.concurrency, judge: judgeLabel, minScore },
      runStartedAt,
    });
    dashboard.enable(process.stdout);
  }

  // 跨轮状态：bestScore 用于检测"连续无提升 -> 放弃，避免死循环"。
  const state = new Map(targetRefs.map((ref) => [ref, {
    attempts: 0,
    bestScore: initialAudit.scoreMap.get(ref) ?? 0,
    noImprove: 0,
    lastOk: null,
    lastError: null,
  }]));
  for (const [ref, item] of completedFromProgress.entries()) {
    const s = state.get(ref);
    if (!s) continue;
    const ok = ["good", "written", "merged"].includes(item.status);
    s.attempts = Math.max(1, Number(item.attempts ?? 1));
    s.lastOk = ok;
    s.lastKeptOld = item.status === "kept";
    s.lastAlreadyGood = item.status === "good";
    s.lastError = item.error ?? null;
    s.lastResult = {
      ok,
      keptOld: item.status === "kept",
      alreadyGood: item.status === "good",
      merged: item.status === "merged",
      action: item.action,
      attempts: item.attempts,
      decisionReason: item.decisionReason,
      staticBefore: item.staticBefore,
      staticAfter: item.staticAfter,
      dynamicBefore: item.dynamicBefore,
      dynamicAfter: item.dynamicAfter,
      changedBlocks: item.changedBlocks,
      mergedBlocks: (item.mergedBlocks ?? []).map((label) => ({ label })),
      error: item.error,
    };
  }
  if (completedFromProgress.size) {
    const inScopeDone = targetRefs.filter((ref) => completedFromProgress.has(ref)).length;
    console.log(`[RESUME] scope 内跳过已完成 ${inScopeDone}/${targetRefs.length} 篇，未完成项会继续进入后续轮次。`);
  }
  const stuck = new Set();
  // 跨轮重试累计：每 ref 处理了几轮（rounds）+ 单轮内最多 attempt 次数（maxAttempts），用于汇总"重试后是否成功"。
  const retryStats = new Map();
  if (!dryRun) {
    await writeRunState(runDir, {
      runId,
      status: resumeRequested ? "resumed" : "running",
      scope,
      minScore,
      targetRefs,
      completedFromProgress: completedFromProgress.size,
      startedAt: new Date(runStartedAt).toISOString(),
    });
  }

  for (let round = 1; round <= maxRounds; round += 1) {
    if (shutdownRequested) throw makeInterruptedError();
    await writeRunState(runDir, { status: "running", round, stage: "audit" });
    dashboard.setStage("① 全量审计", { round, maxRounds });
    const audit = await runAudit(minScore, cfg);
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

    await writeRunState(runDir, { status: "running", round, stage: "judge-warm", roundTargets: ordered });
    dashboard.setStage("② 判官预热", { round, maxRounds });
    await warmJudgeCacheForTargets(ordered, judge, cfg);

    await writeRunState(runDir, { status: "running", round, stage: "refine", roundTargets: ordered });
    dashboard.setStage("③ 精修", { round, maxRounds });
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
      const rs = retryStats.get(result.ref) ?? { rounds: 0, maxAttempts: 0 };
      rs.rounds += 1;
      rs.maxAttempts = Math.max(rs.maxAttempts, result.attempts ?? 1);
      retryStats.set(result.ref, rs);
    }
    console.log(
      `[round ${round}] 完成：已达标(免改) ${counters.good}，整篇写回 ${counters.written}，块级合并 ${counters.merged}，保留旧版(未改善) ${counters.kept}，失败 ${counters.failed}`,
    );
  }

  // 最终审计 + 汇总
  dashboard.setStage("④ 收尾审计", { round: maxRounds, maxRounds });
  const finalAudit = await runAudit(minScore, cfg);
  const processed = targetRefs.filter((ref) => state.get(ref).attempts > 0);
  const unprocessed = targetRefs.filter((ref) => state.get(ref).attempts === 0);
  // 执行失败 = 真出错（CLI/解析/契约/不变量），不含 keptOld（候选合法但未优于现版、保留旧版）。
  const failedExecutions = targetRefs.filter((ref) => {
    const s = state.get(ref);
    return s.attempts > 0 && s.lastOk === false && !s.lastKeptOld;
  });
  // keptOld：试过但没产出更优候选、保留了旧版。仍 <minScore 的会同时出现在 stillFailing（真问题）；
  // 已 ≥minScore 的只是"当前判定下已最优、暂时推不高"，不算失败、不阻断同步。
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
  // 失败原因分类统计（按 classifyFailure 归桶），让汇总能说清"几条限流、几条坏 JSON、几条未写入缓存"。
  const failureBreakdown = {};
  for (const ref of failedExecutions) {
    const cat = classifyFailure(state.get(ref).lastError);
    failureBreakdown[cat] = (failureBreakdown[cat] ?? 0) + 1;
  }
  const retrySummary = summarizeRetries(retryStats, state);
  const durationMs = Date.now() - runStartedAt;
  const summary = {
    runId,
    scope,
    selectedTargets: targetRefs.length,
    minScore,
    durationMs,
    durationLabel: formatDuration(durationMs),
    retry: { triggered: retrySummary.triggered, recovered: retrySummary.recovered, stillFailed: retrySummary.stillFailed, retained: retrySummary.retained },
    failureBreakdown,
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
  await writeRunState(runDir, { status: "completed", stage: "done", summary: "summary.json" });

  // 精修结束：关掉 dashboard，让最终汇总用普通滚屏输出。
  dashboard.disable();

  console.log(`\n==== 精修完成 ====`);
  console.log(`本次耗时：${formatDuration(durationMs)}    最终模型：${currentModel(modelState) ?? "CLI默认"}    全量 overall：${initialAudit.overallScore} -> ${finalAudit.overallScore}`);
  console.log(`处理：${processed.length}/${targetRefs.length}    已达标(免改)：${goodRefs.length}    整篇写回：${writtenRefs.length}    块级合并：${mergedRefs.length}    保留旧版(未改善)：${keptOldRefs.length}    执行失败：${failedExecutions.length}    修好原静态未达标：${fixed.length}/${initialFailing.size}    仍 <${minScore}：${stillFailing.length}    放弃(stuck)：${stuck.size}`);
  if (retrySummary.triggered) {
    console.log(`重试：${retrySummary.triggered} 篇触发重试（多次 attempt 或跨轮再处理）→ 重试后达标 ${retrySummary.recovered}，保留旧版 ${retrySummary.retained}，仍失败 ${retrySummary.stillFailed}`);
  } else {
    console.log(`重试：本次无 topic 触发重试。`);
  }
  if (unprocessed.length) console.log(`未处理：${unprocessed.length} 篇（通常是 limit/max-rounds 不足）`);
  console.log(`产物：${path.relative(root, runDir)}（progress.jsonl / summary.json / 每篇 raw 输出）`);
  if (failedExecutions.length) {
    const breakdownLabel = Object.entries(failureBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => `${cat}×${n}`)
      .join("  ");
    console.log(`执行失败原因分类：${breakdownLabel}`);
  }
  if (stillFailing.length) {
    console.log(`仍未达标（按分数升序，前 20）：`);
    for (const item of summary.stillFailingDetail.slice(0, 20)) console.log(`- ${item.score}/100  ${item.ref}`);
  }
  if (failedExecutions.length) {
    console.log(`执行失败明细（前 20）：`);
    for (const ref of failedExecutions.slice(0, 20)) console.log(`- [${classifyFailure(state.get(ref).lastError)}] ${ref}: ${state.get(ref).lastError}`);
  }
  // 退出码只反映"是否还有目标 <minScore 或没跑完"。keptOld / 已达标篇上的执行失败不阻断同步，
  // 因为磁盘上留的是合格的旧版内容（"越跑越高、不许改烂"：失败时绝不退步）。
  if (stillFailing.length || unprocessed.length) {
    process.exitCode = 1;
  }
}

installSignalHandlers();
installPauseKeyboard();

// 把 .env 里 QUOTA_PAUSE_DEFAULT 套到 pauseBus(交互向导也可以临时改)
{
  const policy = envConfig.getEnv("QUOTA_PAUSE_DEFAULT", "manual");
  try { pauseBus.setPolicy(policy); } catch (e) { console.warn(`[pause-bus] 忽略未知策略: ${policy}`); }
}

import { fileURLToPath } from "node:url";
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (__isMain) {
  main()
    .catch(async (error) => {
      if (error?.interrupted) {
        if (activeRunDir) {
          await writeRunState(activeRunDir, { status: "interrupted", stage: "stopped", resumeCommand: `node scripts/quality_refine.mjs --resume-run ${path.relative(root, activeRunDir)}` });
        }
        console.error(`[INTERRUPT] 精修已中断。可用 --resume 或 --resume-run ${activeRunDir ? path.relative(root, activeRunDir) : "<runDir>"} 续跑。`);
        process.exitCode = 130;
        return;
      }
      if (activeRunDir) await writeRunState(activeRunDir, { status: "failed", stage: "error", error: error.message });
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      try {
        dashboard.disable();
      } catch {}
    });
}

export { refineOneTopic, runAudit, callRefineApi };
