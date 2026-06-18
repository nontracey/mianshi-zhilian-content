import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();
const forbidden = /(第\s*\d+[a-zA-Z]?\s*天|第\s*\d+[a-zA-Z]?\s*阶段|Day\s*\d+|今日练习与总结)/i;
const boxDrawing = /[┌┐└┘├┤┬┴┼│─═╔╗╚╝╠╣╦╩╬]/;

// 图解卡资源/占位/mermaid 语法检查
// 背景：图解卡渲染优先级 mermaid > asset(SVG) > SmartDiagram(items)。
// 历史问题：asset 指向不存在的 SVG → App 只显示 fallback；fallback 又是"建议用…"
// 占位文字；以及 mermaid 用了 App 轻量解析器不支持的语法被静默丢弃。下面三条把这些挡住。
const placeholderText = /建议(用|改用|使用)/; // fallback/content 不得是"建议用…"占位
const mermaidLabeledDotted = /-\.\s*\S[^\n]*?\.-+>/; // 带标签虚线边 -.标签.-> ，App 不支持
const mermaidUnsupportedKeyword =
  /^(classDiagram|gantt|pie|journey|erDiagram|mindmap)\b/i;
const mermaidLabeledEdge = /(.+?)\s*--\s*([^>-]+?)\s*--?>\s*(.+)/;
const mermaidPlainEdge = /(.+?)\s*(-\.->|==>|-->|---)\s*(.+)/;
const allowedSourceKinds = new Set(["svg", "mermaid", "text"]);

function isMermaidCard(card) {
  if ((card.format || "").toLowerCase() === "mermaid") return true;
  const first =
    (card.content || "")
      .replace(/\\n/g, "\n")
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l) || "";
  return /^(?:(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)|stateDiagram(?:-v2)?|sequenceDiagram)\b/i.test(first);
}

function normalizeCardSources(card) {
  const sources = Array.isArray(card.sources) ? [...card.sources] : [];
  if (!sources.length) {
    if (card.asset) sources.push({ kind: inferSourceKind(card.asset), path: card.asset });
    if (card.svgPath) sources.push({ kind: "svg", path: card.svgPath });
    if (card.svg) sources.push({ kind: "svg", content: card.svg });
    if ((card.format ?? "") === "mermaid" && card.content) sources.push({ kind: "mermaid", content: card.content });
  }
  return sources;
}

function inferSourceKind(file) {
  const ext = String(file).split(".").pop()?.toLowerCase();
  if (ext === "svg") return "svg";
  return "svg"; // 所有非 svg 图片资源统一为 svg kind
}

function mermaidStatements(source) {
  const out = [];
  let buffer = "";
  let square = 0;
  let curly = 0;
  let paren = 0;
  let pipe = 0;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%")) continue;
    buffer = buffer ? `${buffer} ${line}` : line;
    for (const ch of raw) {
      if (ch === "[") square += 1;
      else if (ch === "]") square = Math.max(0, square - 1);
      else if (ch === "{") curly += 1;
      else if (ch === "}") curly = Math.max(0, curly - 1);
      else if (ch === "(") paren += 1;
      else if (ch === ")") paren = Math.max(0, paren - 1);
      else if (ch === "|") pipe = 1 - pipe;
    }
    if (square === 0 && curly === 0 && paren === 0 && pipe === 0) {
      out.push(buffer);
      buffer = "";
    }
  }
  if (buffer) out.push(buffer);
  return out.map((entry) => entry.trim()).filter(Boolean);
}

function assertSources(file, card) {
  for (const [index, source] of normalizeCardSources(card).entries()) {
    if (!allowedSourceKinds.has(source.kind)) {
      throw new Error(`${file} ${card.type} 卡 "${card.title}" sources[${index}].kind 非法：${source.kind}`);
    }
    const hasPath = typeof source.path === "string" && source.path.trim().length > 0;
    const hasContent = typeof source.content === "string" && source.content.trim().length > 0;
    if (hasPath === hasContent) {
      throw new Error(`${file} ${card.type} 卡 "${card.title}" sources[${index}] 必须且只能提供 path 或 content`);
    }
    if (hasPath) {
      if (path.isAbsolute(source.path) || source.path.includes("..") || /(^|\/)\.[^/]/.test(source.path)) {
        throw new Error(`${file} ${card.type} 卡 "${card.title}" sources[${index}].path 越界：${source.path}`);
      }
      if (!source.path.startsWith("assets/")) {
        throw new Error(`${file} ${card.type} 卡 "${card.title}" sources[${index}].path 必须位于 assets/：${source.path}`);
      }
    }
  }
}

// 校验单张 diagram 卡：资源存在性、占位文字、mermaid 语法（与 App 解析器对齐）。
function assertDiagramCard(file, card) {
  assertSources(file, card);
  const sources = normalizeCardSources(card);
  const mermaidSource = sources.find((source) => source.kind === "mermaid" && typeof source.content === "string");
  const mermaid = Boolean(mermaidSource) || isMermaidCard(card);

  // 1) 旧字段引用的图片资源必须存在；sources 中的图片允许作为 backlog 路径，由渲染端降级到后续 source。
  const asset = card.svgPath || card.asset;
  if (asset && !mermaid && !card.svg) {
    if (!existsSync(path.join(root, asset))) {
      throw new Error(
        `${file} 图解卡 "${card.title}" 引用了不存在的资源 ${asset}（请补资源，或改用 format:"mermaid" 流程图）`,
      );
    }
  }

  // 2) fallback/content 不能是"建议用…"占位文字，必须是真实的文本形流程/结构
  for (const field of ["fallback", "content"]) {
    const v = card[field];
    if (typeof v === "string" && placeholderText.test(v)) {
      throw new Error(
        `${file} 图解卡 "${card.title}" 的 ${field} 是占位文字（"${v.slice(0, 30)}…"），请写真实的文本形流程/结构`,
      );
    }
  }

  // 3) mermaid 必须属于已约定的可渲染子集。
  if (mermaid) {
    let src = (mermaidSource?.content || card.content || "").replace(/\\n/g, "\n").trim();
    if (src.startsWith("```")) {
      const lines = src.split("\n");
      lines.shift();
      if (lines[lines.length - 1]?.trim() === "```") lines.pop();
      src = lines.join("\n").trim();
    }
    const statements = mermaidStatements(src);
    if (
      !statements.length ||
      !/^(?:(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)|stateDiagram(?:-v2)?|sequenceDiagram)\b/i.test(statements[0])
    ) {
      throw new Error(
        `${file} mermaid 卡 "${card.title}" 缺少合法图类型头（flowchart/graph + 方向、stateDiagram 或 sequenceDiagram）`,
      );
    }
    let edges = 0;
    const isSimpleFlowchart = /^(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)\b/i.test(statements[0]);
    for (const st of statements.slice(1)) {
      if (mermaidUnsupportedKeyword.test(st)) {
        throw new Error(
          `${file} mermaid 卡 "${card.title}" 含不支持的图种语法 "${st}"`,
        );
      }
      if (mermaidLabeledDotted.test(st)) {
        throw new Error(
          `${file} mermaid 卡 "${card.title}" 含带标签虚线边 "${st}"（App 不支持，边会丢失；请改用 A -->|标签| B）`,
        );
      }
      if (mermaidLabeledEdge.test(st) || mermaidPlainEdge.test(st)) {
        edges++;
      }
    }
    if (isSimpleFlowchart && edges === 0 && statements.length <= 1) {
      throw new Error(`${file} mermaid 卡 "${card.title}" 没有可渲染的边`);
    }
  }
}

// 语义质量检查（P0/P1 整改完成后加入，防止模板化问题回流）
const semanticChecks = [
  { pattern: /今日笔记/, level: "fail", label: "今日笔记模板残留" },
  { pattern: /面试话术/, level: "fail", label: "面试话术标签残留" },
  { pattern: /在实际项目中使用.*你遇到过什么问题/, level: "fail", label: "泛化项目追问" },
  { pattern: /在实际项目中是怎么用的.*有什么注意事项/, level: "fail", label: "泛化复述提问" },
  { pattern: /结合项目经验|能做对比|能说明取舍/, level: "fail", label: "泛化 rubric 评价" },
  { pattern: /面试表达清晰有条理.*能回答追问/, level: "fail", label: "泛化 rubric 表达" },
  { pattern: /回答时要先给出机制结论/, level: "fail", label: "占位式追问答案" },
  { pattern: /在现代前端框架（React\/Vue）中的应用和注意事项是什么/, level: "fail", label: "前端通用追问模板" },
];

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

async function listJson(dir) {
  const full = path.join(root, dir);
  const entries = await readdir(full, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listJson(child)));
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(child);
  }
  return files;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const manifestSchema = await readJson("schemas/manifest.schema.json");
const domainSchema = await readJson("schemas/domain.schema.json");
const topicSchema = await readJson("schemas/topic.schema.json");
const validateManifest = ajv.compile(manifestSchema);
const validateDomain = ajv.compile(domainSchema);
const validateTopic = ajv.compile(topicSchema);

function assertValid(name, validate, data) {
  if (!validate(data)) {
    throw new Error(`${name} failed schema validation:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
}

function assertTopicQuality(file, topic, domainIds, categoryIds, expectedStatus) {
  assertValid(file, validateTopic, topic);
  if (forbidden.test(topic.title) || forbidden.test(topic.summary)) {
    throw new Error(`${file} contains schedule wording in title or summary.`);
  }
  if (!domainIds.has(topic.domain)) throw new Error(`${file} references unknown domain ${topic.domain}`);
  if (!categoryIds.get(topic.domain)?.has(topic.category)) {
    throw new Error(`${file} references unknown category ${topic.domain}/${topic.category}`);
  }
  if (!topic.learningCards.some((card) => card.type === "explain")) {
    throw new Error(`${file} must include an explain learning card.`);
  }
  if (!topic.learningCards.some((card) => card.type === "interviewAnswer")) {
    throw new Error(`${file} must include an interviewAnswer learning card.`);
  }
  if (!topic.learningCards.some((card) => card.type === "checklist")) {
    throw new Error(`${file} must include a checklist learning card.`);
  }
  if (!topic.status) {
    throw new Error(`${file} must include status.`);
  }
  if (topic.status !== expectedStatus) {
    throw new Error(`${file} status must be ${expectedStatus} for this manifest, got ${topic.status}.`);
  }
  if (!topic.interviewerFocus?.trim()) {
    throw new Error(`${file} must include interviewerFocus.`);
  }
  if (!topic.learningCards.some((card) => card.type === "interviewAnswer" && Array.isArray(card.followUpQuestions) && card.followUpQuestions.length > 0)) {
    throw new Error(`${file} must include interviewAnswer.followUpQuestions.`);
  }
  if (!topic.learningCards.some((card) => ["compareTable", "diagram", "code"].includes(card.type))) {
    throw new Error(`${file} must include at least one deeper visual, comparison, or code card.`);
  }
  for (const card of topic.learningCards) {
    // 允许 explain 和 diagram 卡片包含 ASCII 图形（它们是知识内容的一部分）
    if (["code"].includes(card.type) && boxDrawing.test(card.content ?? "")) {
      throw new Error(`${file} contains box-drawing ASCII art in ${card.type}/${card.title}. Use diagram cards instead.`);
    }
    if (card.type === "interviewAnswer" && /(^|[：:；;。])\s*1[）)]/.test(card.content ?? "")) {
      throw new Error(`${file} contains inline numbered list in interviewAnswer/${card.title}. Use Markdown lists instead.`);
    }
    if (card.type === "code" && !card.language) {
      throw new Error(`${file} code card ${card.title} must include language.`);
    }
    if (card.type === "diagram") {
      assertDiagramCard(file, card);
    }
    if (card.type === "animation") {
      assertSources(file, card);
    }
  }
  // 语义质量检查
  const topicStr = JSON.stringify(topic);
  for (const check of semanticChecks) {
    if (check.pattern.test(topicStr)) {
      const msg = `${file} ${check.label}: matches "${check.pattern}"`;
      if (check.level === "fail") throw new Error(msg);
      console.warn(`WARNING: ${msg}`);
    }
  }
  const weights = topic.rubric.scoreWeights;
  const total = weights.coverage + weights.accuracy + weights.interviewExpression + weights.depth;
  if (total !== 100) throw new Error(`${file} scoreWeights must sum to 100.`);
}

const orderWeightWarnings = [];

function assertAcyclicPrerequisites(manifestFile, topicsInManifest) {
  const byId = new Map(topicsInManifest.map(({ file, topic }) => [topic.id, { file, topic }]));
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(topicId) {
    if (visited.has(topicId)) return;
    if (visiting.has(topicId)) {
      const start = stack.indexOf(topicId);
      const cycle = [...stack.slice(start), topicId].join(" -> " );
      const file = byId.get(topicId)?.file ?? manifestFile;
      throw new Error(`${file} prerequisite cycle detected in ${manifestFile}: ${cycle}`);
    }

    visiting.add(topicId);
    stack.push(topicId);

    const topic = byId.get(topicId)?.topic;
    for (const prerequisiteId of topic?.prerequisites ?? []) {
      if (byId.has(prerequisiteId)) visit(prerequisiteId);
    }

    stack.pop();
    visiting.delete(topicId);
    visited.add(topicId);
  }

  for (const topicId of byId.keys()) visit(topicId);
}

async function validateManifestClosure(manifestFile, expectedPrefix, expectedStatus) {
  const manifest = await readJson(manifestFile);
  assertValid(manifestFile, validateManifest, manifest);

  const domainIds = new Set(manifest.domains.map((domain) => domain.id));
  const categoryIds = new Map();
  const topicRefs = new Set();
  const topicIds = new Set();
  const domainFiles = [];

  for (const domainEntry of manifest.domains) {
    if (expectedPrefix && !domainEntry.entry.startsWith(expectedPrefix)) {
      throw new Error(`${manifestFile} domain ${domainEntry.id} must use ${expectedPrefix} entry, got ${domainEntry.entry}`);
    }
    if (!expectedPrefix && domainEntry.entry.startsWith("staging/")) {
      throw new Error(`${manifestFile} must not reference staging domain entry ${domainEntry.entry}`);
    }
    if (!expectedPrefix && domainEntry.entry.startsWith("draft/")) {
      throw new Error(`${manifestFile} must not reference draft domain entry ${domainEntry.entry}`);
    }

    const domain = await readJson(domainEntry.entry);
    assertValid(domainEntry.entry, validateDomain, domain);
    if (!domainIds.has(domain.id)) throw new Error(`Domain ${domain.id} is missing from ${manifestFile}.`);
    categoryIds.set(domain.id, new Set(domain.categories.map((category) => category.id)));
    domainFiles.push({ entry: domainEntry, domain });
    for (const category of domain.categories) {
      for (const topic of category.topics) {
        if (expectedPrefix && !topic.startsWith(expectedPrefix)) {
          throw new Error(`${domainEntry.entry} topic ref must use ${expectedPrefix}, got ${topic}`);
        }
        if (!expectedPrefix && topic.startsWith("staging/")) {
          throw new Error(`${domainEntry.entry} must not reference staging topic ${topic}`);
        }
        if (!expectedPrefix && topic.startsWith("draft/")) {
          throw new Error(`${domainEntry.entry} must not reference draft topic ${topic}`);
        }
        topicRefs.add(topic);
      }
    }
  }

  const topicsInManifest = [];
  for (const file of topicRefs) {
    const topic = await readJson(file);
    if (topicIds.has(topic.id)) throw new Error(`${manifestFile} duplicate topic id: ${topic.id}`);
    topicIds.add(topic.id);
    topicsInManifest.push({ file, topic });
    assertTopicQuality(file, topic, domainIds, categoryIds, expectedStatus);
  }

  for (const { file, topic } of topicsInManifest) {
    for (const prerequisiteId of topic.prerequisites ?? []) {
      if (prerequisiteId === topic.id) {
        throw new Error(`${file} prerequisite must not reference itself: ${prerequisiteId}`);
      }
      if (!topicIds.has(prerequisiteId)) {
        throw new Error(`${file} references unknown prerequisite topic id: ${prerequisiteId}`);
      }
    }
  }

  assertAcyclicPrerequisites(manifestFile, topicsInManifest);

  // 顺序与权重检查（防止 App 展示顺序异常）
  for (const { domain } of domainFiles) {
    for (const category of domain.categories) {
      const topics = [];
      for (const ref of category.topics) {
        if (topicRefs.has(ref)) {
          const topic = JSON.parse(await readFile(path.join(root, ref), "utf8"));
          topics.push({ ref, topic });
        }
      }

      const seenOrders = new Map();
      for (let i = 0; i < topics.length; i++) {
        const { ref, topic } = topics[i];

        // 检查 order 是否重复
        if (seenOrders.has(topic.order)) {
          orderWeightWarnings.push({
            level: "warning",
            file: ref,
            message: `DUP_ORDER ${domain.id}/${category.id}: order=${topic.order} 与 "${seenOrders.get(topic.order).title}" 重复`
          });
        }
        seenOrders.set(topic.order, topic);

        // 检查列表顺序是否与 order 一致
        if (i > 0 && topics[i - 1].topic.order > topic.order) {
          orderWeightWarnings.push({
            level: "warning",
            file: ref,
            message: `ORDER_DESC ${domain.id}/${category.id}: "${topics[i - 1].topic.title}"(order=${topics[i - 1].topic.order}) 排在 "${topic.title}"(order=${topic.order}) 前面`
          });
        }

        // 检查 low 频高权重
        if (topic.interviewFrequency === 'low' && topic.recommendWeight >= 85) {
          orderWeightWarnings.push({
            level: "warning",
            file: ref,
            message: `LOW_HIGH_WEIGHT ${domain.id}/${category.id}: "${topic.title}" 是 low 频但权重 ${topic.recommendWeight}`
          });
        }

        // 检查 high 频低权重
        if (topic.interviewFrequency === 'high' && topic.recommendWeight < 75) {
          orderWeightWarnings.push({
            level: "warning",
            file: ref,
            message: `HIGH_LOW_WEIGHT ${domain.id}/${category.id}: "${topic.title}" 是 high 频但权重 ${topic.recommendWeight}`
          });
        }
      }
    }
  }

  return { manifest, topicRefs };
}

const production = await validateManifestClosure("manifest.json", "", "production");
const staging = await validateManifestClosure("staging-manifest.json", "staging/", "staging");
const draft = await validateManifestClosure("draft-manifest.json", "draft/", "draft");

const productionTopicFiles = await listJson("topics");
for (const file of productionTopicFiles) {
  if (!production.topicRefs.has(file)) throw new Error(`${file} is not referenced by a production domain category.`);
}

if (orderWeightWarnings.length > 0) {
  console.log("\n=== 顺序与权重警告 ===");
  for (const w of orderWeightWarnings) {
    console.log(`${w.level.toUpperCase()}: ${w.message}`);
  }
  console.log(`共 ${orderWeightWarnings.length} 个警告`);
}

const totalRefs = production.topicRefs.size + staging.topicRefs.size + draft.topicRefs.size;
console.log(`\nValidated ${totalRefs} referenced topics across 3 manifests.`);
