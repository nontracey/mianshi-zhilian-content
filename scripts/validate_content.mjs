import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();
const forbidden = /(第\s*\d+[a-zA-Z]?\s*天|第\s*\d+[a-zA-Z]?\s*阶段|Day\s*\d+|今日练习与总结)/i;

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
  const weights = topic.rubric.scoreWeights;
  const total = weights.coverage + weights.accuracy + weights.interviewExpression + weights.depth;
  if (total !== 100) throw new Error(`${file} scoreWeights must sum to 100.`);
  if (!topicRefs.has(file)) throw new Error(`${file} is not referenced by a domain category.`);
}

console.log(`Validated ${topicFiles.length} topics across ${manifest.domains.length} domains.`);
