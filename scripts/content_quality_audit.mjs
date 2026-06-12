import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const minScoreArg = process.argv.find((arg) => arg.startsWith("--min-score="));
const minScore = minScoreArg ? Number(minScoreArg.split("=")[1]) : 90;
const formatJson = process.argv.includes("--json");

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

function extractMermaidLabels(content = "") {
  const source = String(content).replace(/\\n/g, "\n");
  const labels = [];
  for (const match of source.matchAll(/\[([^\]]+)\]/g)) {
    labels.push(match[1].trim());
  }
  for (const match of source.matchAll(/\{([^}]+)\}/g)) {
    labels.push(match[1].trim());
  }
  return labels;
}

function mermaidStatements(content = "") {
  let source = String(content).replace(/\\n/g, "\n").trim();
  if (source.startsWith("```")) {
    const lines = source.split("\n");
    lines.shift();
    if (lines[lines.length - 1]?.trim() === "```") lines.pop();
    source = lines.join("\n").trim();
  }
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"))
    .flatMap((line) => line.split(";"))
    .map((line) => line.trim())
    .filter(Boolean);
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

function mermaidEdgeCount(content = "") {
  const statements = mermaidStatements(content);
  return statements.slice(1).filter((statement) => mermaidEdgePattern.test(statement)).length;
}

function hasMermaidBranch(content = "") {
  return /--\s*(?:是|否|yes|no|成功|失败|命中|未命中|允许|拒绝|通过|不通过|异常|正常)\s*--?>|\{[^}]+\}/i.test(content);
}

function diagramHumanSignals(card, topic) {
  const labels = extractMermaidLabels(card.content ?? "");
  const edgeCount = mermaidEdgeCount(card.content ?? "");
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
    hasBranch: hasMermaidBranch(card.content ?? ""),
    hasReadableFallback: textLength(fallbackText) >= 24,
    isStrong:
      labels.length >= 4 &&
      edgeCount >= 3 &&
      matched.length >= Math.min(2, Math.max(1, tokens.length)) &&
      genericCount / Math.max(1, labels.length) <= 0.35 &&
      textLength(fallbackText) >= 24,
  };
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
const duplicateSentencePattern =
  /从零理解可以抓住这条主线|深入理解时重点看三个问题|它不是一串名词，而是在说明请求、数据或控制权怎样穿过关键组件|把这几层连起来看，才能在遇到容量、故障或安全问题时判断瓶颈落在哪里|补充边界：如果问题落到生产场景，还要说明可观测信号、失败处理和与相邻方案的差异|到了 .+ 的高阶追问|继续往下看，.+不能只记结论/;
const algorithmTemplateLeakPattern =
  /要先说明题目约束，再给出核心解法和复杂度|先复述输入、输出和限制条件|空输入、重复值、指针越界或状态初始化|给出时间、空间复杂度/;
const machineRelationPhrasePattern = /能否说清|的定义和核心目标|如何影响[^，。；\n]{2,60}/;
const repeatedNaturalnessPattern =
  /补充边界：如果问题落到生产场景|可以先按.+理解整体链路|进一步看，.+要把|先判断触发条件，再说明状态如何变化|这样才能从现象回到机制/;
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
const mermaidEdgePattern = /(.+?)\s*(-->|---|==>|-\.->)\s*(.+)|(.+?)\s*--\s*([^>-]+?)\s*--?>\s*(.+)/;
const isolatedMermaidNodePattern = /^\s*[A-Za-z][A-Za-z0-9_]*\[[^\]]+\]\s*$/;
const shortRubricAllowPattern =
  /^(BFS|DFS|DP|LRU|LFU|AQS|CAS|MVCC|JWT|TLS|SSL|TCP|UDP|HTTP|HTTPS|DNS|CDN|GC|JVM|JIT|BFC|GMP|MCP|RAG|ETL|CDC|OLAP|OLTP|DDL|DML|SQL|NoSQL|ACID|CAP|BASE|CI\/CD|IaC|SRE|DDD|CQRS|Pod|K8s|Go|MySQL|Redis|MongoDB|Kafka|Spark|Flink|Hive|路径|状态|队列|栈|堆|锁|事务|索引|缓存|分片|分区|副本|主键|外键|快照|回溯|剪枝|哈希|递归|指针|滑窗|窗口|协议|证书|权限|认证|授权)$/i;

function isAcceptableShortRubricItem(item, topic) {
  const clean = item.trim();
  if (shortRubricAllowPattern.test(clean)) return true;
  if (/^[A-Z][A-Z0-9/+.-]{1,}$/.test(clean)) return true;
  if (clean.length >= 2 && topic.title.includes(clean)) return true;
  if ((topic.tags ?? []).some((tag) => tag.includes(clean))) return true;
  return false;
}

function expectedMinutesRange(difficulty) {
  if (difficulty <= 1) return [8, 20];
  if (difficulty === 2) return [12, 30];
  if (difficulty === 3) return [20, 40];
  if (difficulty === 4) return [28, 50];
  return [35, 65];
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

function collectDuplicateSentences(topic) {
  const sentences = [];
  const text = `${topic.summary ?? ""}\n${(topic.learningCards ?? []).map(cardText).join("\n")}`;
  for (const sentence of text.split(/[。！？!?]\s*/)) {
    const clean = sentence.trim();
    if (
      textLength(clean) >= 24 &&
      (duplicateSentencePattern.test(clean) || (textLength(clean) >= 38 && repeatedNaturalnessPattern.test(clean)))
    ) {
      sentences.push(clean);
    }
  }
  return sentences;
}

function scoreTopic(topic, ref) {
  const issues = [];
  let score = 100;
  let scoreCap = 100;
  const counts = cardCounts(topic);
  const explainCards = (topic.learningCards ?? []).filter((card) => card.type === "explain");
  const interviewCards = (topic.learningCards ?? []).filter((card) => card.type === "interviewAnswer");
  const diagramCards = (topic.learningCards ?? []).filter((card) => card.type === "diagram" || card.type === "animation");
  const compareCards = (topic.learningCards ?? []).filter((card) => card.type === "compareTable");
  const checklistCards = (topic.learningCards ?? []).filter((card) => card.type === "checklist");
  const explainChars = explainCards.reduce((sum, card) => sum + textLength(card.content), 0);
  const totalChars = (topic.learningCards ?? []).reduce((sum, card) => sum + textLength(cardText(card)), 0);
  const allText = collectTopicText(topic);
  const readableText = collectReadableTopicText(topic);
  const primaryTokens = primaryRelevanceTokens(topic);
  const primaryTokenMatches = matchedTokens(readableText, primaryTokens);

  function deduct(points, issue) {
    score -= points;
    issues.push(issue);
  }

  function capScore(maxScore, issue) {
    if (maxScore < scoreCap) scoreCap = maxScore;
    issues.push(`最高 ${maxScore} 分：${issue}`);
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

  for (const [pattern, label] of templatePatterns) {
    if (pattern.test(allText)) deduct(12, label);
  }
  if (unnaturalLanguagePattern.test(allText)) deduct(8, "语言自然度不足，存在拼接感或占位句");
  if (topic.domain !== "algorithm" && algorithmTemplateLeakPattern.test(allText)) {
    deduct(10, "非算法 topic 混入算法题回答模板");
  }
  if (primaryTokens.length >= 3 && primaryTokenMatches.length < Math.min(3, primaryTokens.length)) {
    deduct(5, `正文与标题/标签的专属词呼应不足 ${primaryTokenMatches.length}/${Math.min(3, primaryTokens.length)}`);
  }
  if (!concreteExamplePattern.test(readableText)) {
    deduct(4, "缺少具体例子或场景，读者难以落地理解");
    capScore(92, "没有具体例子/场景支撑，只能算结构合格");
  }
  if (!boundarySignalPattern.test(readableText)) {
    deduct(5, "缺少边界、风险或常见误区");
    capScore(92, "没有边界和误区，难以达到高质量知识");
  }
  if (topic.difficulty >= 3 && !verificationSignalPattern.test(readableText) && topic.domain !== "algorithm") {
    deduct(4, "中高难度 topic 缺少验证、排查或可观测证据");
    capScore(94, "缺少验证/排查证据，高分需要能落到真实问题");
  }
  if (topic.difficulty >= 4 && !tradeoffSignalPattern.test(readableText)) {
    deduct(4, "高阶 topic 缺少取舍、成本或权衡");
    capScore(93, "高阶内容没有权衡分析，只能算讲清概念");
  }
  if (topic.difficulty >= 4 && !failureSignalPattern.test(readableText) && topic.domain !== "algorithm") {
    deduct(4, "高阶 topic 缺少失败模式或风险路径");
    capScore(94, "高阶内容没有失败路径，体感深度不足");
  }
  const fillerCount = countPattern(readableText, proseFillerPattern);
  if (fillerCount >= 14 && fillerCount > Math.max(8, Math.floor(totalChars / 360))) {
    deduct(4, `连接词/套话密度偏高，语言有拼接感 ${fillerCount}`);
  }

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
    if (card.type === "explain") {
      const content = card.content ?? "";
      const hasMechanismSignal = mechanismSignalPattern.test(content);
      if (!isAlgorithmProblemIntroCard(topic, card) && !hasMechanismSignal) deduct(5, `explain 缺少机制/边界信号：${card.title}`);
      if (/请回答|复述|评分|面试官|追问/.test(content)) {
        deduct(6, `explain 混入面试训练或评分指令：${card.title}`);
      }
    }
    if (card.type === "compareTable" && Array.isArray(card.columns) && Array.isArray(card.rows)) {
      if (card.rows.length < 3) deduct(3, `compareTable 行数不足：${card.title}`);
      for (const row of card.rows) {
        if (row.length !== card.columns.length) {
          deduct(5, `compareTable 列数不一致：${card.title}`);
          break;
        }
      }
    }
    if (card.type === "code") {
      if (!card.language) deduct(5, `code 卡缺少 language：${card.title}`);
      if (textLength(card.content) < 60) deduct(4, `code 示例过短：${card.title}`);
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
    if (!card.fallback && !card.caption) deduct(3, `图示缺少 fallback/caption：${card.title}`);
    if ((card.title ?? "").endsWith("流程图") && /的关键环节/.test(card.caption ?? "")) {
      deduct(4, `图示标题或图注模板化：${card.title}`);
    }
    if (card.type === "diagram") {
      const labels = extractMermaidLabels(card.content ?? "");
      const diagramSignals = diagramHumanSignals(card, topic);
      if ((card.format ?? "") === "mermaid" && labels.length < 4) {
        deduct(4, `图示节点过少，难以解释机制：${card.title}`);
      }
      if ((card.format ?? "") === "mermaid") {
        const statements = mermaidStatements(card.content ?? "");
        for (const statement of statements.slice(1)) {
          if (isolatedMermaidNodePattern.test(statement) || !mermaidEdgePattern.test(statement)) {
            deduct(5, `Mermaid 图存在孤立节点或非连线语句，需先诊断引用错位、补边、重画或确认已有更好图承接，不能直接删除：${card.title}`);
            break;
          }
        }
        if (topic.difficulty >= 3 && diagramSignals.edgeCount < 3) {
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
  for (const sectionName of ["mustHave", "goodToHave", "commonMistakes"]) {
    for (const item of rubric[sectionName] ?? []) {
      if (rubricTemplateItemPattern.test(item)) {
        deduct(sectionName === "mustHave" ? 4 : 3, `rubric.${sectionName} 是模板化合格话：${item}`);
      }
      if (machineRelationPhrasePattern.test(item)) {
        deduct(5, `rubric.${sectionName} 存在机器拼接关系短语：${item}`);
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

  const strongDiagramCount = diagramCards.filter((card) => card.type === "diagram" && diagramHumanSignals(card, topic).isStrong).length;
  const goodCompareCount = compareCards.filter(
    (card) => Array.isArray(card.columns) && card.columns.length >= 3 && Array.isArray(card.rows) && card.rows.length >= 3,
  ).length;
  const rubricItems = ["mustHave", "goodToHave", "commonMistakes"].flatMap((key) => rubric[key] ?? []);
  const specificRubricItems = rubricItems.filter((item) => {
    if (genericRubricItemPattern.test(item.trim()) || rubricTemplateItemPattern.test(item)) return false;
    const tokenHits = matchedTokens(item, primaryTokens).length;
    return tokenHits > 0 || (textLength(item) >= 10 && mechanismSignalPattern.test(item));
  });
  const rubricSpecificRatio = rubricItems.length ? specificRubricItems.length / rubricItems.length : 0;
  const topicAlignmentRatio = primaryTokens.length ? primaryTokenMatches.length / primaryTokens.length : 1;
  const excellentSignals = [];
  const idealExplainChars = Math.round(minExplainChars * (topic.difficulty >= 4 ? 1.22 : topic.difficulty >= 3 ? 1.16 : 1.08));
  if (explainChars >= idealExplainChars) excellentSignals.push("explain 深度超过最低线");
  if (concreteExamplePattern.test(readableText)) excellentSignals.push("有具体例子/场景");
  if (boundarySignalPattern.test(readableText)) excellentSignals.push("有边界/误区/风险");
  if (verificationSignalPattern.test(readableText) || topic.domain === "algorithm") excellentSignals.push("有验证/排查/复杂度证据");
  if (tradeoffSignalPattern.test(readableText)) excellentSignals.push("有取舍/成本/权衡");
  if (failureSignalPattern.test(readableText) || topic.domain === "algorithm") excellentSignals.push("有失败/异常路径");
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
  const requiredForExcellent = topic.difficulty >= 4 ? 9 : topic.difficulty >= 3 ? 8 : 7;
  const requiredForStrong = Math.max(5, requiredForExcellent - 2);
  if (excellentSignals.length < requiredForStrong) {
    capScore(92, `正向质量证据不足 ${excellentSignals.length}/${requiredForStrong}，只能证明基本合格`);
  } else if (excellentSignals.length < requiredForExcellent) {
    capScore(95, `正向质量证据达到合格但不够惊艳 ${excellentSignals.length}/${requiredForExcellent}`);
  } else if (excellentSignals.length < requiredForExcellent + 2) {
    capScore(98, `99+ 需要几乎无短板的深度、例子、图示、追问和 rubric 证据 ${excellentSignals.length}/${requiredForExcellent + 2}`);
  }
  score = Math.min(score, scoreCap);

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
      strongDiagrams: strongDiagramCount,
      rubricSpecificRatio: Number(rubricSpecificRatio.toFixed(2)),
      topicAlignmentRatio: Number(topicAlignmentRatio.toFixed(2)),
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
  const duplicateSentenceMap = new Map();

  for (const domainEntry of manifest.domains) {
    if (!domainEntry.entry.startsWith("domains/")) {
      structuralIssues.push(`${domainEntry.id}: production manifest entry 应指向 domains/，实际为 ${domainEntry.entry}`);
    }
    const domain = await readJson(domainEntry.entry);
    const domainTopicReports = [];
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
        const report = scoreTopic(topic, ref);
        topicReports.push(report);
        domainTopicReports.push(report);
        for (const sentence of collectDuplicateSentences(topic)) {
          const entries = duplicateSentenceMap.get(sentence) ?? [];
          entries.push(`${topic.domain}:${topic.title}`);
          duplicateSentenceMap.set(sentence, entries);
        }

        const normalized = normalizeTitle(topic.title);
        const bucket = normalizedTitleMap.get(normalized) ?? [];
        bucket.push(report);
        normalizedTitleMap.set(normalized, bucket);

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

    if (domainEntry.topicCount !== domainTopicReports.length) {
      structuralIssues.push(`${domain.id}: manifest topicCount=${domainEntry.topicCount}，实际引用=${domainTopicReports.length}`);
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
  for (const [sentence, entries] of duplicateSentenceMap.entries()) {
    const uniqueEntries = [...new Set(entries)];
    if (uniqueEntries.length >= 4) {
      duplicateLanguageIssues.push(`${sentence} :: ${uniqueEntries.slice(0, 8).join(" | ")}${uniqueEntries.length > 8 ? ` ... +${uniqueEntries.length - 8}` : ""}`);
    }
  }

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
    console.log("\nDomains:");
    for (const domain of domainReports) {
      console.log(`- ${domain.id}: ${domain.score}/100 (${domain.grade}), minTopic=${domain.minTopicScore}, failingTopics=${domain.failingTopics}`);
    }
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
