// scripts/refine-tests/diagram_candidates_unit.mjs
// 图候选选优纯函数单测：selectBestCandidate 选优 + 全 fail 兜底 + NoFreeDiagramModel 触发

import { selectBestCandidate, NoFreeDiagramModel } from "../diagram_candidates.mjs";

let pass = 0;
let fail = 0;
function check(name, ok) {
  if (ok) { console.log(`  ✓ ${name}`); pass += 1; }
  else { console.error(`  ✗ ${name}`); fail += 1; }
}

console.log("=== selectBestCandidate：全 fail 兜底 ===");
{
  const allFail = [
    { format: "svg", review: { visualFit: "fail", findings: [] }, score: 20 },
    { format: "mermaid", review: { visualFit: "fail", findings: [] }, score: 30 },
  ];
  const r = selectBestCandidate(allFail, {});
  check("全 fail 返回 keptOld=true", r.keptOld === true);
  check("全 fail best=null", r.best === null);
}

console.log("\n=== selectBestCandidate：有 pass 选最高分 ===");
{
  const mixed = [
    { format: "svg", review: { visualFit: "fail", findings: [] }, score: 20 },
    { format: "mermaid", review: { visualFit: "pass", findings: [] }, score: 80 },
    { format: "compareTable", review: { visualFit: "pass", findings: [{ severity: "warn" }] }, score: 75 },
  ];
  const r = selectBestCandidate(mixed, {});
  check("有 pass 返回 keptOld=false", r.keptOld === false);
  check("选最高分 mermaid (score=80)", r.best.format === "mermaid" && r.best.score === 80);
}

console.log("\n=== selectBestCandidate：score<50 也算 fail ===");
{
  const lowScore = [
    { format: "mermaid", review: { visualFit: "pass", findings: [{severity:"fail"},{severity:"fail"},{severity:"fail"}] }, score: 30 },
  ];
  const r = selectBestCandidate(lowScore, {});
  check("score<50 即使 visualFit=pass 也不选", r.keptOld === true);
}

console.log("\n=== NoFreeDiagramModel 错误码 ===");
{
  const err = new NoFreeDiagramModel();
  check("code=NO_FREE_DIAGRAM_MODEL", err.code === "NO_FREE_DIAGRAM_MODEL");
  check("message 含 --allow-paid-diagram 提示", err.message.includes("--allow-paid-diagram"));
}

console.log(`\n=== diagram_candidates unit: PASS=${pass} FAIL=${fail} ===`);
if (fail) process.exit(1);
