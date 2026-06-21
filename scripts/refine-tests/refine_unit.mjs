#!/usr/bin/env node
// quality_refine.mjs 纯函数单测：
//   - computeCorroborated：多判官互证取交集（退步/改善两侧都需全体一致）。
//   - buildBlockDescriptors / applyBlockDescriptors 的 remove 块操作（P1.1）。
//   - extractHeadroomCards：按 cardTitle/where 定位有 headroom 的卡。
//   - computeExternalSignals：按需联网/看图信号。
// remove 默认关，需在 import 前打开开关。
process.env.REFINE_ALLOW_BLOCK_REMOVE = "true";

const {
  computeCorroborated,
  buildBlockDescriptors,
  applyBlockDescriptors,
  extractHeadroomCards,
  computeExternalSignals,
} = await import("../quality_refine.mjs");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); pass += 1; }
  else { console.log(`  ✗ ${name}`); fail += 1; }
}

const DIMS = [
  "accuracy", "cognitiveOrder", "expertVoice", "selfContained",
  "interviewUsability", "difficultyFit", "learnerClarity", "coverage", "seniorityDiscrimination",
];
const dimObj = (v) => Object.fromEntries(DIMS.map((d) => [d, v]));

console.log("=== computeCorroborated：互证取交集 ===");
{
  const before = { dimensions: dimObj(5) };
  // 两判官都把 coverage 从 5 降到 4 → 互证确认退步；无人升 → improved 空。
  const reviews = [
    { dimensions: { ...dimObj(5), coverage: 4 } },
    { dimensions: { ...dimObj(5), coverage: 4 } },
  ];
  const c = computeCorroborated(reviews, before);
  check("两判官一致退步 coverage => regressedDims 含 coverage", c.regressedDims.includes("coverage"));
  check("无人改善 => improvedDims 为空", c.improvedDims.length === 0);
}
{
  const before = { dimensions: { ...dimObj(5), coverage: 3 } };
  // 一个判官 coverage 升到 5，另一个只到 3（=before，不算升）→ 不是全体一致 → 不算 improved。
  const reviews = [
    { dimensions: { ...dimObj(5), coverage: 5 } },
    { dimensions: { ...dimObj(5), coverage: 3 } },
  ];
  const c = computeCorroborated(reviews, before);
  check("非全体一致改善 => improvedDims 不含 coverage", !c.improvedDims.includes("coverage"));
}
{
  check("单判官（<2）=> 返回 null（无法互证）", computeCorroborated([{ dimensions: dimObj(5) }], { dimensions: dimObj(5) }) === null);
}

console.log("=== block remove（P1.1）===");
{
  const cardA = { type: "explain", title: "A 机制", content: "讲清 A 的机制与边界，约一百二十字以保证不会被当成空壳卡处理。".repeat(2) };
  const cardDup = { type: "explain", title: "B 重复占位", content: "这是一张几乎重复的占位卡，内容空泛没有独有知识点。".repeat(2) };
  const cardC = { type: "interviewAnswer", title: "C 面试", content: "30 秒结论。", followUpQuestions: [{ question: "q1", answer: "a1" }, { question: "q2", answer: "a2" }] };
  const cardCode = { type: "code", title: "D 代码", language: "go", content: "func main(){}" };
  const original = { learningCards: [cardA, cardDup, cardC, cardCode] };
  const candidate = { learningCards: [cardA, cardC, cardCode] }; // 丢掉 cardDup

  const blockIndex = buildBlockDescriptors(original, candidate);
  const removeDescs = blockIndex.descriptors.filter((d) => d.kind === "remove");
  check("候选丢卡 => 生成 1 个 remove 描述符", removeDescs.length === 1);
  check("remove 描述符指向被丢的卡", removeDescs[0]?.original?.title === "B 重复占位");

  // 选中 remove => 卡被删
  const merged = applyBlockDescriptors(original, candidate, removeDescs, blockIndex);
  check("选中 remove => merged 删掉该卡", merged.learningCards.length === 3 && !merged.learningCards.some((c) => c.title === "B 重复占位"));
  check("选中 remove => 其余卡原样保留", merged.learningCards.some((c) => c.title === "A 机制") && merged.learningCards.some((c) => c.title === "C 面试"));

  // 不选中 remove => 卡保留（绝不静默删）
  const kept = applyBlockDescriptors(original, candidate, [], blockIndex);
  check("未选中 remove => 默认保留该卡（从 original 起步）", kept.learningCards.length === 4 && kept.learningCards.some((c) => c.title === "B 重复占位"));
}

console.log("=== extractHeadroomCards ===");
{
  const topic = { learningCards: [
    { type: "explain", title: "A 机制" },
    { type: "explain", title: "B 边界" },
    { type: "interviewAnswer", title: "C 面试" },
  ] };
  const review = {
    score: 95,
    factFindings: [{ cardTitle: "A 机制", verdict: "suspicious", claim: "x" }],
    voiceFindings: [{ where: "B 边界", issue: "模板腔" }],
    orderFindings: [], selfContainedFindings: [], clarityFindings: [],
    coverageFindings: [], followUpFindings: [],
  };
  const cards = extractHeadroomCards(review, topic);
  const titles = cards.map((c) => c.title);
  check("factFinding.cardTitle 定位到 A", titles.includes("A 机制"));
  check("voiceFinding.where 定位到 B", titles.includes("B 边界"));
  check("无 finding 指向的 C 不入 headroom（score≥90）", !titles.includes("C 面试"));
}
{
  // coverageFindings 非空 => 全卡都算 headroom（缺面要补，定位不到具体卡）。
  const topic = { learningCards: [{ type: "explain", title: "A" }, { type: "explain", title: "B" }] };
  const review = { score: 95, coverageFindings: [{ missingPoint: "缺了 X" }], factFindings: [], voiceFindings: [], orderFindings: [], selfContainedFindings: [], clarityFindings: [], followUpFindings: [] };
  check("coverage 缺口 => 全卡入 headroom", extractHeadroomCards(review, topic).length === 2);
}

console.log("=== computeExternalSignals ===");
{
  const original = { learningCards: [{ type: "explain", title: "A", content: "x" }] };
  const sig = computeExternalSignals(original, original, null);
  check("候选与原文相同 => changedBlocks 为空数组", Array.isArray(sig.changedBlocks) && sig.changedBlocks.length === 0);
  check("无 SVG => hadSvg false", sig.hadSvg === false);
}
{
  const original = { learningCards: [{ type: "diagram", title: "图", format: "svg", svg: "<svg></svg>", content: "" }] };
  const sig = computeExternalSignals(original, original, { diagramModalityFinding: { recommendedFormat: "svg" } });
  check("有 SVG => hadSvg true & needSvg true", sig.hadSvg === true && sig.needSvg === true);
}

console.log(`\n=== refine unit: PASS=${pass} FAIL=${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
