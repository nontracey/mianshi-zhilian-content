import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const minScoreArg = process.argv.find((arg) => arg.startsWith("--min-score="));
const minScore = minScoreArg ? Number(minScoreArg.split("=")[1]) : 90;
const formatJson = process.argv.includes("--json");
const showDistribution = process.argv.includes("--distribution");

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

function compact(text = "") {
  return String(text).replace(/\s+/g, "");
}

function textLength(text = "") {
  return compact(text).length;
}

function cardText(card) {
  let text = card.content ?? "";
  if (Array.isArray(card.items)) text += card.items.join("");
  if (Array.isArray(card.columns)) text += card.columns.join("");
  if (Array.isArray(card.rows)) text += card.rows.flat().join("");
  if (card.fallback) text += card.fallback;
  if (card.caption) text += card.caption;
  if (Array.isArray(card.followUpQuestions)) {
    text += card.followUpQuestions
      .map((item) => `${item.question ?? ""}${item.answer ?? ""}`)
      .join("");
  }
  return text;
}

function cardCounts(topic) {
  const counts = new Map();
  for (const card of topic.learningCards ?? []) {
    counts.set(card.type, (counts.get(card.type) ?? 0) + 1);
  }
  return counts;
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[\s、，,。:：/()（）\-_.+]/g, "")
    .replace(/与/g, "和");
}

function hasCodeExample(topic) {
  return (topic.learningCards ?? []).some((card) => {
    if (card.type === "code") return true;
    return /```[a-zA-Z0-9-]*\n[\s\S]*?```/.test(card.content ?? "");
  });
}

function containsMarkdownList(text = "") {
  return /(^|\n)\s*(?:[-*]|\d+\.)\s+\S/.test(text);
}

function normalizedText(text = "") {
  return compact(text)
    .replace(/[，。；：、,.!！?？()[\]（）【】#*_`|>~\-]/g, "")
    .toLowerCase();
}

function jaccardSimilarity(left = "", right = "") {
  const a = new Set(normalizedText(left).match(/[\p{Script=Han}A-Za-z0-9]{2,}/gu) ?? []);
  const b = new Set(normalizedText(right).match(/[\p{Script=Han}A-Za-z0-9]{2,}/gu) ?? []);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function collectTopicText(topic) {
  return JSON.stringify(topic);
}

function collectReadableTopicText(topic) {
  const cards = (topic.learningCards ?? []).map((card) => `${card.title ?? ""}\n${cardText(card)}`);
  const recalls = (topic.recallPrompts ?? []).map((prompt) => prompt.prompt ?? "");
  const rubric = topic.rubric ?? {};
  const rubricItems = ["mustHave", "goodToHave", "commonMistakes"].flatMap((key) => rubric[key] ?? []);
  return [
    topic.title,
    topic.summary,
    topic.interviewerFocus,
    ...(topic.tags ?? []),
    ...cards,
    ...recalls,
    ...rubricItems,
  ]
    .filter(Boolean)
    .join("\n");
}

function isAlgorithmProblemIntroCard(topic, card) {
  if (topic.domain !== "algorithm" || card.type !== "explain") return false;
  return /^(题目描述|示例|约束条件)$/.test((card.title ?? "").trim());
}

function mermaidUnfence(content = "") {
  let source = String(content).replace(/\\n/g, "\n").trim();
  if (source.startsWith("```")) {
    const lines = source.split("\n");
    lines.shift();
    if (lines[lines.length - 1]?.trim() === "```") lines.pop();
    source = lines.join("\n").trim();
  }
  return source;
}

// 把跨行的节点标签（[...]、{...}、(...)、"..." 内的换行）合并回单条语句，
// 否则多行标签会被按 \n 切碎、误判为孤立节点或非连线语句。
function mermaidStatements(content = "") {
  const source = mermaidUnfence(content);
  const merged = [];
  let buffer = "";
  let square = 0;
  let curly = 0;
  let paren = 0;
  let inQuote = false;
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    buffer = buffer ? `${buffer} ${line}` : line;
    for (const ch of rawLine) {
      if (ch === '"') inQuote = !inQuote;
      else if (inQuote) continue;
      else if (ch === "[") square += 1;
      else if (ch === "]") square = Math.max(0, square - 1);
      else if (ch === "{") curly += 1;
      else if (ch === "}") curly = Math.max(0, curly - 1);
      else if (ch === "(") paren += 1;
      else if (ch === ")") paren = Math.max(0, paren - 1);
    }
    if (!inQuote && square === 0 && curly === 0 && paren === 0) {
      merged.push(buffer);
      buffer = "";
    }
  }
  if (buffer) merged.push(buffer);
  return merged
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"))
    .flatMap((line) => line.split(";"))
    .map((line) => line.trim())
    .filter(Boolean);
}

const mermaidTypePattern =
  /^(flowchart|graph|sequenceDiagram|stateDiagram-v2|stateDiagram|classDiagram|erDiagram|journey|gantt|pie|timeline|mindmap|gitGraph|quadrantChart|requirementDiagram|C4Context)/;

function mermaidDiagramType(content = "") {
  const header = mermaidStatements(content)[0] ?? "";
  const match = header.match(mermaidTypePattern);
  return match ? match[1] : "";
}

// 结构/声明行：subgraph/end、participant/note/loop 等，既不是连线也不应判为孤立节点。
const mermaidStructuralLinePattern =
  /^(subgraph|end|direction|classDef|class|style|linkStyle|click|title|accTitle|accDescr|participant|actor|note|activate|deactivate|loop|alt|opt|par|and|else|rect|autonumber|box|critical|break|state|link|requirement|element)\b/i;
// flowchart / stateDiagram 连线标记（已剥离括号标签后检测）。
// codeql[js/bad-html-filtering-regexp] Mermaid arrow syntax, not HTML filtering
const flowchartEdgeMarkPattern = /-->|---|<-->|==>|===|-\.->|-\.-|\.->|--[xo]|[xo]--|->|=>/;
// 时序图消息：Actor 箭头 Actor : 文本。
// codeql[js/bad-html-filtering-regexp] Mermaid arrow syntax, not HTML filtering
const sequenceMessagePattern = /^[\s+-]*[\w"][^:]*?(-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?[\w"]/;
// 按操作符切分以提取两端节点 id（长操作符在前，避免被 -- 截断）。
// codeql[js/bad-html-filtering-regexp] Mermaid arrow syntax, not HTML filtering
const mermaidArrowSplitPattern =
  /\s*(?:-->>|-->|->>|->|-\.->|-\.-|<-->|===|==>|---|--x|-x|--o|o--|--\)|-\)|--|==)\s*/;

function stripMermaidLabels(statement) {
  let previous;
  let current = statement;
  do {
    previous = current;
    current = current.replace(/\[[^\[\]]*\]|\{[^{}]*\}|\([^()]*\)/g, "");
  } while (current !== previous);
  return current.replace(/\|[^|]*\|/g, " ").replace(/:[\s\S]*$/, " ");
}

function mermaidEdgeNodeIds(statement) {
  return stripMermaidLabels(statement)
    .split(mermaidArrowSplitPattern)
    .map((token) => (token.trim().match(/^([A-Za-z][\w]*)/) || [])[1])
    .filter(Boolean);
}

// 单一真源：解析一张 Mermaid 图，按类型给出节点数、连线数、孤立节点、标签和重复连线。
function analyzeMermaid(content = "") {
  const statements = mermaidStatements(content);
  const header = statements[0] ?? "";
  const type = mermaidDiagramType(content);
  const isSequence = type === "sequenceDiagram";
  const isNodeGraph =
    type === "flowchart" || type === "graph" || type === "stateDiagram" || type === "stateDiagram-v2";
  const nodes = new Map();
  const referenced = new Set();
  const labels = [];
  const edges = [];

  function isEdge(statement) {
    if (isSequence) return sequenceMessagePattern.test(statement);
    return flowchartEdgeMarkPattern.test(stripMermaidLabels(statement));
  }

  for (const statement of statements.slice(1)) {
    if (mermaidStructuralLinePattern.test(statement)) {
      const decl = statement.match(/^(?:participant|actor|state|class|element)\s+([A-Za-z][\w]*)(?:\s+as\s+(.+?))?\s*$/i);
      if (decl) {
        const label = (decl[2] ?? decl[1]).replace(/["<>]/g, "").trim();
        nodes.set(decl[1], label);
        labels.push(label);
      }
      const subgraph = statement.match(/^subgraph\s+\w+\[([^\]]+)\]/i);
      if (subgraph) labels.push(subgraph[1].trim());
      continue;
    }
    if (isEdge(statement)) {
      edges.push(stripMermaidLabels(statement).replace(/\s+/g, " ").trim());
      for (const id of mermaidEdgeNodeIds(statement)) referenced.add(id);
      for (const match of statement.matchAll(/([A-Za-z][\w]*)\s*[\[{(]+([^\]})]*)[\]})]+/g)) {
        nodes.set(match[1], match[2].trim());
        labels.push(match[2].trim());
      }
      for (const match of statement.matchAll(/\|([^|]+)\|/g)) labels.push(match[1].trim());
      if (isSequence) {
        const message = statement.match(/:\s*(.+)$/);
        if (message) labels.push(message[1].trim());
      }
    } else {
      const def = statement.match(/^([A-Za-z][\w]*)\s*[\[{(]+([^\]})]*)[\]})]+\s*$/);
      if (def) {
        nodes.set(def[1], def[2].trim());
        labels.push(def[2].trim());
      }
    }
  }

  const isolatedNodes = isNodeGraph ? [...nodes.keys()].filter((id) => !referenced.has(id)) : [];
  const nodeCount = isSequence ? nodes.size : new Set([...nodes.keys(), ...referenced]).size;
  const seen = new Set();
  let duplicateEdge = false;
  for (const edge of edges) {
    if (seen.has(edge)) {
      duplicateEdge = true;
      break;
    }
    seen.add(edge);
  }

  return {
    type,
    validHeader: validMermaidHeaderPattern.test(header),
    statements,
    edges,
    edgeCount: edges.length,
    nodeCount,
    labels: labels.filter(Boolean),
    isolatedNodes,
    duplicateEdge,
    isNodeGraph,
  };
}

function extractMermaidLabels(content = "") {
  return analyzeMermaid(content).labels;
}

function relevanceTokens(topic) {
  const text = `${topic.title} ${(topic.tags ?? []).join(" ")} ${topic.summary ?? ""}`;
  const tokens = new Set();
  const stopTokens = new Set([
    "为什么",
    "如何",
    "什么",
    "理解",
    "掌握",
    "核心",
    "原理",
    "机制",
    "基础",
    "流程",
    "问题",
    "方案",
    "设计",
    "模型",
    "区别",
    "常见",
    "面试",
    "实现",
    "使用",
    "适用",
    "边界",
    "场景",
    "能力",
  ]);
  function addToken(token) {
    const clean = token.trim().toLowerCase();
    if (clean.length >= 2 && !stopTokens.has(clean)) tokens.add(clean);
  }
  for (const token of text.match(/[A-Za-z][A-Za-z0-9+#.-]{1,}/g) ?? []) {
    addToken(token);
  }
  for (const token of text.split(/[、，,。:：/()（）\s]+/)) {
    const clean = token.trim();
    if (clean.length >= 2 && /[\u4e00-\u9fa5]/.test(clean)) {
      addToken(clean);
      for (const word of clean.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
        if (word.length >= 4) {
          for (let size = 2; size <= 3; size += 1) {
            for (let index = 0; index <= word.length - size; index += 1) {
              addToken(word.slice(index, index + size));
            }
          }
        }
      }
    }
  }
  return [...tokens];
}

function primaryRelevanceTokens(topic) {
  const stopTokens = new Set([
    "概述",
    "基础",
    "核心",
    "原理",
    "机制",
    "流程",
    "设计",
    "模式",
    "实践",
    "开发",
    "系统",
    "服务",
    "工程",
    "问题",
    "方案",
    "应用",
    "高阶",
    "性能",
    "优化",
    "面试",
  ]);
  return relevanceTokens(topic)
    .filter((token) => token.length >= 2 && !stopTokens.has(token))
    .filter((token) => !/^\d+$/.test(token))
    .slice(0, 24);
}

function matchedTokens(text, tokens) {
  const source = String(text).toLowerCase();
  return tokens.filter((token) => source.includes(token.toLowerCase()));
}

function countPattern(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...String(text).matchAll(new RegExp(pattern.source, flags))].length;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function scaledScore(value, target, points) {
  if (!target) return 0;
  return clamp(value / target) * points;
}

function booleanScore(condition, points) {
  return condition ? points : 0;
}

function mermaidEdgeCount(content = "") {
  return analyzeMermaid(content).edgeCount;
}

function hasMermaidBranch(content = "") {
  return /--\s*(?:是|否|yes|no|成功|失败|命中|未命中|允许|拒绝|通过|不通过|异常|正常)\s*--?>|\{[^}]+\}|\balt\b|\bopt\b/i.test(content);
}

function diagramHumanSignals(card, topic) {
  const analyzed = analyzeMermaid(cardMermaidContent(card));
  const labels = analyzed.labels;
  const edgeCount = analyzed.edgeCount;
  const labelText = labels.join(" ");
  const fallbackText = `${card.fallback ?? ""}${card.caption ?? ""}`;
  const tokens = primaryRelevanceTokens(topic);
  const matched = matchedTokens(`${labelText} ${fallbackText}`, tokens);
  const genericCount = labels.filter((label) => genericDiagramLabelPattern.test(label)).length;
  return {
    labels: labels.length,
    edgeCount,
    matchedTokens: matched.length,
    genericRatio: labels.length ? genericCount / labels.length : 1,
    hasBranch: hasMermaidBranch(cardMermaidContent(card)),
    hasReadableFallback: textLength(fallbackText) >= 24,
    isStrong:
      labels.length >= 4 &&
      edgeCount >= 3 &&
      matched.length >= Math.min(2, Math.max(1, tokens.length)) &&
      genericCount / Math.max(1, labels.length) <= 0.35 &&
      textLength(fallbackText) >= 24,
  };
}

function isStrongDiagramCard(card, topic) {
  if (diagramHumanSignals(card, topic).isStrong) return true;
  if (!cardHasSvg(card) || !cardHasMermaidOrTextFallback(card)) return false;
  const fallbackText = `${card.fallback ?? ""} ${card.caption ?? ""} ${(Array.isArray(card.sources) ? card.sources : [])
    .filter((source) => source?.kind === "text")
    .map((source) => source.content ?? "")
    .join(" ")}`;
  const tokens = primaryRelevanceTokens(topic);
  const matched = matchedTokens(fallbackText, tokens);
  return textLength(fallbackText) >= 24 && matched.length >= Math.min(2, Math.max(1, tokens.length));
}

function isGoodCompareCard(card) {
  if (Array.isArray(card.columns) && card.columns.length >= 3 && Array.isArray(card.rows) && card.rows.length >= 3) {
    return true;
  }
  const content = card.content ?? "";
  const tableRows = String(content)
    .split("\n")
    .filter((line) => /^\s*\|.+\|\s*$/.test(line));
  if (tableRows.length < 4) return false;
  const headerCells = tableRows[0].split("|").map((cell) => cell.trim()).filter(Boolean);
  return headerCells.length >= 3 && /\|\s*-{3,}\s*\|/.test(tableRows[1] ?? "");
}

const templatePatterns = [
  [/结论：结论：/, "重复结论前缀"],
  [/优先看输入条件、关键指标、错误日志和依赖状态/, "泛化线上排查回答"],
  [/而不是停留在工具名/, "工具名模板表述"],
  [/和相近方案相比有什么取舍/, "泛化相近方案追问"],
  [/\"适用边界\"\s*,\s*\"排查路径\"\s*,\s*\"工程取舍\"/, "泛化 goodToHave"],
  [/建议结合实际项目|理论和实践脱节|回答不够深入|不了解原理/, "泛化评价语"],
  [/这个问题要看具体情况|没有银弹/, "空泛兜底语"],
  [/学透这题的抓手|追问落点|复述校验|必须讲透的主线/, "explain 学习脚手架模板"],
  [/入口\/结构行|讲解锚点|输出语义|承担的职责，再展开内部流程/, "代码高亮模板"],
  [/今日笔记|面试冲刺|综合复习|面试场景题|面试话术/, "非知识点定位词"],
  [/[^，。；\n]{1,40} 在 [^，。；\n]{1,50} 中的作用/, "自动拼接式 rubric/正文表达"],
  [/目标\s*->\s*机制\s*->\s*边界\s*->\s*验证/, "自动补丁式四步模板"],
  [/代码中的[^，。；\n]*(体现|展示)[^，。；\n]*实现位置/, "代码高亮实现位置占位"],
  [/这段代码围绕[^，。；\n]*展开|如何处理输入、状态变化和边界/, "代码高亮泛化解释"],
  [/不能只套默认配置|自动化能力必须保留审计、回滚和人工接管路径|不同环境的差异要显式管理/, "泛化工程治理补丁"],
  [/只背「[^」]+」结论/, "泛化反例表达"],
  [/关键机制可以按「[^」]+」展开。这里要说明为什么这些条件会影响结果/, "自动补丁式机制段"],
];

const broadTitlePattern = /全景|综合|其他|最佳实践|大全|冲刺|复习|话术/;
const weakPromptPattern = /用自己的话|注意事项|有什么特点|简单介绍|综合复习|你在项目中怎么用/;
const genericRubricItemPattern =
  /^(适用边界|排查路径|工程取舍|核心流程|核心机制|常见误区|回答清晰|表达完整|结合项目|理解原理|掌握概念)$/;
const genericFollowUpAnswerPattern =
  /优先看输入条件|建议结合实际项目|要看具体情况|先确认问题是否落在|再用日志、指标或最小用例验证|回答时要先给出/;
const genericHighlightPattern =
  /关键行|示例只用于锚定|当前考点|当前机制|讲解锚点|入口\/结构行|输出语义|注意这一行/;
const genericDiagramLabelPattern =
  /^(输入|输出|开始|结束|处理|执行|判断|返回|状态维护|边界处理|输出答案|关键流程|核心流程|关键环节|选择方案|验证结果|更新状态|定位问题)$/;
const genericDiagramTitlePattern = /^(流程图|结构图|关系图|机制图|图解|知识图谱)$|结构图解$|机制图解$/;
const generatedDiagramCaptionPattern =
  /^这张图把 .+ 的核心对象、状态变化和边界风险串起来，便于按链路解释。$/;
const generatedDiagramTitlePattern = /关键链路图$/;
const genericCardTitlePattern =
  /^(核心概念|核心原理|核心机制|机制主线|知识全景|深入理解|机制演进|选型边界|概念补充|补充说明|延伸阅读|高级理解|深入剖析)$/;
const genericCardTitleTextPattern =
  /^(?:核心概念|核心原理|核心机制|机制主线|知识全景|深入理解|机制演进|选型边界|概念补充|补充说明|高级理解|深入剖析)(?:$|[：:\s])|的机制主线$|（续）|\(续\)|续篇|第[二三四]张/;
const mechanismSignalPattern =
  /为什么|机制|流程|边界|误区|取舍|风险|条件|触发|依赖|实现|执行|可见性|一致性|复杂度|生命周期|思路|步骤|状态|转移|递归|遍历|剪枝|指针|队列|栈|索引|缓存|请求|响应|协议|配置|部署|监控|指标|事件|用户|内容|流量|转化|认证|授权|权限|证书|事务|锁|分区|调度|故障|恢复/;
const cjkLatinSpacingPattern = /[\u4e00-\u9fa5][A-Za-z0-9#.+]|[A-Za-z0-9#.+][\u4e00-\u9fa5]/;
const unnaturalLanguagePattern =
  /的难点在于把「[^」]+」「[^」]+」「[^」]+」连成因果链|「[^」]+ 的核心目标」决定这个知识点的主线|验证理解是否落到真实链路|不能只给工具名|把这几层连起来看，才能|从零理解可以抓住这条主线|深入理解时重点看三个问题|实际使用时，应回到输入规模、执行顺序、依赖状态和可观测证据上验证|到了 .+ 的高阶追问|回答时要给出触发条件、状态变化和验证证据|继续往下看，.+不能只记结论/;
const algorithmTemplateLeakPattern =
  /要先说明题目约束，再给出核心解法和复杂度|先复述输入、输出和限制条件|空输入、重复值、指针越界或状态初始化|给出时间、空间复杂度/;
// 标题参数化模板：生成器套用"结论：{标题} 要先说清它解决什么问题 …… 我会这样回答：1. 先定位核心问题 …… 2. 再串起关键机制 …… 3. 接着补充边界和风险 …… 4. 验证 {标题} 时 …… 如果(面试官)继续追问 {标题}"。
// 每篇 slot 进不同标题，逐字指纹永不命中 4 篇，绕过跨 topic 模板句检测；但这套脚手架本身是机器腔，面试中念出来很尴尬。专门按结构短语识别，与标题无关。
const parameterizedAnswerTemplatePattern =
  /要先说清它解决什么问题，再展开机制、边界和验证方式|我会这样回答：[\s\S]{0,60}先定位核心问题|再串起关键机制[\s\S]{0,80}接着补充边界和风险|时，(?:我会|要回到)[\s\S]{0,80}(?:才算判断闭环|放在一起交叉确认)/;
const machineRelationPhrasePattern = /能否说清|的定义和核心目标|如何影响[^，。；\n]{2,60}/;
const concreteExamplePattern =
  /例如|比如|举例|以[^，。；\n]{1,24}为例|假设|案例|场景|当[^，。；\n]{1,40}时|如果[^，。；\n]{1,40}(?:，|则|就)/;
const boundarySignalPattern =
  /边界|限制|不适合|误区|风险|失败|异常|坑|取舍|权衡|退化|副作用|一致性|隔离|回滚|降级|补偿|死锁|泄露|超时|重复|丢失/;
const verificationSignalPattern =
  /验证|观测|指标|日志|链路追踪|trace|metric|测试|压测|排查|复现|监控|告警|profile|benchmark|审计|EXPLAIN|Explain/;
const tradeoffSignalPattern =
  /取舍|权衡|代价|成本|吞吐|延迟|一致性|可用性|复杂度|维护性|扩展性|可靠性|安全性|可观测|可恢复/;
const failureSignalPattern =
  /失败|异常|风险|故障|超时|丢失|重复|阻塞|死锁|泄露|降级|回滚|补偿|OOM|崩溃|攻击|漏洞|雪崩|击穿|穿透/;
const rubricTemplateItemPattern =
  /能准确解释.+的核心概念、作用和适用边界|能说清\s*.+\s*的核心机制和关键流程|核心目标与适用边界|能结合指标或示例验证\s*.+\s*的效果|^.+\s+的条件和边界$/;
const proseFillerPattern =
  /本质上|可以理解为|核心是|关键在于|需要注意的是|换句话说|简单来说|从这个角度看/g;
const shortRubricAllowPattern =
  /^(BFS|DFS|DP|LRU|LFU|AQS|CAS|MVCC|JWT|TLS|SSL|TCP|UDP|HTTP|HTTPS|DNS|CDN|GC|JVM|JIT|BFC|GMP|MCP|RAG|ETL|CDC|OLAP|OLTP|DDL|DML|SQL|NoSQL|ACID|CAP|BASE|CI\/CD|IaC|SRE|DDD|CQRS|Pod|K8s|Go|MySQL|Redis|MongoDB|Kafka|Spark|Flink|Hive|路径|状态|队列|栈|堆|锁|事务|索引|缓存|分片|分区|副本|主键|外键|快照|回溯|剪枝|哈希|递归|指针|滑窗|窗口|协议|证书|权限|认证|授权)$/i;
// rubric 内嵌代码：评分标准只能是知识点短语，代码只该进 code 卡（AI 生成器高发 bug，如 throw new ...();）。高精度匹配真实代码结构，避免误判 ThreadLocal.get() 这类 API 名。
const rubricCodePattern =
  /throw\s+new\s+[A-Za-z_]\w*\s*\(|\bfunction\s+\w*\s*\([^)]*\)\s*\{|=>\s*[\{(]|`{3}|[A-Za-z_]\w*\s*\([^)]*\)\s*;\s*$|\)\s*\{\s*$|\bconsole\.\w+\s*\(|\bnew\s+[A-Z]\w*\s*\([^)]*\)\s*;/;
// 假图（关键词直链）的可靠确定性信号：图以“面试结论/答题要点/总结”这类元节点收尾——真正的机制图不会有一个节点叫“面试结论”。纯线性链本身可能是合法顺序流程，不在确定性门禁里硬判，交给 LLM 判官。
const diagramConclusionNodePattern =
  /^(面试结论|答题结论|答题要点|面试表达|面试回答|结论与表达|要点总结|考点总结|复述要点|总结提炼|学习主线|答题脚手架)$/;

function isAcceptableShortRubricItem(item, topic) {
  const clean = item.trim();
  if (shortRubricAllowPattern.test(clean)) return true;
  if (/^[A-Z][A-Z0-9/+.-]{1,}$/.test(clean)) return true;
  if (clean.length >= 2 && topic.title.includes(clean)) return true;
  if ((topic.tags ?? []).some((tag) => tag.includes(clean))) return true;
  return false;
}

const markdownTableLinePattern = /^\s*\|.*\|\s*$/;
const placeholderTextPattern =
  /\bTODO\b|\bFIXME\b|待补充|待完善|此处省略|内容略|lorem ipsum/i;
const replacementCharPattern = /�/;
const literalEscapeLeakPattern = /\\n|\\t/;
const validMermaidHeaderPattern =
  /^(graph\s+(?:TB|TD|BT|RL|LR)|flowchart\s+(?:TB|TD|BT|RL|LR)|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|journey|gantt|pie\b|timeline|mindmap)/;
const concreteFactPattern =
  /O\([^)]{1,16}\)|\d+(?:\.\d+)?\s*(?:ms|µs|ns|秒|毫秒|分钟|小时|天|%|KB|MB|GB|TB|qps|tps|rps|字节|byte|bit|核|线程|连接|副本|分片|并发|倍)|\bv?\d+\.\d+(?:\.\d+)?\b|JDK\s*\d+|\.NET\s*\d+|HTTP\/[123]|端口\s*\d{2,5}/gi;
const codePlaceholderPattern =
  /(?:\/\/|#|--)\s*(?:\.\.\.|…|TODO|省略|略)\s*$|(?:^|\n)\s*(?:\.\.\.|…)\s*(?:$|\n)/m;
const codeLanguageSignatures = {
  java: [
    /\b(?:class|interface|enum|record)\s+\w+|System\.out|import\s+java|void\s+\w+\(|new\s+\w+[<(]/,
    /\bdef\s+\w+\(|(?:^|\n)\s*func\s+\w+\(|console\.log\(|using\s+System|#include\s*</,
  ],
  go: [
    /\bfunc\s|\bpackage\s|:=|\bchan\b|\bgo\s+\w/,
    /\bpublic\s+class\b|System\.out|\bdef\s+\w+\(|console\.log\(/,
  ],
  python: [
    /\bdef\s|\bimport\s|\bprint\(|\bclass\s+\w+:|\bself\b/,
    /\bpublic\s+class\b|System\.out|console\.log\(|using\s+System/,
  ],
  csharp: [
    /using\s+System|\bnamespace\s|\bpublic\s|\bvar\s+\w+\s*=|\bawait\s/,
    /System\.out|\bpackage\s+main\b|\bdef\s+\w+\(/,
  ],
};
const lexiconStopTokens = new Set([
  "面试",
  "原理",
  "基础",
  "机制",
  "性能",
  "优化",
  "实践",
  "架构",
  "设计",
  "应用",
  "核心",
  "流程",
  "概念",
  "场景",
]);

function stripCodeSegments(text = "") {
  return String(text)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
}

function splitIntoSentences(text = "") {
  return String(text)
    .split(/[。！？!?\n]+/)
    .map((part) => part.trim().replace(/^[#>*\-\d.、\s]+/, ""))
    .filter(Boolean);
}

function isTemplateComparableSentence(sentence) {
  if (markdownTableLinePattern.test(sentence)) return false;
  if (/^[-|:\s]+$/.test(sentence)) return false;
  return textLength(sentence) >= 20;
}

function sourceContents(card) {
  return (Array.isArray(card.sources) ? card.sources : [])
    .map((source) => source?.content)
    .filter((content) => typeof content === "string" && content.trim());
}

function cardMermaidContent(card) {
  const source = (Array.isArray(card.sources) ? card.sources : [])
    .find((item) => item?.kind === "mermaid" && typeof item.content === "string" && item.content.trim());
  if (source) return source.content;
  return card.content ?? "";
}

function isSvgAssetPath(value) {
  return typeof value === "string" && /\.svg(?:[?#].*)?$/i.test(value.trim());
}

function cardSvgPaths(card) {
  const paths = [];
  for (const value of [card.svgPath, card.asset]) {
    if (isSvgAssetPath(value)) paths.push(value.trim());
  }
  for (const source of Array.isArray(card.sources) ? card.sources : []) {
    if (source?.kind === "svg" && isSvgAssetPath(source.path)) paths.push(source.path.trim());
  }
  return paths;
}

function cardHasSvg(card) {
  if (card.format === "svg" || typeof card.svg === "string") return true;
  return cardSvgPaths(card).length > 0 || (Array.isArray(card.sources) && card.sources.some((source) => source?.kind === "svg"));
}

function cardHasMermaidOrTextFallback(card) {
  if (typeof card.fallback === "string" && textLength(card.fallback) >= 12) return true;
  if (typeof card.caption === "string" && textLength(card.caption) >= 12) return true;
  return (Array.isArray(card.sources) ? card.sources : []).some(
    (source) =>
      (source?.kind === "mermaid" || source?.kind === "text") &&
      typeof source.content === "string" &&
      textLength(source.content) >= 12,
  );
}

function cardHasTextualFallback(card) {
  if (typeof card.fallback === "string" && textLength(card.fallback) >= 12) return true;
  if (typeof card.caption === "string" && textLength(card.caption) >= 12) return true;
  return (Array.isArray(card.sources) ? card.sources : []).some(
    (source) => source?.kind === "text" && typeof source.content === "string" && textLength(source.content) >= 12,
  );
}

function validAssetPath(value) {
  return typeof value === "string" && value.startsWith("assets/") && !value.includes("..") && !path.isAbsolute(value);
}

function spatialDiagramExpected(topic) {
  const text = `${topic.domain} ${topic.category} ${topic.title} ${(topic.tags ?? []).join(" ")} ${topic.summary ?? ""}`;
  return (
    topic.domain === "algorithm" ||
    /动态规划|DP|数组|矩阵|网格|双指针|滑动窗口|链表|指针|二叉树|树|图遍历|BFS|DFS|堆|队列|栈|回溯|递归|前缀和|拓扑|并查集|窗口|状态表|状态转移/i.test(text)
  );
}

function topicProseFields(topic, { includeMeta = true } = {}) {
  const fields = [];
  for (const card of topic.learningCards ?? []) {
    if (card.type === "code") continue;
    if (card.type === "diagram" || card.type === "animation") {
      fields.push(card.caption ?? "", card.fallback ?? "", ...sourceContents(card));
      continue;
    }
    fields.push(card.content ?? "");
    if (Array.isArray(card.items)) fields.push(...card.items);
    if (Array.isArray(card.columns)) fields.push(card.columns.join(" "));
    if (Array.isArray(card.rows)) fields.push(...card.rows.map((row) => row.join(" ")));
    for (const followUp of card.followUpQuestions ?? []) {
      fields.push(followUp.question ?? "", followUp.answer ?? "");
    }
  }
  if (includeMeta) {
    fields.push(topic.summary ?? "", topic.interviewerFocus ?? "");
    for (const prompt of topic.recallPrompts ?? []) fields.push(prompt.prompt ?? "");
    for (const key of ["mustHave", "goodToHave", "commonMistakes"]) {
      fields.push(...(topic.rubric?.[key] ?? []));
    }
  }
  return fields.filter(Boolean);
}

function fingerprintSentences(topic) {
  const sentences = new Set();
  for (const field of topicProseFields(topic)) {
    for (const sentence of splitIntoSentences(stripCodeSegments(field))) {
      if (isTemplateComparableSentence(sentence)) sentences.add(sentence);
    }
  }
  return sentences;
}

function collectCardProseText(topic) {
  const fields = [];
  for (const card of topic.learningCards ?? []) {
    fields.push(card.title ?? "");
    if (card.type === "diagram" || card.type === "animation") {
      fields.push(card.content ?? "", card.caption ?? "", card.fallback ?? "", ...sourceContents(card));
      continue;
    }
    fields.push(card.content ?? "");
    if (Array.isArray(card.items)) fields.push(...card.items);
    if (Array.isArray(card.columns)) fields.push(card.columns.join(" "));
    if (Array.isArray(card.rows)) fields.push(...card.rows.map((row) => row.join(" ")));
    for (const followUp of card.followUpQuestions ?? []) {
      fields.push(followUp.question ?? "", followUp.answer ?? "");
    }
  }
  return fields.filter(Boolean).join("\n");
}

function effectiveTextLength(texts) {
  const seen = new Set();
  let chars = 0;
  for (const text of texts) {
    for (const part of String(text).split(/[。！？!?\n]+/)) {
      const key = compact(part);
      if (!key.length) continue;
      if (key.length >= 12) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      chars += key.length;
    }
  }
  return chars;
}

function sentenceRepetitionStats(topic) {
  const counts = new Map();
  let total = 0;
  for (const field of topicProseFields(topic, { includeMeta: false })) {
    for (const sentence of splitIntoSentences(stripCodeSegments(field))) {
      if (!isTemplateComparableSentence(sentence)) continue;
      total += 1;
      counts.set(sentence, (counts.get(sentence) ?? 0) + 1);
    }
  }
  let repeatedExtra = 0;
  for (const [, count] of counts) if (count >= 2) repeatedExtra += count - 1;
  return { totalSentences: total, repeatedExtra, ratio: total ? repeatedExtra / total : 0 };
}

function compareTableCells(card) {
  if (Array.isArray(card.columns) && Array.isArray(card.rows)) {
    return {
      columns: card.columns.map((cell) => String(cell).trim()),
      rows: card.rows.map((row) => row.map((cell) => String(cell).trim())),
    };
  }
  const lines = String(card.content ?? "")
    .split("\n")
    .filter((line) => markdownTableLinePattern.test(line));
  if (lines.length < 3) return null;
  const parsed = lines.map((line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim()),
  );
  return {
    columns: parsed[0],
    rows: parsed.slice(1).filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell))),
  };
}

function titleEchoTokens(title = "") {
  const tokens = new Set();
  for (const run of normalizedText(title).match(/[A-Za-z0-9]{2,}/g) ?? []) tokens.add(run);
  for (const run of normalizedText(title).match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let index = 0; index <= run.length - 2; index += 1) tokens.add(run.slice(index, index + 2));
  }
  return [...tokens];
}

const scenarioQuestionPattern =
  /线上|生产环境|高并发|大流量|故障|压测|突然|遇到|出现[^，。]{0,16}(?:问题|异常|失败|超时|抖动|不一致)|(?:如何|怎么|怎样)(?:预防|避免|应对|处理|保证|排查|定位|优化|选择|设计|降低|提升|解决|权衡|取舍|落地)|怎么办|你会怎么|实际项目|什么场景|哪些场景|场景下/;

function coverageTokens(text) {
  const lower = String(text).toLowerCase();
  const tokens = new Set();
  for (const word of lower.match(/[a-z0-9][a-z0-9_+.#-]{1,}/g) ?? []) tokens.add(word);
  for (const run of lower.match(/[一-龥]{2,}/g) ?? []) {
    for (let index = 0; index <= run.length - 2; index += 1) tokens.add(run.slice(index, index + 2));
  }
  return tokens;
}

function coverageRatio(query, sourceLower) {
  const tokens = [...coverageTokens(query)];
  if (!tokens.length) return 1;
  let hits = 0;
  for (const token of tokens) if (sourceLower.includes(token)) hits += 1;
  return hits / tokens.length;
}

function tokenJaccard(left, right) {
  const a = coverageTokens(left);
  const b = coverageTokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function buildCorpus(allTopics) {
  const sentenceTopics = new Map();
  const domainLexicon = new Map();
  for (const { topic, ref } of allTopics) {
    for (const sentence of fingerprintSentences(topic)) {
      const refs = sentenceTopics.get(sentence) ?? new Set();
      refs.add(ref);
      sentenceTopics.set(sentence, refs);
    }
    const lexicon = domainLexicon.get(topic.domain) ?? new Set();
    for (const tag of topic.tags ?? []) {
      const token = String(tag).trim().toLowerCase();
      if (token.length >= 2 && !/^\d+$/.test(token) && !lexiconStopTokens.has(token)) {
        lexicon.add(token);
      }
    }
    domainLexicon.set(topic.domain, lexicon);
  }
  return { sentenceTopics, domainLexicon };
}

function expectedMinutesRange(difficulty) {
  if (difficulty <= 1) return [8, 20];
  if (difficulty === 2) return [12, 30];
  if (difficulty === 3) return [20, 40];
  if (difficulty === 4) return [28, 50];
  return [35, 65];
}

function expertExplainTarget(difficulty, domain) {
  if (domain === "algorithm") return difficulty <= 2 ? 520 : difficulty === 3 ? 820 : difficulty === 4 ? 980 : 1150;
  if (difficulty <= 2) return 360;
  if (difficulty === 3) return 680;
  if (difficulty === 4) return 900;
  return 1100;
}

function expertTotalTarget(difficulty, domain) {
  if (domain === "algorithm") return difficulty <= 2 ? 1900 : difficulty === 3 ? 2600 : difficulty === 4 ? 3100 : 3600;
  if (difficulty <= 2) return 1450;
  if (difficulty === 3) return 1850;
  if (difficulty === 4) return 2350;
  return 2850;
}

function cardOrderRank(type) {
  return {
    explain: 1,
    diagram: 2,
    animation: 2,
    compareTable: 3,
    code: 4,
    interviewAnswer: 5,
    checklist: 6,
  }[type] ?? 7;
}

function scoreTopic(topic, ref, corpus) {
  const issues = [];
  let score = 100;
  let scoreCap = 100;
  const counts = cardCounts(topic);
  const explainCards = (topic.learningCards ?? []).filter((card) => card.type === "explain");
  const interviewCards = (topic.learningCards ?? []).filter((card) => card.type === "interviewAnswer");
  const diagramCards = (topic.learningCards ?? []).filter((card) => card.type === "diagram" || card.type === "animation");
  const compareCards = (topic.learningCards ?? []).filter((card) => card.type === "compareTable");
  const checklistCards = (topic.learningCards ?? []).filter((card) => card.type === "checklist");
  const explainChars = effectiveTextLength(explainCards.map((card) => card.content ?? ""));
  const totalChars = effectiveTextLength((topic.learningCards ?? []).map(cardText));
  const allText = collectTopicText(topic);
  const readableText = collectReadableTopicText(topic);
  // 对齐度和专家信号只能在卡片正文里找证据；readableText 含 title/tags/summary，会自己匹配自己。
  const cardProseText = collectCardProseText(topic);
  const cardProseLower = cardProseText.toLowerCase();
  const primaryTokens = primaryRelevanceTokens(topic);
  const primaryTokenMatches = matchedTokens(cardProseText, primaryTokens);

  function deduct(points, issue) {
    score -= points;
    issues.push(issue);
  }

  function capScore(maxScore, issue) {
    if (maxScore < scoreCap) scoreCap = maxScore;
    issues.push(`最高 ${maxScore} 分：${issue}`);
  }

  const sharedSentenceDetails = [];
  if (corpus) {
    for (const sentence of fingerprintSentences(topic)) {
      const spread = corpus.sentenceTopics.get(sentence)?.size ?? 0;
      if (spread >= 4) sharedSentenceDetails.push({ sentence, spread });
    }
  }
  const isAlgorithmScaffoldSentence = (detail) =>
    topic.domain === "algorithm" && algorithmTemplateLeakPattern.test(detail.sentence);
  const scaffoldShared = sharedSentenceDetails.filter(isAlgorithmScaffoldSentence);
  const hardShared = sharedSentenceDetails
    .filter((detail) => !isAlgorithmScaffoldSentence(detail))
    .sort((a, b) => b.spread - a.spread);
  if (hardShared.length) {
    const penalty = Math.min(
      14,
      hardShared.reduce((sum, detail) => sum + (detail.spread >= 12 ? 4 : detail.spread >= 6 ? 3 : 2), 0),
    );
    deduct(
      penalty,
      `跨 topic 逐字复用句 ${hardShared.length} 句（最广一句出现在 ${hardShared[0].spread} 个 topic）：${hardShared[0].sentence.slice(0, 40)}…`,
    );
  }
  if (scaffoldShared.length) {
    deduct(Math.min(3, scaffoldShared.length), `算法答题脚手架句跨题逐字复用 ${scaffoldShared.length} 句，建议按题面改写`);
  }
  if (hardShared.length >= 3) {
    capScore(88, `含 ${hardShared.length} 句跨 topic 模板句，语言不是为本知识点写的`);
  } else if (hardShared.length === 2) {
    capScore(92, "含 2 句跨 topic 模板句");
  } else if (hardShared.length === 1) {
    capScore(94, "含 1 句跨 topic 复用句，95+ 要求语言完全为本知识点而写");
  }
  const repetition = sentenceRepetitionStats(topic);
  if (repetition.totalSentences >= 12 && repetition.ratio > 0.15) {
    deduct(Math.min(8, Math.round(repetition.ratio * 30)), `topic 内部句子重复率过高 ${(repetition.ratio * 100).toFixed(0)}%，疑似复制注水`);
    capScore(89, "内部句子大量重复，正文有效信息量不足");
  } else if (repetition.totalSentences >= 12 && repetition.ratio > 0.12) {
    capScore(94, "内部句子重复率偏高，不能进入优秀档");
  }

  if ((topic.status ?? "") !== "production") deduct(8, "status 不是 production");
  if (!topic.interviewerFocus || textLength(topic.interviewerFocus) < 28) deduct(5, "interviewerFocus 不够具体");
  if (!topic.summary || textLength(topic.summary) < 22) deduct(4, "summary 过短");
  if (textLength(topic.summary) > 120) deduct(2, "summary 过长，像正文而不是摘要");
  if (broadTitlePattern.test(topic.title)) deduct(8, "标题过泛或像任务");
  if (cjkLatinSpacingPattern.test(topic.title ?? "")) deduct(3, "标题中英文或数字之间缺少空格");
  if (/实战|最佳实践|综合|全景|大全/.test(topic.title) && topic.domain !== "architecture") {
    deduct(5, "topic 标题疑似合集或实践包装");
  }
  const [minMinutes, maxMinutes] = expectedMinutesRange(topic.difficulty);
  if (topic.estimatedMinutes < minMinutes || topic.estimatedMinutes > maxMinutes) {
    deduct(3, `estimatedMinutes 与 difficulty 不匹配 ${topic.estimatedMinutes}/${minMinutes}-${maxMinutes}`);
  }

  if (!explainCards.length) deduct(18, "缺少 explain 卡");
  if (!interviewCards.length) deduct(14, "缺少 interviewAnswer 卡");
  if (!checklistCards.length) deduct(6, "缺少 checklist 卡");
  if (!diagramCards.length && !compareCards.length) deduct(8, "缺少图示或对比表");

  const expectedExplainCards = topic.difficulty >= 3 ? 2 : 1;
  if (topic.domain !== "algorithm" && topic.difficulty >= 3 && explainCards.length < expectedExplainCards) {
    deduct(topic.difficulty >= 4 ? 10 : 8, `difficulty ${topic.difficulty} 至少需要 ${expectedExplainCards} 张 explain`);
  }
  if (topic.domain !== "algorithm" && topic.difficulty <= 2 && explainCards.length > 1) {
    deduct(4, `difficulty ${topic.difficulty} explain 卡过多，简单题可能注水`);
  }

  const minExplainChars =
    topic.difficulty <= 2 ? 180 : topic.difficulty === 3 ? 520 : topic.difficulty === 4 ? 650 : 780;
  if (explainChars < minExplainChars) {
    deduct(Math.min(12, Math.ceil((minExplainChars - explainChars) / 70)), `explain 深度不足 ${explainChars}/${minExplainChars}`);
  }

  const minTotalChars =
    topic.difficulty <= 2 ? 760 : topic.difficulty === 3 ? 1200 : topic.difficulty === 4 ? 1450 : 1650;
  if (totalChars < minTotalChars) {
    deduct(Math.min(10, Math.ceil((minTotalChars - totalChars) / 100)), `总内容量不足 ${totalChars}/${minTotalChars}`);
  }

  const charsPerMinute = topic.estimatedMinutes ? totalChars / topic.estimatedMinutes : null;
  if (charsPerMinute !== null && (charsPerMinute < 35 || charsPerMinute > 450)) {
    deduct(2, `estimatedMinutes 与实际内容量不匹配（约 ${Math.round(charsPerMinute)} 字/分钟），误导学习计划`);
  }

  for (const [pattern, label] of templatePatterns) {
    if (pattern.test(allText)) deduct(12, label);
  }
  if (unnaturalLanguagePattern.test(allText)) deduct(8, "语言自然度不足，存在拼接感或占位句");
  if (topic.domain !== "algorithm" && algorithmTemplateLeakPattern.test(allText)) {
    deduct(10, "非算法 topic 混入算法题回答模板");
  }
  const interviewAnswerText = interviewCards.map((card) => card.content ?? "").join("\n");
  if (parameterizedAnswerTemplatePattern.test(interviewAnswerText)) {
    deduct(16, "interviewAnswer 是标题参数化模板（“要先说清它解决什么问题…我会这样回答：先定位核心问题…”），面试中无法直接说出口");
    capScore(80, "interviewAnswer 套用生成器脚手架模板，必须改写成本知识点真实的口语化回答");
  }
  if (primaryTokens.length >= 3 && primaryTokenMatches.length < Math.min(3, primaryTokens.length)) {
    deduct(5, `卡片正文与标题/标签的专属词呼应不足 ${primaryTokenMatches.length}/${Math.min(3, primaryTokens.length)}`);
  }
  if (!concreteExamplePattern.test(cardProseText)) {
    deduct(4, "缺少具体例子或场景，读者难以落地理解");
    capScore(92, "没有具体例子/场景支撑，只能算结构合格");
  }
  if (!boundarySignalPattern.test(cardProseText)) {
    deduct(5, "缺少边界、风险或常见误区");
    capScore(92, "没有边界和误区，难以达到高质量知识");
  }
  if (topic.difficulty >= 3 && !verificationSignalPattern.test(cardProseText) && topic.domain !== "algorithm") {
    deduct(4, "中高难度 topic 缺少验证、排查或可观测证据");
    capScore(94, "缺少验证/排查证据，高分需要能落到真实问题");
  }
  if (topic.difficulty >= 4 && !tradeoffSignalPattern.test(cardProseText)) {
    deduct(4, "高阶 topic 缺少取舍、成本或权衡");
    capScore(93, "高阶内容没有权衡分析，只能算讲清概念");
  }
  if (topic.difficulty >= 4 && !failureSignalPattern.test(cardProseText) && topic.domain !== "algorithm") {
    deduct(4, "高阶 topic 缺少失败模式或风险路径");
    capScore(94, "高阶内容没有失败路径，体感深度不足");
  }
  const fillerCount = countPattern(cardProseText, proseFillerPattern);
  if (fillerCount >= 14 && fillerCount > Math.max(8, Math.floor(totalChars / 360))) {
    deduct(4, `连接词/套话密度偏高，语言有拼接感 ${fillerCount}`);
  }
  const proseWithoutCode = stripCodeSegments(topicProseFields(topic).join("\n"));
  if (placeholderTextPattern.test(proseWithoutCode)) {
    deduct(6, "存在 TODO/待补充/占位 文案");
    capScore(89, "内容仍有占位文案，未完成状态");
  }
  if (topic.domain === "algorithm" && !/O\(|复杂度/.test(cardProseText)) {
    deduct(5, "算法 topic 缺少时间/空间复杂度分析");
  }
  const longProse = (topic.learningCards ?? [])
    .filter((card) => card.type !== "code" && card.type !== "diagram" && card.type !== "animation")
    .map(cardText)
    .join("\n");
  const overlongSentences = splitIntoSentences(longProse).filter((sentence) => textLength(sentence) >= 150);
  if (overlongSentences.length >= 2) {
    deduct(2, `存在 ${overlongSentences.length} 个超过 150 字无停顿的长句，影响可读性`);
  }

  let skeletonExplainCards = 0;
  let previousCardRank = 0;
  for (const card of topic.learningCards ?? []) {
    const rank = cardOrderRank(card.type);
    if (rank < previousCardRank && !(card.type === "diagram" && previousCardRank === cardOrderRank("compareTable"))) {
      deduct(2, `learningCards 顺序不符合 explain -> 图/表/code -> 面试回答 -> checklist：${card.title}`);
      break;
    }
    previousCardRank = Math.max(previousCardRank, rank);
  }

  for (const card of topic.learningCards ?? []) {
    const title = (card.title ?? "").trim();
    if (!isAlgorithmProblemIntroCard(topic, card) && (genericCardTitlePattern.test(title) || genericCardTitleTextPattern.test(title))) {
      deduct(card.type === "explain" ? 8 : 4, `${card.type} 卡标题不信息化：${card.title}`);
    }
    if (!isAlgorithmProblemIntroCard(topic, card) && card.type === "explain" && textLength(title) < 8) {
      deduct(3, `explain 标题过短：${card.title}`);
    }
    if (
      card.type !== "diagram" &&
      card.type !== "animation" &&
      card.type !== "code" &&
      literalEscapeLeakPattern.test(stripCodeSegments(cardText(card)))
    ) {
      deduct(4, `正文存在未渲染的 \\n/\\t 字面量：${card.title}`);
    }
    if (replacementCharPattern.test(cardText(card))) {
      deduct(4, `存在乱码替换符：${card.title}`);
    }
    if (card.type === "explain" || card.type === "interviewAnswer") {
      const fenceCount = (String(card.content ?? "").match(/^\s*```/gm) ?? []).length;
      if (fenceCount % 2 === 1) deduct(4, `Markdown 代码围栏未闭合：${card.title}`);
    }
    if (card.type === "explain") {
      const content = card.content ?? "";
      const hasMechanismSignal = mechanismSignalPattern.test(content);
      if (!isAlgorithmProblemIntroCard(topic, card) && !hasMechanismSignal) deduct(5, `explain 缺少机制/边界信号：${card.title}`);
      if (/请回答|复述|评分|面试官|追问/.test(content)) {
        deduct(6, `explain 混入面试训练或评分指令：${card.title}`);
      }
      if (textLength(content) >= 380 && !content.includes("\n")) {
        deduct(3, `explain 是无分段长文，阅读负担大：${card.title}`);
      }
      if (!isAlgorithmProblemIntroCard(topic, card)) {
        const echoTokens = titleEchoTokens(title);
        if (
          echoTokens.length >= 3 &&
          matchedTokens(content, echoTokens).length === 0 &&
          matchedTokens(content, primaryTokens).length === 0
        ) {
          deduct(2, `explain 标题与内容缺少呼应，疑似标题包装：${card.title}`);
        }
      }
      if (topic.domain !== "algorithm") {
        // 标准 §8 禁止“只有清单，没有解释”：成段文字过少且要点全是短标签 = 骨架笔记，零基础读者学不会。
        let proseChars = 0;
        let listLines = 0;
        let substantiveBullets = 0;
        for (const line of stripCodeSegments(content).split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || /^#{1,6}\s/.test(trimmed) || markdownTableLinePattern.test(trimmed)) continue;
          const bullet = trimmed.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
          if (bullet) {
            listLines += 1;
            if (textLength(bullet[1]) >= 18) substantiveBullets += 1;
            continue;
          }
          proseChars += textLength(trimmed);
        }
        if (proseChars < 60 && substantiveBullets <= 2 && listLines >= 5) {
          skeletonExplainCards += 1;
          if (skeletonExplainCards <= 2) {
            deduct(5, `explain 是清单骨架（成段文字 ${proseChars} 字、实质要点 ${substantiveBullets} 条），无法支撑从不会到学会：${card.title}`);
          }
        }
      }
    }
    if (card.type === "compareTable") {
      if (Array.isArray(card.columns) && Array.isArray(card.rows)) {
        if (card.rows.length < 3) deduct(3, `compareTable 行数不足：${card.title}`);
        for (const row of card.rows) {
          if (row.length !== card.columns.length) {
            deduct(5, `compareTable 列数不一致：${card.title}`);
            break;
          }
        }
      }
      const table = compareTableCells(card);
      if (table) {
        const { rows } = table;
        if (rows.some((row) => row.some((cell) => !cell))) {
          deduct(3, `对比表存在空单元格：${card.title}`);
        }
        const rowKeys = new Set();
        let duplicateRow = false;
        for (const row of rows) {
          const key = row.join("|");
          if (rowKeys.has(key)) duplicateRow = true;
          rowKeys.add(key);
        }
        if (duplicateRow) deduct(4, `对比表存在完全重复的行：${card.title}`);
        let similarRows = false;
        for (let i = 0; i < rows.length && !similarRows; i += 1) {
          for (let j = i + 1; j < rows.length; j += 1) {
            if (jaccardSimilarity(rows[i].join(" "), rows[j].join(" ")) > 0.85) {
              similarRows = true;
              break;
            }
          }
        }
        if (similarRows && !duplicateRow) deduct(3, `对比表两行内容高度相似，缺少真实区分：${card.title}`);
        const sameValueRows = rows.filter((row) => row.length >= 3 && new Set(row.slice(1).map(compact)).size === 1);
        if (sameValueRows.length >= 2) {
          deduct(2, `对比表有 ${sameValueRows.length} 行所有列取值相同，对比信息弱：${card.title}`);
        }
      }
    }
    if (card.type === "code") {
      if (!card.language) deduct(5, `code 卡缺少 language：${card.title}`);
      if (textLength(card.content) < 60) deduct(4, `code 示例过短：${card.title}`);
      const codeSignature = codeLanguageSignatures[(card.language ?? "").trim().toLowerCase()];
      const codeContent = String(card.content ?? "");
      if (codeSignature && !codeSignature[0].test(codeContent) && codeSignature[1].test(codeContent)) {
        deduct(5, `code 卡 language=${card.language} 与代码内容特征不符：${card.title}`);
      }
      const placeholderHits = countPattern(codeContent, codePlaceholderPattern);
      const codeLineCount = codeContent.split(/\r?\n/).filter((line) => line.trim()).length;
      if (placeholderHits >= 3 || (placeholderHits >= 1 && codeLineCount < 8)) {
        deduct(3, `code 以省略/TODO 占位行为主，示例不完整：${card.title}`);
      }
      if (!Array.isArray(card.highlights) || card.highlights.length === 0) {
        deduct(4, `code 卡缺少 highlights：${card.title}`);
      } else {
        const lineCount = (card.content ?? "").split(/\r?\n/).length;
        for (const highlight of card.highlights) {
          if (highlight.line < 1 || highlight.line > lineCount) {
            deduct(5, `code highlight 行号越界：${card.title}`);
            break;
          }
          if (genericHighlightPattern.test(highlight.note ?? "") || textLength(highlight.note) < 12) {
            deduct(4, `code highlight 说明不够具体：${card.title}`);
            break;
          }
        }
      }
    }
  }

  for (const card of diagramCards) {
    if (!cardHasTextualFallback(card)) deduct(3, `图示缺少 fallback/caption/text 兜底：${card.title}`);
    const hasSvg = cardHasSvg(card);
    const sources = Array.isArray(card.sources) ? card.sources : [];
    if (sources.some((source) => source?.kind === "svg") && !sources.some((source) => source?.kind === "mermaid" || source?.kind === "text")) {
      deduct(5, `SVG sources 缺少 mermaid/text 降级兜底：${card.title}`);
      capScore(94, "SVG 图解没有结构/文本兜底，渲染失败后用户无法理解");
    }
    if (hasSvg && !cardHasMermaidOrTextFallback(card)) {
      deduct(4, `SVG 图解缺少可读 fallback/caption/mermaid/text 兜底：${card.title}`);
      capScore(94, "SVG 图解缺少可读兜底，不能稳定达到 95+");
    }
    for (const svgPath of cardSvgPaths(card)) {
      if (!validAssetPath(svgPath)) {
        deduct(6, `SVG 路径越界或不在 assets/：${card.title}`);
        capScore(89, "SVG 资源路径非法");
      } else if (!existsSync(path.join(root, svgPath))) {
        deduct(6, `SVG 资源不存在：${svgPath}`);
        capScore(89, "SVG 资源引用不存在，发布态图解不可用");
      }
    }
    if ((card.title ?? "").endsWith("流程图") && /的关键环节/.test(card.caption ?? "")) {
      deduct(4, `图示标题或图注模板化：${card.title}`);
    }
    if (card.type === "diagram") {
      const mermaidContent = cardMermaidContent(card);
      const hasMermaidSource = (card.format ?? "") === "mermaid" || (Array.isArray(card.sources) && card.sources.some((source) => source?.kind === "mermaid"));
      const mermaid = hasMermaidSource ? analyzeMermaid(mermaidContent) : null;
      const labels = mermaid ? mermaid.labels : extractMermaidLabels(mermaidContent);
      const diagramSignals = diagramHumanSignals(card, topic);
      if (mermaid) {
        if (!mermaid.validHeader) {
          deduct(4, `Mermaid 首行不是合法图类型声明：${card.title}`);
        }
        if (mermaid.nodeCount < 4) {
          deduct(4, `图示节点过少，难以解释机制：${card.title}`);
        }
        // 孤立节点只对 flowchart/stateDiagram 这类节点图判定，且语义是“定义了却没有任何连线引用”，
        // 不再把“先声明节点再连边”“多行标签”“时序图消息/subgraph”误判为孤立。
        if (mermaid.isNodeGraph && mermaid.isolatedNodes.length) {
          deduct(
            5,
            `Mermaid 图存在孤立节点（${mermaid.isolatedNodes.slice(0, 3).join("、")}），需先诊断引用错位、补边、重画或确认已有更好图承接，不能直接删除：${card.title}`,
          );
        }
        if (mermaid.duplicateEdge) {
          deduct(2, `Mermaid 存在完全重复的连线：${card.title}`);
        }
        if (topic.difficulty >= 3 && mermaid.edgeCount < 3) {
          deduct(3, `图示连线过少，难以表达真实关系：${card.title}`);
        }
      }
      if (labels.length) {
        const genericCount = labels.filter((label) => genericDiagramLabelPattern.test(label)).length;
        const genericRatio = genericCount / labels.length;
        if (genericRatio > 0.55 || (genericCount >= 3 && genericRatio > 0.4)) deduct(6, `图示节点过于通用：${card.title}`);
        const diagramText = labels.join(" ").toLowerCase();
        const tokens = relevanceTokens(topic);
        const matched = tokens.filter((token) => diagramText.includes(token.toLowerCase()));
        if (tokens.length >= 2 && matched.length === 0) {
          const fallbackText = `${card.fallback ?? ""}${card.caption ?? ""}`;
          const looksGenericDiagram = genericRatio > 0.25 || genericDiagramTitlePattern.test(card.title ?? "") || /关键环节|核心流程|输入 ->/.test(fallbackText);
          deduct(looksGenericDiagram ? 6 : 2, `图示与 topic 标题/标签缺少明显关联：${card.title}`);
        }
        if (diagramSignals.genericRatio <= 0.35 && diagramSignals.matchedTokens === 0 && topic.difficulty >= 3) {
          deduct(3, `图示虽然有节点，但与当前 topic 的专属术语贴合不足：${card.title}`);
        }
      }
      const fallbackText = `${card.fallback ?? ""}${card.caption ?? ""}`;
      if (textLength(fallbackText) >= 24 && labels.length >= 4) {
        const mentionedLabels = labels.filter((label) => fallbackText.includes(label)).length;
        if (mentionedLabels === 0 && diagramSignals.matchedTokens === 0) {
          deduct(3, `图示 fallback/caption 与节点对应不足：${card.title}`);
        }
      }
      if (machineRelationPhrasePattern.test(`${card.title ?? ""}${card.content ?? ""}${fallbackText}`)) {
        deduct(6, `图示存在机器拼接关系短语：${card.title}`);
      }
      if (labels.some((label) => diagramConclusionNodePattern.test(label.trim()))) {
        deduct(6, `图示以“面试结论/答题要点”类元节点收尾，是关键词直链假图，必须重画为机制图：${card.title}`);
        capScore(89, "diagram 收束到「面试结论」类元节点，是关键词直链假图");
      }
      if (/学习主线|知识全景|核心概念图|深入理解图|学习路线图/.test(card.title ?? "")) {
        deduct(5, `图示标题是 AI 脚手架式空泛标题（应写本图的具体考点，如“握手三步与状态迁移”）：${card.title}`);
      }
      if (
        mermaid &&
        (mermaid.type === "flowchart" || mermaid.type === "graph") &&
        topic.difficulty >= 4 &&
        mermaid.nodeCount >= 5 &&
        !hasMermaidBranch(mermaidContent) &&
        !/\|[^|]+\|/.test(card.content ?? "")
      ) {
        deduct(3, `高阶题图是无分支、无边标签的线性链，疑似关键词直链，建议补失败路径/分支或在连线上标注机制：${card.title}`);
      }
      if (
        mermaid &&
        spatialDiagramExpected(topic) &&
        !hasSvg &&
        (mermaid.type === "flowchart" || mermaid.type === "graph") &&
        mermaid.nodeCount >= 4 &&
        !hasMermaidBranch(mermaidContent) &&
        !/\|[^|]+\|/.test(card.content ?? "")
      ) {
        deduct(5, `空间/状态型 topic 仅用普通 Mermaid 流程链，难以表达真实数据结构或状态变化：${card.title}`);
        capScore(94, "空间/状态型图解缺少 SVG 或状态/数据结构表达，不能稳定达到 95+");
      }
      if (
        generatedDiagramTitlePattern.test(card.title ?? "") &&
        generatedDiagramCaptionPattern.test(card.caption ?? "") &&
        / -> /.test(card.fallback ?? "")
      ) {
        deduct(8, `图示疑似自动拼接，缺少真实机制关系：${card.title}`);
      }
      if (/输入 -> 状态维护 -> 边界处理 -> 输出答案|按「输入 -> 状态维护 -> 边界处理 -> 输出答案」复述/.test(fallbackText)) {
        deduct(8, `图示 fallback 是万能模板：${card.title}`);
      }
    }
  }

  const followUps = interviewCards.reduce((sum, card) => sum + (card.followUpQuestions?.length ?? 0), 0);
  if (followUps < 2) deduct(8, "面试追问少于 2 条");
  const interviewChars = interviewCards.reduce((sum, card) => sum + textLength(card.content), 0);
  if (interviewChars < 180) deduct(6, "面试回答过短");
  if (topic.difficulty >= 4 && interviewChars < 260) {
    deduct(4, "高阶 topic 面试回答展开不足");
    capScore(94, "高阶面试回答没有足够展开，难以达到优秀");
  }
  for (const card of interviewCards) {
    if (topic.interviewFrequency === "high" && !containsMarkdownList(card.content ?? "")) {
      deduct(5, "高频 topic 面试回答缺少 Markdown 列表层次");
    }
    if (!/结论|先|核心|最后|边界|补充/.test(card.content ?? "")) {
      deduct(4, "面试回答缺少结论/机制/边界层次");
    }
    for (const followUp of card.followUpQuestions ?? []) {
      if (genericFollowUpAnswerPattern.test(followUp.answer ?? "")) {
        deduct(8, `追问答案模板化：${followUp.question}`);
      }
      if (textLength(followUp.answer) < 28) {
        deduct(3, `追问答案过短：${followUp.question}`);
      }
      const followUpQuestion = followUp.question ?? "";
      const followUpHasDepthWord =
        /为什么|如何|怎么|如果|边界|问题|排查|取舍|失败|区别|影响|保证|什么|哪些|关系|作用|原理|流程|机制|场景|时机|代价|瓶颈|优化|架构|特性|工作|性能|应该|一定|导致|解决|验证|检测|避免|关闭/.test(
          followUpQuestion,
        );
      const followUpHasTopicTerm = matchedTokens(followUpQuestion, primaryTokens).length > 0 || /[A-Z][A-Za-z0-9+/#.-]{1,}/.test(followUpQuestion);
      if (topic.difficulty >= 3 && !followUpHasDepthWord && !followUpHasTopicTerm) {
        deduct(2, `追问不像真实深入追问：${followUp.question}`);
      }
    }
  }

  const recalls = topic.recallPrompts ?? [];
  if (recalls.length < 2) deduct(6, "recallPrompts 少于 2 条");
  if (topic.difficulty >= 3 && recalls.length < 3) deduct(4, "difficulty 3+ recallPrompts 少于 3 条");
  if (weakPromptPattern.test(recalls[0]?.prompt ?? "")) deduct(4, "第一条 recallPrompt 不够像真实面试题");
  for (const prompt of recalls) {
    if (textLength(prompt.prompt) < 18) deduct(2, `recallPrompt 过短：${prompt.prompt}`);
    if (prompt.difficulty && Math.abs(prompt.difficulty - topic.difficulty) > 2) {
      deduct(2, `recallPrompt 难度与 topic 偏离过大：${prompt.prompt}`);
    }
  }
  if (topic.difficulty >= 3 && !recalls.some((prompt) => /为什么|如何|怎么|如果|边界|排查|取舍|失败|区别|保证/.test(prompt.prompt ?? ""))) {
    deduct(3, "recallPrompts 缺少机制/边界/排查型问题");
    capScore(94, "回忆题没有把用户推向机制和边界，难以达到优秀");
  }
  // 自包含性：recall 考的内容必须在本 topic 正文里教过，否则用户学完仍答不出。
  let minRecallCoverage = 1;
  let lowCoverageRecalls = 0;
  for (const prompt of recalls) {
    const ratio = coverageRatio(prompt.prompt ?? "", cardProseLower);
    minRecallCoverage = Math.min(minRecallCoverage, ratio);
    if (ratio < 0.25) {
      lowCoverageRecalls += 1;
      if (lowCoverageRecalls <= 2) {
        deduct(2, `recallPrompt 考点未被正文覆盖（覆盖率 ${(ratio * 100).toFixed(0)}%），学完答不出：${(prompt.prompt ?? "").slice(0, 30)}`);
      }
    }
  }
  // 应用迁移：difficulty>=3 的练习必须有场景型问题，否则只能背诵不能灵活运用。
  const applicationText = [
    ...recalls.map((prompt) => prompt.prompt ?? ""),
    ...interviewCards.flatMap((card) => [
      card.content ?? "",
      ...(card.followUpQuestions ?? []).flatMap((followUp) => [followUp.question ?? "", followUp.answer ?? ""]),
    ]),
  ].join("\n");
  const hasScenarioQuestion = scenarioQuestionPattern.test(applicationText);
  if (topic.difficulty >= 3 && topic.domain !== "algorithm" && !hasScenarioQuestion) {
    deduct(3, "缺少场景迁移型问题（线上/故障/如何排查/怎么选型），练不出灵活运用");
    capScore(94, "没有场景化练习，达不到面试灵活运用的优秀档");
  }

  const rubric = topic.rubric ?? {};
  if ((rubric.mustHave ?? []).length < 3) deduct(5, "rubric.mustHave 不足");
  if ((rubric.goodToHave ?? []).length < 2) deduct(4, "rubric.goodToHave 不足");
  if ((rubric.commonMistakes ?? []).length < 2) deduct(4, "rubric.commonMistakes 不足");
  if (/\"适用边界\"|\"排查路径\"|\"工程取舍\"/.test(JSON.stringify(rubric.goodToHave ?? []))) {
    deduct(8, "rubric.goodToHave 过于泛化");
  }
  const rubricTemplateCount = ["mustHave", "goodToHave", "commonMistakes"].reduce(
    (sum, sectionName) => sum + (rubric[sectionName] ?? []).filter((item) => rubricTemplateItemPattern.test(item)).length,
    0,
  );
  if (rubricTemplateCount >= 2) {
    deduct(Math.min(10, rubricTemplateCount * 3), `rubric 模板化条目过多 ${rubricTemplateCount}`);
    capScore(94, "rubric 仍像生成模板，不能支撑 95+ 的真人体感");
  }
  // 可达性：mustHave 要求必须答出的点，正文里必须教过。
  let lowCoverageMustHave = 0;
  for (const item of rubric.mustHave ?? []) {
    if (coverageRatio(item, cardProseLower) < 0.3) {
      lowCoverageMustHave += 1;
      if (lowCoverageMustHave <= 2) {
        deduct(2, `rubric.mustHave 要求的点未被正文覆盖，学完达不到及格线：${item.slice(0, 30)}`);
      }
    }
  }
  for (const sectionName of ["mustHave", "goodToHave", "commonMistakes"]) {
    for (const item of rubric[sectionName] ?? []) {
      if (rubricTemplateItemPattern.test(item)) {
        deduct(sectionName === "mustHave" ? 4 : 3, `rubric.${sectionName} 是模板化合格话：${item}`);
      }
      if (machineRelationPhrasePattern.test(item)) {
        deduct(5, `rubric.${sectionName} 存在机器拼接关系短语：${item}`);
      }
      if (rubricCodePattern.test(item)) {
        deduct(6, `rubric.${sectionName} 内嵌代码片段，代码只该放 code 卡：${item.slice(0, 40)}`);
        capScore(89, "rubric 含代码片段（AI 生成器 bug），不能作为发布态评分标准");
      }
      if (genericRubricItemPattern.test(item.trim())) {
        deduct(sectionName === "mustHave" ? 5 : 4, `rubric.${sectionName} 条目过泛：${item}`);
      }
      if (textLength(item) < 6 && !isAcceptableShortRubricItem(item, topic)) {
        deduct(1, `rubric.${sectionName} 条目过短：${item}`);
      }
    }
  }

  if (explainCards.length && interviewCards.length) {
    const explainText = explainCards.map((card) => card.content ?? "").join("\n");
    const interviewText = interviewCards.map((card) => card.content ?? "").join("\n");
    if (jaccardSimilarity(explainText, interviewText) > 0.78) {
      deduct(5, "explain 与 interviewAnswer 内容过度重复");
    }
    if (tokenJaccard(explainText, interviewText) < 0.035) {
      deduct(3, "interviewAnswer 与 explain 几乎无词汇关联，讲与练脱节");
    }
  }
  if (skeletonExplainCards > 0) {
    capScore(92, `有 ${skeletonExplainCards} 张清单骨架式 explain，缺少成段机制讲解`);
  }
  explainPair: for (let i = 0; i < explainCards.length; i += 1) {
    for (let j = i + 1; j < explainCards.length; j += 1) {
      if (jaccardSimilarity(explainCards[i].content ?? "", explainCards[j].content ?? "") > 0.7) {
        deduct(5, `两张 explain 卡内容高度重复：${explainCards[i].title} / ${explainCards[j].title}`);
        break explainPair;
      }
    }
  }
  const followUpAnswers = interviewCards.flatMap((card) =>
    (card.followUpQuestions ?? []).map((followUp) => followUp.answer ?? ""),
  );
  followUpPair: for (let i = 0; i < followUpAnswers.length; i += 1) {
    for (let j = i + 1; j < followUpAnswers.length; j += 1) {
      if (jaccardSimilarity(followUpAnswers[i], followUpAnswers[j]) > 0.8) {
        deduct(3, "存在两条高度相似的追问答案");
        break followUpPair;
      }
    }
  }
  recallPair: for (let i = 0; i < recalls.length; i += 1) {
    for (let j = i + 1; j < recalls.length; j += 1) {
      if (jaccardSimilarity(recalls[i].prompt ?? "", recalls[j].prompt ?? "") > 0.8) {
        deduct(3, "存在两条高度相似的 recallPrompt");
        break recallPair;
      }
    }
  }

  const codeExpectedDomains = new Set(["go"]);
  if (codeExpectedDomains.has(topic.domain) && !hasCodeExample(topic)) {
    deduct(8, "语言机制 topic 缺少代码示例");
  }

  if (topic.domain === "algorithm" && !hasCodeExample(topic)) {
    deduct(8, "算法 topic 缺少可运行代码示例");
  }

  const highWeight = topic.interviewFrequency === "high" && topic.recommendWeight < 85;
  const lowWeight = topic.interviewFrequency === "low" && topic.recommendWeight > 75;
  if (highWeight) deduct(3, "高频 topic 权重低于 85");
  if (lowWeight) deduct(3, "低频 topic 权重高于 75");

  const strongDiagramCount = diagramCards.filter((card) => card.type === "diagram" && isStrongDiagramCard(card, topic)).length;
  const goodCompareCount = compareCards.filter(isGoodCompareCard).length;
  const rubricItems = ["mustHave", "goodToHave", "commonMistakes"].flatMap((key) => rubric[key] ?? []);
  const specificRubricItems = rubricItems.filter((item) => {
    if (genericRubricItemPattern.test(item.trim()) || rubricTemplateItemPattern.test(item)) return false;
    const tokenHits = matchedTokens(item, primaryTokens).length;
    return tokenHits > 0 || (textLength(item) >= 10 && mechanismSignalPattern.test(item));
  });
  const rubricSpecificRatio = rubricItems.length ? specificRubricItems.length / rubricItems.length : 0;
  const topicAlignmentRatio = primaryTokens.length ? primaryTokenMatches.length / primaryTokens.length : 1;

  const lexicon = corpus?.domainLexicon.get(topic.domain);
  let lexiconHits = 0;
  let crossLexiconHits = 0;
  if (lexicon) {
    const ownTags = new Set((topic.tags ?? []).map((tag) => String(tag).trim().toLowerCase()));
    const proseLower = cardProseText.toLowerCase();
    for (const token of lexicon) {
      if (proseLower.includes(token)) {
        lexiconHits += 1;
        if (!ownTags.has(token)) crossLexiconHits += 1;
      }
    }
  }
  if (lexicon && lexicon.size >= 12 && topic.difficulty >= 3) {
    if (lexiconHits === 0) {
      deduct(4, "卡片正文未命中任何本领域术语，疑似跑题或表面化讲解");
      capScore(92, "正文与领域术语完全脱节");
    } else if (lexiconHits === 1) {
      deduct(2, "卡片正文仅命中 1 个领域术语，领域纵深存疑");
    }
  }
  const factCount = countPattern(cardProseText, concreteFactPattern);
  if (topic.difficulty >= 4 && factCount === 0) {
    deduct(2, "高阶 topic 没有任何具体数字/复杂度/版本等事实锚点，专家深度存疑");
  }

  const excellentSignals = [];
  const idealExplainChars = Math.round(minExplainChars * (topic.difficulty >= 4 ? 1.22 : topic.difficulty >= 3 ? 1.16 : 1.08));
  if (explainChars >= idealExplainChars) excellentSignals.push("explain 深度超过最低线");
  if (concreteExamplePattern.test(cardProseText)) excellentSignals.push("有具体例子/场景");
  if (boundarySignalPattern.test(cardProseText)) excellentSignals.push("有边界/误区/风险");
  if (verificationSignalPattern.test(cardProseText) || topic.domain === "algorithm") excellentSignals.push("有验证/排查/复杂度证据");
  if (tradeoffSignalPattern.test(cardProseText)) excellentSignals.push("有取舍/成本/权衡");
  if (failureSignalPattern.test(cardProseText) || topic.domain === "algorithm") excellentSignals.push("有失败/异常路径");
  if (strongDiagramCount > 0) excellentSignals.push("图示能解释真实关系");
  if (goodCompareCount > 0) excellentSignals.push("对比表能支撑边界理解");
  if (followUps >= 3 || (followUps >= 2 && interviewChars >= 300)) excellentSignals.push("面试回答和追问较扎实");
  if (rubricSpecificRatio >= 0.72) excellentSignals.push("rubric 专属度较高");
  if (recalls.length >= 3 && recalls.some((prompt) => /为什么|如何|怎么|如果|边界|排查|取舍|失败|区别|保证/.test(prompt.prompt ?? ""))) {
    excellentSignals.push("回忆题能追到机制/边界");
  }
  if (topicAlignmentRatio >= 0.45 || primaryTokenMatches.length >= 6) excellentSignals.push("正文与 topic 专属词高度贴合");
  if (hasCodeExample(topic) && (topic.domain === "algorithm" || topic.domain === "go" || topic.difficulty >= 3)) {
    excellentSignals.push("有代码或伪代码锚点");
  }
  if (factCount >= 2) excellentSignals.push("有具体数字/复杂度/版本等事实锚点");
  if (crossLexiconHits >= 6) excellentSignals.push("领域术语网络覆盖广，能关联相邻知识");
  if (corpus && hardShared.length === 0 && scaffoldShared.length === 0 && repetition.ratio <= 0.05) {
    excellentSignals.push("语言为本知识点原创，无复制句");
  }
  if (recalls.length >= 2 && minRecallCoverage >= 0.45) {
    excellentSignals.push("回忆题考点全部能从正文学到（自包含）");
  }
  if (topic.difficulty <= 2 || topic.domain === "algorithm" || hasScenarioQuestion) {
    excellentSignals.push("练习包含场景迁移型问题");
  }
  const requiredForExcellent = topic.difficulty >= 4 ? 12 : topic.difficulty >= 3 ? 11 : 10;
  const requiredForStrong = Math.max(6, requiredForExcellent - 2);
  if (excellentSignals.length < requiredForStrong) {
    capScore(92, `正向质量证据不足 ${excellentSignals.length}/${requiredForStrong}，只能证明基本合格`);
  } else if (excellentSignals.length < requiredForExcellent) {
    capScore(95, `正向质量证据达到合格但不够惊艳 ${excellentSignals.length}/${requiredForExcellent}`);
  } else if (excellentSignals.length < requiredForExcellent + 2) {
    capScore(98, `99+ 需要几乎无短板的深度、例子、图示、追问和 rubric 证据 ${excellentSignals.length}/${requiredForExcellent + 2}`);
  }

  const hasMinutesInRange = topic.estimatedMinutes >= minMinutes && topic.estimatedMinutes <= maxMinutes;
  const hasCleanTitle = !broadTitlePattern.test(topic.title ?? "") && !cjkLatinSpacingPattern.test(topic.title ?? "");
  const hasGoodSummary = textLength(topic.summary) >= 22 && textLength(topic.summary) <= 120;
  const hasGoodFocus = textLength(topic.interviewerFocus) >= 28 && matchedTokens(topic.interviewerFocus ?? "", primaryTokens).length > 0;
  const hasRequiredCards = explainCards.length > 0 && interviewCards.length > 0 && checklistCards.length > 0;
  const hasExpectedExplainCount =
    topic.domain === "algorithm" ||
    (topic.difficulty >= 3 ? explainCards.length >= expectedExplainCards : explainCards.length === expectedExplainCards);

  const expertExplainChars = expertExplainTarget(topic.difficulty, topic.domain);
  const expertTotalChars = expertTotalTarget(topic.difficulty, topic.domain);
  const mechanismExplainRatio = explainCards.length
    ? explainCards.filter((card) => mechanismSignalPattern.test(card.content ?? "")).length / explainCards.length
    : 0;
  const hasLowDuplication = !(explainCards.length && interviewCards.length && jaccardSimilarity(
    explainCards.map((card) => card.content ?? "").join("\n"),
    interviewCards.map((card) => card.content ?? "").join("\n"),
  ) > 0.78);
  const topicAlignmentRatioForScore = primaryTokens.length ? primaryTokenMatches.length / primaryTokens.length : 1;
  const hasExample = concreteExamplePattern.test(cardProseText);
  const hasBoundary = boundarySignalPattern.test(cardProseText);
  const hasVerification = verificationSignalPattern.test(cardProseText) || topic.domain === "algorithm";
  const hasTradeoff = tradeoffSignalPattern.test(cardProseText) || topic.difficulty <= 2;
  const hasFailure = failureSignalPattern.test(cardProseText) || topic.domain === "algorithm" || topic.difficulty <= 2;
  const hasDomainEvidence = topicAlignmentRatioForScore >= 0.45 || primaryTokenMatches.length >= 6;
  const hasNaturalLanguage =
    !unnaturalLanguagePattern.test(allText) &&
    countPattern(cardProseText, proseFillerPattern) < Math.max(14, Math.floor(totalChars / 300));
  const hasInformativeTitles = (topic.learningCards ?? []).every((card) => {
    const title = (card.title ?? "").trim();
    return isAlgorithmProblemIntroCard(topic, card) || (!genericCardTitlePattern.test(title) && !genericCardTitleTextPattern.test(title));
  });
  const hasCardOrder = (() => {
    let previous = 0;
    for (const card of topic.learningCards ?? []) {
      const rank = cardOrderRank(card.type);
      if (rank < previous && !(card.type === "diagram" && previous === cardOrderRank("compareTable"))) return false;
      previous = Math.max(previous, rank);
    }
    return true;
  })();
  const hasSpecificChecklist = checklistCards.some((card) => (card.items ?? []).filter((item) => textLength(item) >= 10).length >= 3);
  const hasStrongDiagram = strongDiagramCount > 0;
  const hasGoodCompare = goodCompareCount > 0;
  const allDiagramsReadable = diagramCards.every((card) => cardHasTextualFallback(card));
  const interviewHasStructure = interviewCards.some((card) => /结论|先|核心|最后|边界|补充/.test(card.content ?? ""));
  const interviewHasDepth = interviewChars >= (topic.difficulty >= 4 ? 320 : topic.difficulty >= 3 ? 250 : 180);
  const followUpDepthCount = interviewCards.reduce(
    (sum, card) =>
      sum +
      (card.followUpQuestions ?? []).filter((followUp) => {
        const question = followUp.question ?? "";
        return (
          textLength(followUp.answer) >= 32 &&
          (/为什么|如何|怎么|如果|边界|问题|排查|取舍|失败|区别|影响|保证|什么|哪些|关系|作用|原理|流程|机制|场景|时机|代价|瓶颈|优化|架构|特性|工作|性能|应该|一定|导致|解决|验证|检测|避免|关闭/.test(question) ||
            matchedTokens(question, primaryTokens).length > 0)
        );
      }).length,
    0,
  );
  const recallDepthCount = recalls.filter((prompt) =>
    /为什么|如何|怎么|如果|边界|排查|取舍|失败|区别|保证|解释|说明|设计|定位|判断/.test(prompt.prompt ?? ""),
  ).length;
  const rubricCommon = rubric.commonMistakes ?? [];
  const commonMistakeSpecificRatio = rubricCommon.length
    ? rubricCommon.filter((item) => textLength(item) >= 10 && !genericRubricItemPattern.test(item.trim()) && !rubricTemplateItemPattern.test(item)).length /
      rubricCommon.length
    : 0;
  const templateHitCount = templatePatterns.filter(([pattern]) => pattern.test(allText)).length;
  const hasNoTemplatePollution =
    templateHitCount === 0 &&
    !algorithmTemplateLeakPattern.test(allText) &&
    !machineRelationPhrasePattern.test(allText) &&
    !generatedDiagramTitlePattern.test(allText);

  const dimensionScores = {
    structure:
      booleanScore((topic.status ?? "") === "production", 1.5) +
      booleanScore(hasCleanTitle, 1.5) +
      booleanScore(hasGoodSummary, 2) +
      booleanScore(hasGoodFocus, 2) +
      booleanScore(hasMinutesInRange, 1.5) +
      booleanScore(hasRequiredCards, 1.5),
    depth:
      scaledScore(explainChars, expertExplainChars, 7) +
      scaledScore(totalChars, expertTotalChars, 4) +
      booleanScore(hasExpectedExplainCount, 3) +
      scaledScore(mechanismExplainRatio, 1, 3) +
      booleanScore(hasLowDuplication, 2) +
      booleanScore(hasCodeExample(topic) || !new Set(["algorithm", "go"]).has(topic.domain), 1),
    expertise:
      scaledScore(topicAlignmentRatioForScore, 0.55, 4) +
      booleanScore(hasExample, 3) +
      booleanScore(hasBoundary, 3) +
      booleanScore(hasVerification, 3) +
      booleanScore(hasTradeoff, 3) +
      booleanScore(hasFailure, 2) +
      booleanScore(hasDomainEvidence, 2),
    clarity:
      booleanScore(hasNaturalLanguage, 3) +
      booleanScore(hasInformativeTitles, 2.5) +
      booleanScore(hasCardOrder, 2) +
      booleanScore(hasSpecificChecklist, 2) +
      booleanScore((topic.learningCards ?? []).length >= (topic.difficulty >= 3 ? 6 : 5), 1.5) +
      booleanScore(!containsMarkdownList(explainCards.map((card) => card.content ?? "").join("\n")) || topic.difficulty >= 3, 1),
    visual:
      booleanScore(hasStrongDiagram, 5) +
      booleanScore(hasGoodCompare, 3) +
      booleanScore(allDiagramsReadable && diagramCards.length > 0, 1) +
      booleanScore(diagramCards.length > 0 || compareCards.length > 0, 1),
    interview:
      booleanScore(interviewHasStructure, 2.5) +
      booleanScore(interviewHasDepth, 3) +
      scaledScore(followUpDepthCount, topic.difficulty >= 3 ? 2 : 1, 3) +
      scaledScore(recallDepthCount, topic.difficulty >= 3 ? 2 : 1, 2.5) +
      booleanScore(topic.interviewFrequency !== "high" || containsMarkdownList(interviewCards.map((card) => card.content ?? "").join("\n")), 1) +
      booleanScore(recalls.length >= (topic.difficulty >= 3 ? 3 : 2), 2),
    assessment:
      booleanScore((rubric.mustHave ?? []).length >= 3, 1.5) +
      booleanScore((rubric.goodToHave ?? []).length >= 2, 1.2) +
      booleanScore((rubric.commonMistakes ?? []).length >= 2, 1.2) +
      scaledScore(rubricSpecificRatio, 0.8, 3.1) +
      scaledScore(commonMistakeSpecificRatio, 0.9, 2) +
      booleanScore(Object.values(rubric.scoreWeights ?? {}).reduce((sum, value) => sum + value, 0) === 100, 1),
    hygiene:
      booleanScore(hasNoTemplatePollution, 1.5) +
      booleanScore(!corpus || hardShared.length === 0, 1.5) +
      booleanScore(!cjkLatinSpacingPattern.test(topic.title ?? ""), 0.4) +
      booleanScore(!genericHighlightPattern.test(allText), 0.3) +
      booleanScore(!generatedDiagramCaptionPattern.test(allText), 0.3),
  };

  const dimensionMax = {
    structure: 10,
    depth: 20,
    expertise: 20,
    clarity: 12,
    visual: 10,
    interview: 14,
    assessment: 10,
    hygiene: 4,
  };

  function noteDimension(name, label, minRatio) {
    const ratio = dimensionScores[name] / dimensionMax[name];
    if (ratio < minRatio) {
      issues.push(`${label}维度得分不足 ${dimensionScores[name].toFixed(1)}/${dimensionMax[name]}`);
    }
  }

  noteDimension("depth", "内容深度", 0.82);
  noteDimension("expertise", "专家证据", 0.82);
  noteDimension("visual", "图示/对比", 0.72);
  noteDimension("interview", "面试可用性", 0.78);
  noteDimension("assessment", "rubric 评估", 0.8);

  // 90+ 不允许任何核心维度存在明显短板：强维度不能补偿弱维度。
  const dimensionFloors = {
    structure: 0.6,
    depth: 0.55,
    expertise: 0.6,
    clarity: 0.6,
    visual: 0.45,
    interview: 0.6,
    assessment: 0.55,
    hygiene: 0.45,
  };
  const dimensionLabels = {
    structure: "结构完整性",
    depth: "内容深度",
    expertise: "专家证据",
    clarity: "讲解清晰度",
    visual: "图示/对比",
    interview: "面试可用性",
    assessment: "rubric 评估",
    hygiene: "模板与语言卫生",
  };
  for (const [name, floor] of Object.entries(dimensionFloors)) {
    const ratio = dimensionScores[name] / dimensionMax[name];
    if (ratio < floor) {
      capScore(
        89,
        `${dimensionLabels[name]}维度短板 ${dimensionScores[name].toFixed(1)}/${dimensionMax[name]}（低于 ${Math.round(floor * 100)}% 地板），强项不可补偿`,
      );
    }
  }

  const positiveScore = Object.values(dimensionScores).reduce((sum, value) => sum + value, 0);
  const legacyScore = Math.max(0, score);
  score = Math.min(positiveScore, legacyScore, scoreCap);

  if (score < minScore && positiveScore <= legacyScore && positiveScore <= scoreCap) {
    const gaps = Object.entries(dimensionScores)
      .map(([name, value]) => ({ name, value, gap: dimensionMax[name] - value }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3);
    issues.push(
      `正向证据不足是主因，最大缺口：${gaps.map((gap) => `${dimensionLabels[gap.name]} ${gap.value.toFixed(1)}/${dimensionMax[gap.name]}`).join("，")}`,
    );
  }

  return {
    ref,
    id: topic.id,
    domain: topic.domain,
    category: topic.category,
    title: topic.title,
    score: Math.max(0, Math.round(score)),
    grade: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "D",
    issueCount: issues.length,
    issues,
    metrics: {
      difficulty: topic.difficulty,
      explainCards: explainCards.length,
      explainChars,
      totalChars,
      diagrams: diagramCards.length,
      compareTables: compareCards.length,
      codeExamples: hasCodeExample(topic) ? 1 : 0,
      recalls: recalls.length,
      followUps,
      cardCount: topic.learningCards?.length ?? 0,
      excellentSignals: excellentSignals.length,
      scoreCap,
      legacyScore: Math.round(legacyScore),
      positiveScore: Number(positiveScore.toFixed(1)),
      strongDiagrams: strongDiagramCount,
      rubricSpecificRatio: Number(rubricSpecificRatio.toFixed(2)),
      topicAlignmentRatio: Number(topicAlignmentRatio.toFixed(2)),
      sharedTemplateSentences: hardShared.length,
      scaffoldSharedSentences: scaffoldShared.length,
      repetitionRatio: Number(repetition.ratio.toFixed(2)),
      lexiconHits,
      crossLexiconHits,
      factCount,
      minRecallCoverage: Number(minRecallCoverage.toFixed(2)),
      hasScenarioQuestion,
      skeletonExplainCards,
      dimensions: Object.fromEntries(
        Object.entries(dimensionScores).map(([key, value]) => [key, Number(value.toFixed(1))]),
      ),
    },
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const manifest = await readJson("manifest.json");
  const topicReports = [];
  const domainReports = [];
  const normalizedTitleMap = new Map();
  const orderIssues = [];
  const structuralIssues = [];

  // 第一遍：加载全部 topic 并做结构检查，同时为跨 topic 模板句和领域术语词典建立语料库。
  const loadedDomains = [];
  for (const domainEntry of manifest.domains) {
    if (!domainEntry.entry.startsWith("domains/")) {
      structuralIssues.push(`${domainEntry.id}: production manifest entry 应指向 domains/，实际为 ${domainEntry.entry}`);
    }
    const domain = await readJson(domainEntry.entry);
    const loadedTopics = [];
    let previousCategoryOrder = -Infinity;
    const seenCategoryOrders = new Map();

    for (const category of domain.categories) {
      if (category.order < previousCategoryOrder) {
        structuralIssues.push(`${domain.id}: category order 逆序 ${category.title}`);
      }
      if (seenCategoryOrders.has(category.order)) {
        structuralIssues.push(`${domain.id}: category order ${category.order} 重复 ${seenCategoryOrders.get(category.order)} / ${category.title}`);
      }
      seenCategoryOrders.set(category.order, category.title);
      previousCategoryOrder = category.order;

      let previousOrder = -Infinity;
      const seenOrders = new Map();
      for (const ref of category.topics) {
        if (!ref.startsWith(`topics/${domain.id}/`)) {
          structuralIssues.push(`${domain.id}/${category.id}: topic 路径与领域不一致 ${ref}`);
        }
        const topic = await readJson(ref);
        if (topic.domain !== domain.id) {
          structuralIssues.push(`${ref}: topic.domain=${topic.domain} 与 domain=${domain.id} 不一致`);
        }
        if (topic.category !== category.id) {
          structuralIssues.push(`${ref}: topic.category=${topic.category} 与 category=${category.id} 不一致`);
        }
        loadedTopics.push({ topic, ref });

        if (topic.order < previousOrder) {
          orderIssues.push(`${domain.id}/${category.id}: topic order 逆序 ${topic.title}`);
        }
        if (seenOrders.has(topic.order)) {
          orderIssues.push(`${domain.id}/${category.id}: order ${topic.order} 重复 ${seenOrders.get(topic.order)} / ${topic.title}`);
        }
        seenOrders.set(topic.order, topic.title);
        previousOrder = topic.order;
      }
    }

    if (domainEntry.topicCount !== loadedTopics.length) {
      structuralIssues.push(`${domain.id}: manifest topicCount=${domainEntry.topicCount}，实际引用=${loadedTopics.length}`);
    }
    loadedDomains.push({ domain, loadedTopics });
  }

  const corpus = buildCorpus(loadedDomains.flatMap((entry) => entry.loadedTopics));

  // 第二遍：带语料库上下文评分。
  for (const { domain, loadedTopics } of loadedDomains) {
    const domainTopicReports = [];
    for (const { topic, ref } of loadedTopics) {
      const report = scoreTopic(topic, ref, corpus);
      topicReports.push(report);
      domainTopicReports.push(report);

      const normalized = normalizeTitle(topic.title);
      const bucket = normalizedTitleMap.get(normalized) ?? [];
      bucket.push(report);
      normalizedTitleMap.set(normalized, bucket);
    }

    const domainScore = Math.round(average(domainTopicReports.map((item) => item.score)));
    domainReports.push({
      id: domain.id,
      title: domain.title,
      score: domainScore,
      grade: domainScore >= 90 ? "A" : domainScore >= 80 ? "B" : domainScore >= 70 ? "C" : "D",
      topicCount: domainTopicReports.length,
      minTopicScore: Math.min(...domainTopicReports.map((item) => item.score)),
      failingTopics: domainTopicReports.filter((item) => item.score < minScore).length,
    });
  }

  const duplicateTitleIssues = [];
  for (const reports of normalizedTitleMap.values()) {
    const domains = new Set(reports.map((item) => item.domain));
    if (reports.length > 1 && domains.size > 1) {
      duplicateTitleIssues.push(reports.map((item) => `${item.domain}:${item.title}`).join(" <=> "));
    }
  }

  const duplicateLanguageIssues = [];
  for (const [sentence, refs] of corpus.sentenceTopics.entries()) {
    if (refs.size >= 4) {
      const sample = [...refs].slice(0, 6).join(" | ");
      duplicateLanguageIssues.push(`${refs.size}x ${sentence} :: ${sample}${refs.size > 6 ? ` ... +${refs.size - 6}` : ""}`);
    }
  }
  duplicateLanguageIssues.sort((a, b) => Number(b.split("x")[0]) - Number(a.split("x")[0]));

  const overall = Math.round(average(topicReports.map((item) => item.score)));
  const failingTopics = topicReports.filter((item) => item.score < minScore);
  const failingDomains = domainReports.filter((item) => item.score < minScore || item.failingTopics > 0);
  const result = {
    threshold: minScore,
    overallScore: overall,
    overallGrade: overall >= 90 ? "A" : overall >= 80 ? "B" : overall >= 70 ? "C" : "D",
    topicCount: topicReports.length,
    failingTopicCount: failingTopics.length,
    failingDomainCount: failingDomains.length,
    orderIssues,
    structuralIssues,
    duplicateTitleIssues,
    duplicateLanguageIssues,
    domains: domainReports,
    // 跨域优先级地图（最差在前）：替代人工审计的“哪个域最烂、先动哪”。tier 仅按确定性分；门禁过(≥90)≠内容真达标，区分度/假图/模板腔需本地精修器判官把关。
    domainPriority: [...domainReports]
      .sort((a, b) => a.score - b.score || b.failingTopics - a.failingTopics)
      .map((d) => ({
        tier: d.score < 80 ? "P0" : d.score < minScore || d.failingTopics ? "P1" : "P2",
        id: d.id,
        score: d.score,
        grade: d.grade,
        failingTopics: d.failingTopics,
        minTopicScore: d.minTopicScore,
      })),
    allTopics: topicReports.map((item) => ({ score: item.score, grade: item.grade, domain: item.domain, title: item.title, ref: item.ref })),
    failingTopics: failingTopics
      .sort((a, b) => a.score - b.score || a.domain.localeCompare(b.domain))
      .map((item) => ({
        score: item.score,
        grade: item.grade,
        domain: item.domain,
        title: item.title,
        ref: item.ref,
        issues: item.issues,
        metrics: item.metrics,
      })),
  };

  if (formatJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Content quality audit: overall ${result.overallScore}/100 (${result.overallGrade}), topics=${result.topicCount}, failing=${result.failingTopicCount}`);
    if (showDistribution) {
      const buckets = new Map();
      for (const report of topicReports) {
        const bucket = report.score >= 95 ? "95+" : report.score >= 90 ? "90-94" : report.score >= 85 ? "85-89" : report.score >= 80 ? "80-84" : "<80";
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      }
      console.log("\nScore distribution:");
      for (const key of ["95+", "90-94", "85-89", "80-84", "<80"]) {
        console.log(`- ${key}: ${buckets.get(key) ?? 0}`);
      }
      const dimensionTotals = new Map();
      for (const report of topicReports) {
        for (const [name, value] of Object.entries(report.metrics.dimensions)) {
          const entry = dimensionTotals.get(name) ?? { sum: 0, min: Infinity };
          entry.sum += value;
          entry.min = Math.min(entry.min, value);
          dimensionTotals.set(name, entry);
        }
      }
      console.log("\nDimension averages (avg/min):");
      for (const [name, entry] of dimensionTotals.entries()) {
        console.log(`- ${name}: ${(entry.sum / topicReports.length).toFixed(1)} / ${entry.min.toFixed(1)}`);
      }
    }
    console.log("\nDomain priority (worst first — 先修这些):");
    for (const domain of result.domainPriority) {
      console.log(
        `- [${domain.tier}] ${domain.id}: ${domain.score}/100 (${domain.grade}), 跌破 ${minScore} ${domain.failingTopics} 篇, 最低 ${domain.minTopicScore}`,
      );
    }
    console.log("注：门禁过(≥90)≠内容真达标——区分度不足、关键词直链假图、模板腔需本地精修器(quality:refine)判官把关。");
    if (orderIssues.length) {
      console.log("\nOrder issues:");
      for (const issue of orderIssues) console.log(`- ${issue}`);
    }
    if (structuralIssues.length) {
      console.log("\nStructural quality issues:");
      for (const issue of structuralIssues) console.log(`- ${issue}`);
    }
    if (duplicateTitleIssues.length) {
      console.log("\nDuplicate cross-domain titles:");
      for (const issue of duplicateTitleIssues) console.log(`- ${issue}`);
    }
    if (duplicateLanguageIssues.length) {
      console.log("\nDuplicate natural-language templates:");
      for (const issue of duplicateLanguageIssues.slice(0, 40)) console.log(`- ${issue}`);
      if (duplicateLanguageIssues.length > 40) console.log(`... ${duplicateLanguageIssues.length - 40} more`);
    }
    if (failingTopics.length) {
      console.log("\nLowest failing topics:");
      for (const item of result.failingTopics.slice(0, 80)) {
        console.log(`- ${item.score}/100 ${item.domain} ${item.title} (${item.ref})`);
        for (const issue of item.issues.slice(0, 6)) console.log(`  * ${issue}`);
      }
      if (result.failingTopics.length > 80) {
        console.log(`... ${result.failingTopics.length - 80} more`);
      }
    }
  }

  if (
    overall < minScore ||
    failingTopics.length ||
    failingDomains.length ||
    orderIssues.length ||
    structuralIssues.length ||
    duplicateTitleIssues.length ||
    duplicateLanguageIssues.length
  ) {
    process.exitCode = 1;
  }
}

// 导出供精修器在进程内做单篇/keep-best 评分复用（CLI 行为不变，仅在直接运行时才跑 main）。
export { scoreTopic, buildCorpus };

const isCliEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCliEntry) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
