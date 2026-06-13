#!/usr/bin/env node
// 精修/判官回归测试用的 mock CLI（同一脚本，按 prompt 内容自动区分两种模式）。
//
// 精修模式（prompt 含「【当前 topic JSON】」）：取出 topic，按 MOCK_MODE 做确定性变换，
//   写入 prompt 指定的缓存绝对路径并追加 //---END---，stdout 只打印 WROTE:<path>。
//   MOCK_MODE：
//     identity   原样回吐（keep-best 下与现版同分 -> 不更优 -> 保留旧版）
//     inject     给 explain 追加一句命中 templatePatterns 的泛化语 -> 静态分下降（“改烂”）
//     strip      删除该泛化语 -> 静态分回升（“改好”，配合预降级）
//     factbug    追加一句“中性但事实错”的句子（静态查不出，但判官会判 wrong）-> 测判官拦事实退化
//     partial    explain 删除泛化语，但 interviewAnswer 追加事实错 -> 测 Phase 3 只吸收好块
//     rename     删除泛化语并改 explain 标题 -> 测无 card id 时靠相似度匹配
//     duplicate  删除泛化语但复制一张 explain -> 测重复块守卫
//     subtlebad  删除泛化语但把追问答案改成空泛语 -> 测 block-level verdict 拦截
//     downgrade  difficulty-1 -> Phase 0 锁字段失败
//     droptag    删除 tags -> Phase 0 字段被删除
//     changetags 改 tags -> Phase 0 元数据被改动
//
// 判官模式（prompt 含「待评审 topic JSON」/批量/块级比较）：按被评内容里的标记给确定性 review（内容驱动，
//   保证 before/after 评审可区分）：含 factbug 标记 -> 事实错(blocking)；含泛化语 -> learnerClarity 不达标；
//   否则 -> 全 5 分通过。
import { writeFileSync } from "node:fs";

const TEMPLATE_SENTENCE = process.env.MOCK_TEMPLATE_SENTENCE || "建议结合实际项目理解这个知识点的价值。";
const FACTBUG_SENTENCE = process.env.MOCK_FACTBUG_SENTENCE || "在所有情况下该机制都会以完全相反的方式工作并保证零开销。";
const SUBTLE_BAD_SENTENCE = process.env.MOCK_SUBTLE_BAD_SENTENCE || "这个问题要看具体情况，结合项目经验灵活回答即可。";
const argv = process.argv.slice(2);
const prompt = argv.find((arg) => typeof arg === "string" && (arg.includes("【当前 topic JSON】") || arg.includes("待评审 topic JSON") || arg.includes("待评审 topics JSON") || arg.includes("待比较 blocks"))) || "";

function reviewForText(text) {
  const allFive = { accuracy: 5, cognitiveOrder: 5, expertVoice: 5, selfContained: 5, interviewUsability: 5, difficultyFit: 5, learnerClarity: 5, coverage: 5 };
  if (text.includes(FACTBUG_SENTENCE)) {
    return {
      verdict: "fail",
      score: 70,
      dimensions: { ...allFive, accuracy: 2 },
      factFindings: [{ claim: FACTBUG_SENTENCE, verdict: "wrong", evidence: "与实际机制相反" }],
      blockingFindings: [{ reason: "存在与事实相反的断言" }],
      notes: "mock judge: factbug",
    };
  }
  if (text.includes(TEMPLATE_SENTENCE)) {
    return {
      verdict: "fail",
      score: 80,
      dimensions: { ...allFive, learnerClarity: 3 },
      factFindings: [{ claim: "示例机制", verdict: "correct", evidence: "ok" }],
      blockingFindings: [],
      followUpFindings: [{ question: "示例追问", isSpecific: false, answerAdequate: true, fix: "改成本题专属" }],
      notes: "mock judge: degraded",
    };
  }
  return {
    verdict: "pass",
    score: 92,
    dimensions: { ...allFive },
    factFindings: [
      { claim: "定义", verdict: "correct", evidence: "ok" },
      { claim: "机制", verdict: "correct", evidence: "ok" },
      { claim: "边界", verdict: "correct", evidence: "ok" },
    ],
    blockingFindings: [],
    notes: "mock judge: clean",
  };
}

function extractJsonAfter(marker) {
  return JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length).trim());
}

// ===== 块级判官模式 =====
if (prompt.includes("待比较 blocks")) {
  const blocks = extractJsonAfter("待比较 blocks：");
  const blockReviews = blocks.map((block) => {
    const after = JSON.stringify(block.after ?? "");
    if (after.includes(FACTBUG_SENTENCE)) {
      return { key: block.key, verdict: "blocking", reason: "候选块引入事实错", fix: "删除错误断言" };
    }
    if (after.includes(SUBTLE_BAD_SENTENCE)) {
      return { key: block.key, verdict: "regressed", reason: "候选块追问答案变成空泛项目经验话术", fix: "补回本题专属抓手" };
    }
    if (after.includes(TEMPLATE_SENTENCE)) {
      return { key: block.key, verdict: "regressed", reason: "候选块仍含模板句", fix: "改成本题专属表达" };
    }
    return { key: block.key, verdict: "improved", reason: "候选块移除了模板句且没有坏标记", fix: "" };
  });
  process.stdout.write(JSON.stringify({ blockReviews }) + "\n");
  process.exit(0);
}

// ===== 批量判官模式 =====
if (prompt.includes("待评审 topics JSON")) {
  const items = extractJsonAfter("待评审 topics JSON：");
  process.stdout.write(JSON.stringify({
    reviews: items.map((item) => ({ ref: item.ref, ...reviewForText(JSON.stringify(item.topic)) })),
  }) + "\n");
  process.exit(0);
}

// ===== 判官模式 =====
if (prompt.includes("待评审 topic JSON")) {
  process.stdout.write(JSON.stringify(reviewForText(prompt)) + "\n");
  process.exit(0);
}

// ===== 精修模式 =====
if (!prompt) {
  process.stderr.write("mock_cli: prompt not found in argv\n");
  process.exit(2);
}
const cacheMatch = prompt.match(/绝对路径的文件：\s*\n\s*(\S+)/);
if (!cacheMatch) {
  process.stderr.write("mock_cli: cache path not found in prompt\n");
  process.exit(2);
}
const cachePath = cacheMatch[1].trim();
const marker = "【当前 topic JSON】";
const jsonText = prompt.slice(prompt.lastIndexOf(marker) + marker.length).trim();
const topic = JSON.parse(jsonText);

const mode = process.env.MOCK_MODE || "identity";
const explain = (topic.learningCards || []).find((card) => card.type === "explain");
if (mode === "inject") {
  if (explain) explain.content = `${explain.content || ""}\n${TEMPLATE_SENTENCE}`;
} else if (mode === "strip") {
  for (const card of topic.learningCards || []) {
    if (typeof card.content === "string") {
      card.content = card.content.split("\n").filter((line) => line.trim() !== TEMPLATE_SENTENCE).join("\n");
    }
  }
} else if (mode === "factbug") {
  if (explain) explain.content = `${explain.content || ""}\n${FACTBUG_SENTENCE}`;
} else if (mode === "partial") {
  for (const card of topic.learningCards || []) {
    if (typeof card.content === "string") {
      card.content = card.content.split("\n").filter((line) => line.trim() !== TEMPLATE_SENTENCE).join("\n");
    }
  }
  const interview = (topic.learningCards || []).find((card) => card.type === "interviewAnswer");
  if (interview) interview.content = `${interview.content || ""}\n${FACTBUG_SENTENCE}`;
} else if (mode === "rename") {
  if (explain) {
    explain.content = `${explain.content || ""}`.split("\n").filter((line) => line.trim() !== TEMPLATE_SENTENCE).join("\n");
    explain.title = `${explain.title}（专家版）`;
  }
} else if (mode === "duplicate") {
  if (explain) {
    explain.content = `${explain.content || ""}`.split("\n").filter((line) => line.trim() !== TEMPLATE_SENTENCE).join("\n");
    topic.learningCards.splice(1, 0, { ...JSON.parse(JSON.stringify(explain)), title: `${explain.title} 副本` });
  }
} else if (mode === "subtlebad") {
  for (const card of topic.learningCards || []) {
    if (typeof card.content === "string") {
      card.content = card.content.split("\n").filter((line) => line.trim() !== TEMPLATE_SENTENCE).join("\n");
    }
  }
  const interview = (topic.learningCards || []).find((card) => card.type === "interviewAnswer" && Array.isArray(card.followUpQuestions));
  if (interview?.followUpQuestions?.[0]) interview.followUpQuestions[0].answer = SUBTLE_BAD_SENTENCE;
} else if (mode === "downgrade") {
  topic.difficulty = Math.max(1, (topic.difficulty || 3) - 1);
} else if (mode === "droptag") {
  delete topic.tags;
} else if (mode === "dropsummary") {
  delete topic.summary;
} else if (mode === "changetags") {
  topic.tags = ["__mock_changed_tag__"];
}
// identity：不改动

writeFileSync(cachePath, `${JSON.stringify(topic, null, 2)}\n//---END---\n`);
process.stdout.write(`WROTE:${cachePath}\n`);
