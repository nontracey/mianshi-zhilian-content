import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const sourceRoot = "/Users/yingjunchi/Downloads/面试和简历/备战计划";
const repoRoot = process.cwd();
const today = "2026-05-27";

const domains = {
  java: {
    id: "java",
    title: "Java 核心与中间件",
    description: "JVM、并发、集合、Spring、数据库、中间件",
    icon: "code",
    themeColor: "#0A2540",
    accentColor: "#00CCF9",
    match: ["Java核心基础", "Spring生态与中间件"],
  },
  agent: {
    id: "agent",
    title: "Agent 开发",
    description: "LLM、RAG、Agent、MCP、Function Calling、AI 工程化",
    icon: "bot",
    themeColor: "#0F172A",
    accentColor: "#22D3EE",
    match: ["AI工程化专题", "AI Agent深度专题"],
  },
  algorithm: {
    id: "algorithm",
    title: "算法与数据结构",
    description: "数组、链表、树、动态规划、字符串、排序、回溯、图",
    icon: "network",
    themeColor: "#12372A",
    accentColor: "#10B981",
    match: ["算法刷题"],
  },
};

const categoryRules = [
  ["jvm", "JVM", "运行时内存、GC、类加载与调优", ["JVM", "GC", "类加载", "垃圾回收", "堆内存", "元空间"]],
  ["concurrency", "并发编程", "线程、锁、线程池、并发容器", ["并发", "线程", "锁", "AQS", "ThreadLocal", "volatile", "synchronized", "CompletableFuture"]],
  ["collections", "集合与 Java 基础", "集合、泛型、反射与语言特性", ["集合", "HashMap", "ArrayList", "LinkedList", "泛型", "反射", "注解", "新特性"]],
  ["spring", "Spring 生态", "Spring、Spring Boot、Spring Cloud 与 MyBatis", ["Spring", "MyBatis", "Nacos", "Gateway", "OpenFeign", "Sentinel", "Seata"]],
  ["database", "数据库与中间件", "MySQL、Redis、消息队列与分布式事务", ["MySQL", "Redis", "RabbitMQ", "Kafka", "RocketMQ", "事务", "索引", "SQL", "缓存", "消息队列"]],
  ["llm", "LLM 基础", "Transformer、训练推理与提示工程", ["Transformer", "大模型", "LLM", "Prompt"]],
  ["rag", "RAG 与向量检索", "RAG、向量数据库、检索增强生成", ["RAG", "向量", "Embedding", "检索"]],
  ["agent-architecture", "Agent 架构", "Agent、MCP、Function Calling、多 Agent", ["Agent", "MCP", "Function Calling", "多Agent", "多 Agent"]],
  ["ai-engineering", "AI 工程化", "评估、观测、安全、合规与项目实践", ["工程化", "评估", "观测", "安全", "合规", "行业", "项目", "简历", "Python"]],
  ["array-list", "数组与链表", "数组、链表与基础数据结构高频题", ["数组", "链表", "数据结构"]],
  ["tree-graph", "树与图", "二叉树、图算法与设计题", ["二叉树", "图", "最短路径", "设计题"]],
  ["dynamic-programming", "动态规划", "状态定义、转移方程与空间优化", ["动态规划", "DP"]],
  ["string-search", "字符串、排序与查找", "字符串技巧、排序算法与二分查找", ["字符串", "排序", "二分"]],
  ["backtracking", "回溯算法", "回溯、搜索与剪枝", ["回溯"]],
  ["review", "综合复习", "阶段复盘、模拟面试与高频题", ["复习", "模拟", "总结", "面试题", "掌握程度"]],
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

function detectDomain(file) {
  return Object.values(domains).find((domain) => domain.match.some((needle) => file.includes(needle)))?.id;
}

function cleanTitle(file) {
  return path
    .basename(file, ".md")
    .replace(/^\d+[-_ ]*/, "")
    .replace(/第\s*\d+\s*天/g, "")
    .replace(/第\s*\d+\s*阶段/g, "")
    .replace(/Day\s*\d+/gi, "")
    .trim();
}

function sanitizeText(text) {
  return text
    .replace(/第\s*\d+[a-zA-Z]?\s*阶段[-_：:]?/g, "")
    .replace(/第\s*\d+[a-zA-Z]?\s*天[-_：:]?/g, "")
    .replace(/Day\s*\d+/gi, "")
    .replace(/\r/g, "")
    .trim();
}

function detectCategory(file, title, content) {
  const haystack = `${file}\n${title}\n${content.slice(0, 1200)}`;
  return categoryRules.find(([, , , keywords]) => keywords.some((keyword) => haystack.includes(keyword))) ?? categoryRules.at(-1);
}

function makeSlug(seed, index) {
  const hash = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 8);
  return `topic-${String(index).padStart(3, "0")}-${hash}`;
}

function pickSummary(title, content) {
  const line = sanitizeText(content)
    .split("\n")
    .map((item) => item.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .find((item) => item.length >= 14 && !item.startsWith("|"));
  return line ? line.slice(0, 96) : `理解 ${title} 的核心概念、使用场景、常见误区和面试表达方式。`;
}

function pickExcerpt(content) {
  const lines = sanitizeText(content)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("|") && !line.startsWith("```"))
    .slice(0, 18);
  return lines.join("\n").slice(0, 1800);
}

function makeTopic(file, index) {
  const domain = detectDomain(file);
  if (!domain) return null;
  return async () => {
    const raw = await readFile(file, "utf8");
    const title = cleanTitle(file);
    const [categoryId, categoryTitle] = detectCategory(file, title, raw);
    const slug = makeSlug(file, index);
    const summary = pickSummary(title, raw);
    const excerpt = pickExcerpt(raw);
    const id = `${domain}.${categoryId}.${slug}`;
    return {
      id,
      domain,
      category: categoryId,
      group: categoryId,
      title,
      summary,
      tags: Array.from(new Set([domains[domain].title.split(" ")[0], categoryTitle, title].filter(Boolean))).slice(0, 5),
      difficulty: domain === "algorithm" ? 3 : 2,
      estimatedMinutes: 20,
      order: index * 10,
      recommendWeight: Math.max(60, 100 - (index % 40)),
      learningCards: [
        { type: "explain", title: "核心概念", content: excerpt || summary },
        {
          type: "interviewAnswer",
          title: "面试回答模板",
          content: `面试时可以先说明 ${title} 解决的问题，再拆核心机制、典型场景和常见误区，最后结合项目或排查经验补充一句实践理解。`,
        },
        {
          type: "checklist",
          title: "学完后应能说清楚",
          items: [`${title} 的定义和边界`, `${title} 的关键机制`, `${title} 在面试中的表达方式`],
        },
      ],
      recallPrompts: [
        {
          id: `${id}.recall.1`,
          prompt: `请用自己的话解释 ${title}。`,
          mode: "text",
          expectedMinutes: 3,
          difficulty: 2,
        },
        {
          id: `${id}.recall.2`,
          prompt: `如果面试官追问 ${title} 的应用场景或常见误区，你会怎么回答？`,
          mode: "text",
          expectedMinutes: 3,
          difficulty: 3,
        },
      ],
      rubric: {
        mustHave: ["定义准确", "关键机制", "适用场景", "常见误区", "面试表达结构"],
        goodToHave: ["结合项目经验", "能做对比", "能说明取舍"],
        commonMistakes: ["只背概念不讲原因", "忽略边界条件", "缺少面试化表达"],
        scoreWeights: {
          coverage: 40,
          accuracy: 25,
          interviewExpression: 20,
          depth: 15,
        },
      },
      sourceRef: path.relative(sourceRoot, file),
      status: "Production",
      updatedAt: today,
    };
  };
}

async function main() {
  await rm(path.join(repoRoot, "domains"), { recursive: true, force: true });
  await rm(path.join(repoRoot, "topics"), { recursive: true, force: true });
  await mkdir(path.join(repoRoot, "domains"), { recursive: true });
  await mkdir(path.join(repoRoot, "topics"), { recursive: true });

  const files = (await walk(sourceRoot)).sort();
  const factories = files.map(makeTopic).filter(Boolean);
  const topics = [];
  for (let index = 0; index < factories.length; index += 1) {
    topics.push(await factories[index]());
  }

  const byDomain = new Map();
  for (const topic of topics) {
    if (!byDomain.has(topic.domain)) byDomain.set(topic.domain, []);
    byDomain.get(topic.domain).push(topic);
  }

  const manifestDomains = [];
  for (const [domainId, domainTopics] of byDomain.entries()) {
    await mkdir(path.join(repoRoot, "topics", domainId), { recursive: true });
    const categories = categoryRules
      .filter(([categoryId]) => domainTopics.some((topic) => topic.category === categoryId))
      .map(([id, title, description], index) => ({
        id,
        title,
        description,
        order: (index + 1) * 10,
        topics: domainTopics
          .filter((topic) => topic.category === id)
          .sort((a, b) => a.order - b.order)
          .map((topic) => `topics/${domainId}/${topic.id.split(".").at(-1)}.json`),
      }));

    for (const topic of domainTopics) {
      await writeFile(
        path.join(repoRoot, "topics", domainId, `${topic.id.split(".").at(-1)}.json`),
        `${JSON.stringify(topic, null, 2)}\n`,
      );
    }

    const domainFile = {
      id: domainId,
      title: domains[domainId].title,
      description: domains[domainId].description,
      icon: domains[domainId].icon,
      themeColor: domains[domainId].themeColor,
      accentColor: domains[domainId].accentColor,
      categories,
    };
    await writeFile(path.join(repoRoot, "domains", `${domainId}.json`), `${JSON.stringify(domainFile, null, 2)}\n`);
    manifestDomains.push({
      id: domainId,
      title: domains[domainId].title,
      description: domains[domainId].description,
      entry: `domains/${domainId}.json`,
      topicCount: domainTopics.length,
      updatedAt: today,
    });
  }

  const manifest = {
    schemaVersion: "1.0.0",
    contentVersion: "2026.05.27",
    minAppVersion: "0.1.0",
    defaultDomain: "java",
    domains: manifestDomains,
  };
  await writeFile(path.join(repoRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(repoRoot, "staging-manifest.json"), `${JSON.stringify({ ...manifest, environment: "staging" }, null, 2)}\n`);
  await writeFile(path.join(repoRoot, "draft-manifest.json"), `${JSON.stringify({ ...manifest, environment: "draft" }, null, 2)}\n`);
  console.log(`Generated ${topics.length} topics across ${manifestDomains.length} domains.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
