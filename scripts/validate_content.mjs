import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();
const forbidden = /(第\s*\d+[a-zA-Z]?\s*天|第\s*\d+[a-zA-Z]?\s*阶段|Day\s*\d+|今日练习与总结)/i;
const boxDrawing = /[┌┐└┘├┤┬┴┼│─═╔╗╚╝╠╣╦╩╬]/;

// 语义质量检查（P0/P1 整改完成后加入，防止模板化问题回流）
const semanticChecks = [
  { pattern: /今日笔记/, level: "fail", label: "今日笔记模板残留" },
  { pattern: /面试话术/, level: "fail", label: "面试话术标签残留" },
  { pattern: /在实际项目中使用.*你遇到过什么问题/, level: "fail", label: "泛化项目追问" },
  { pattern: /在实际项目中是怎么用的.*有什么注意事项/, level: "fail", label: "泛化复述提问" },
  { pattern: /结合项目经验|能做对比|能说明取舍/, level: "fail", label: "泛化 rubric 评价" },
  { pattern: /面试表达清晰有条理.*能回答追问/, level: "fail", label: "泛化 rubric 表达" },
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

const manifest = await readJson("manifest.json");
assertValid("manifest.json", validateManifest, manifest);

const domainIds = new Set(manifest.domains.map((domain) => domain.id));
const categoryIds = new Map();
const topicRefs = new Set();

for (const domainEntry of manifest.domains) {
  const domain = await readJson(domainEntry.entry);
  assertValid(domainEntry.entry, validateDomain, domain);
  if (!domainIds.has(domain.id)) throw new Error(`Domain ${domain.id} is missing from manifest.`);
  categoryIds.set(domain.id, new Set(domain.categories.map((category) => category.id)));
  for (const category of domain.categories) {
    for (const topic of category.topics) topicRefs.add(topic);
  }
}

const topicFiles = await listJson("topics");
const seenIds = new Set();
for (const file of topicFiles) {
  const topic = await readJson(file);
  assertValid(file, validateTopic, topic);
  if (forbidden.test(topic.title) || forbidden.test(topic.summary)) {
    throw new Error(`${file} contains schedule wording in title or summary.`);
  }
  if (seenIds.has(topic.id)) throw new Error(`Duplicate topic id: ${topic.id}`);
  seenIds.add(topic.id);
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
  if (!topic.learningCards.some((card) => ["compareTable", "diagram", "code"].includes(card.type))) {
    throw new Error(`${file} must include at least one deeper visual, comparison, or code card.`);
  }
  for (const card of topic.learningCards) {
    // 允许 explain 和 diagram 卡片包含 ASCII 图形（它们是知识内容的一部分）
    if (["code"].includes(card.type) && boxDrawing.test(card.content ?? "")) {
      throw new Error(`${file} contains box-drawing ASCII art in ${card.type}/${card.title}. Use diagram cards instead.`);
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
  if (!topicRefs.has(file)) throw new Error(`${file} is not referenced by a domain category.`);
}

console.log(`Validated ${topicFiles.length} topics across ${manifest.domains.length} domains.`);
