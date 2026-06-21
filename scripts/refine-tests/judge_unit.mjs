#!/usr/bin/env node
// quality_llm_judge.mjs 纯函数单测：聚合（中位数+blocking并集）、判通过、接受判据（回归向量）。
import {
  aggregateReviews,
  judgePasses,
  acceptByJudge,
  factProblemCount,
  diagramModalityProblemCount,
  JUDGE_DIMENSIONS,
} from "../quality_llm_judge.mjs";

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass += 1;
  } else {
    console.log(`  ✗ ${name}`);
    fail += 1;
  }
}

const allFive = Object.fromEntries(JUDGE_DIMENSIONS.map((d) => [d, 5]));
const all4 = Object.fromEntries(JUDGE_DIMENSIONS.map((d) => [d, 4]));
const review = (over = {}) => ({
  verdict: "pass",
  score: 90,
  dimensions: { ...allFive },
  factFindings: [],
  blockingFindings: [],
  ...over,
});

console.log("=== aggregateReviews：中位数 + blocking 并集 ===");
{
  const r = aggregateReviews([
    review({ score: 80 }),
    review({ score: 90 }),
    review({ score: 100 }),
  ]);
  check("3 个分数 80/90/100 中位数 = 90", r.score === 90);
}
{
  const r = aggregateReviews([
    review({ dimensions: { ...allFive, accuracy: 3 } }),
    review({ dimensions: { ...allFive, accuracy: 5 } }),
    review({ dimensions: { ...allFive, accuracy: 4 } }),
  ]);
  check("维度 accuracy 3/5/4 中位数 = 4", r.dimensions.accuracy === 4);
}
{
  const r = aggregateReviews([
    review({ blockingFindings: [{ reason: "x" }] }),
    review({ blockingFindings: [] }),
  ]);
  check("blocking 并集：任一判官报错就保留", factProblemCount(r) >= 1);
}

console.log("=== judgePasses ===");
check("全 5 分 + 无事实问题 + 分≥线 => pass", judgePasses(review({ score: 90 }), 85) === true);
check("分数低于动态线 => 不 pass", judgePasses(review({ score: 80 }), 85) === false);
check("某维 <4 => 不 pass", judgePasses(review({ dimensions: { ...allFive, learnerClarity: 3 } }), 85) === false);
check("有 wrong 事实 => 不 pass", judgePasses(review({ factFindings: [{ verdict: "wrong" }] }), 85) === false);
check(
  "图解形态不适配 => 不 pass",
  judgePasses(review({ diagramModalityFinding: { isCurrentFormatFit: false, visualFit: "not_checked" } }), 85) === false,
);
check(
  "图解问题计数能识别候选退化",
  diagramModalityProblemCount(review({ diagramModalityFinding: { isCandidateDowngrade: true, visualFit: "pass" } })) === 1,
);

console.log("=== acceptByJudge：回归向量 ===");
// 真改善：维度 4->5、静态 90->95，无新事实问题 => accept
check(
  "维度普遍上升 + 静态升 => accept",
  acceptByJudge({ before: review({ dimensions: { ...all4 }, score: 84 }), after: review({ dimensions: { ...allFive }, score: 92 }), staticBefore: 90, staticAfter: 95 }).accept === true,
);
// 任一维退步 => reject（“修一块坏一块”）
check(
  "某维退步(5->4) => reject",
  acceptByJudge({ before: review(), after: review({ dimensions: { ...allFive, coverage: 4 } }), staticBefore: 92, staticAfter: 93 }).accept === false,
);
// 引入新事实问题（静态查不出）=> reject
check(
  "引入新 wrong 事实 => reject",
  acceptByJudge({ before: review(), after: review({ factFindings: [{ verdict: "wrong" }], blockingFindings: [{ reason: "x" }] }), staticBefore: 95, staticAfter: 96 }).accept === false,
);
check(
  "引入图解形态退化 => reject",
  acceptByJudge({
    before: review(),
    after: review({ diagramModalityFinding: { isCandidateDowngrade: true, visualFit: "pass" } }),
    staticBefore: 95,
    staticAfter: 96,
  }).accept === false,
);
// 静态跌破 90 地板 => reject（即使动态更好）
check(
  "静态 <90 => reject",
  acceptByJudge({ before: review({ dimensions: { ...all4 } }), after: review({ dimensions: { ...allFive } }), staticBefore: 92, staticAfter: 88 }).accept === false,
);
// 完全没变好（维度全等、分相等、静态相等）=> reject（避免无意义 churn）
check(
  "毫无改善 => reject",
  acceptByJudge({ before: review(), after: review(), staticBefore: 95, staticAfter: 95 }).accept === false,
);
// 部分更好但总分波动：维度有升无降、静态从 98 略降到 95（仍≥90）=> 仍 accept（不拿总分当唯一开关）
check(
  "部分维度升 + 静态小幅降但≥90 => accept（这正是 Q3 要的）",
  acceptByJudge({ before: review({ dimensions: { ...allFive, coverage: 4 } }), after: review({ dimensions: { ...allFive } }), staticBefore: 98, staticAfter: 95 }).accept === true,
);

// ===== P2.1/P2.2 互证（corroborated）落盘门 =====
console.log("=== acceptByJudge：互证（corroborated）路径 ===");
{
  // 单判官裸维度看到某维退步，但互证结论 regressedDims 为空 → 不据此否（互证去噪），且 improvedDims 非空 → accept。
  const before = review({ dimensions: { ...allFive } });
  const after = review({ dimensions: { ...allFive, coverage: 4 } });
  check(
    "互证 regressedDims 为空 + improvedDims 非空 => accept（裸维度退步被互证去噪）",
    acceptByJudge({
      before, after, staticBefore: 95, staticAfter: 96,
      corroborated: { regressedDims: [], improvedDims: ["expertVoice"] },
    }).accept === true,
  );
}
{
  // 互证确认某维退步 → 必须 reject（退步一经互证确认即否，不放宽容差）。
  const decision = acceptByJudge({
    before: review(), after: review(), staticBefore: 95, staticAfter: 96,
    corroborated: { regressedDims: ["accuracy"], improvedDims: [] },
  });
  check("互证确认退步 => reject", decision.accept === false);
  check("互证退步 reason 含『互证确认』", /互证确认/.test(decision.reason));
}
check(
  "互证无退步但毫无改善 => reject",
  acceptByJudge({
    before: review(), after: review(), staticBefore: 95, staticAfter: 95,
    corroborated: { regressedDims: [], improvedDims: [] },
  }).accept === false,
);

console.log(`\n=== judge unit: PASS=${pass} FAIL=${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
