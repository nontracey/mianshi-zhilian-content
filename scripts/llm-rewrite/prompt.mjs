// 组装改写请求的 messages。
// system = 改写规范 + 1 篇满配范例（稳定前缀，便于 prompt 缓存）。
// user   = 本篇只读上下文 + 待改写内容字段。
import fs from "node:fs";
import path from "node:path";
import { REWRITE_DIR, REPO_ROOT } from "./config.mjs";
import { extractContent } from "./topic-io.mjs";

// 满配范例（topic-021 线程池）。难度低的题再额外参考 topic-030。
const EXEMPLAR_REFS = {
  default: "topics/java/topic-021-d2222a23.json",
  low: "topics/java/topic-030-e4f16979.json",
};

let SPEC_CACHE = null;
function spec() {
  if (SPEC_CACHE == null) SPEC_CACHE = fs.readFileSync(path.join(REWRITE_DIR, "rewrite-spec.md"), "utf8");
  return SPEC_CACHE;
}

const exemplarCache = new Map();
function exemplarContent(ref) {
  if (!exemplarCache.has(ref)) {
    const topic = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ref), "utf8"));
    const { content, context } = extractContent(topic);
    exemplarCache.set(ref, JSON.stringify({ context, content }, null, 0));
  }
  return exemplarCache.get(ref);
}

export function buildMessages(topic) {
  const { content, context } = extractContent(topic);
  const exemplarRef = (topic.difficulty ?? 3) <= 2 ? EXEMPLAR_REFS.low : EXEMPLAR_REFS.default;
  const system = [
    spec(),
    "\n---\n",
    "## 满配范例（这就是「好」长什么样，照着它的深度和形态写，但内容要完全是当前 topic 的）\n",
    "```json\n" + exemplarContent(exemplarRef) + "\n```",
  ].join("\n");

  const user = [
    `在现有内容基础上逐卡改写优化这篇 topic：每张卡都改好/补强，**不要删卡**（现有卡都承载真实内容），需要时可新增卡。别整篇从 0 重造一份。原文有 ${topic.learningCards?.length || 0} 张卡（${[...new Set((topic.learningCards||[]).map(c=>c.type))].map(t=>t+' '+(topic.learningCards.filter(c=>c.type===t).length)+'张').join('、')}），输出的 learningCards 必须包含同等数量或更多——合并两张卡算删卡，程序会判失败。`,
    "只读上下文（仅用于判断范围和深度，不改写）：",
    "```json\n" + JSON.stringify(context, null, 0) + "\n```",
    "待改写的内容字段（现有全部卡）：",
    "```json\n" + JSON.stringify(content, null, 0) + "\n```",
    "按规范输出一个 JSON 对象，key 恰好是上面内容字段的 key（summary、learningCards、recallPrompts、rubric、interviewerFocus），外加可选 _diagramRequests。learningCards 必须是完整数组（含你保留未改的卡）。不要解释、不要代码围栏。\n严格 JSON：字符串里的反斜杠写 `\\\\`、双引号写 `\\\"`、换行写 `\\n`，整体必须能被 JSON.parse 直接解析。",
  ].join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// mock 模式：不调 API，原样回传内容字段（验证抽取/合并/写回/账本/进度全链路）。
export function mockResponse(topic) {
  const { content } = extractContent(topic);
  return JSON.stringify(content);
}
