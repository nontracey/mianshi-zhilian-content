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
