// 内容精修"动态判官"的共享纯函数：9 维评审 prompt、输出解析、多判官聚合、通过/接受判据。
// 与确定性静态审计互补——静态当地板 + 抓跨 topic 套话，判官当语义/事实/可教会的真天花板。
// 这里只放纯逻辑（无 IO、无 CLI spawn），便于单测与复用；CLI 调度复用 quality_refine.mjs 的 runProcess。

export const JUDGE_RUBRIC_VERSION = "judge-9dim-v1";
export const BLOCK_JUDGE_RUBRIC_VERSION = "block-judge-v1";

// 字符串值内禁止未转义 ASCII 双引号——国产模型在 evidence/reason 字段里直接写
// `"goodToHave"` 之类引号会让 JSON 提前闭合，整批判官输出全废。
// 这段硬规则直接拼到三个 prompt 末尾，要求模型用中文「」/反引号/\" 转义代替裸 ASCII 双引号。
export const JSON_STRING_RULES = `
【JSON 字符串硬规则（违反即视为非法输出）】
1. JSON 字符串值内一律不要写未转义的 ASCII 双引号 "。需要引用术语/字段名/状态值时，必须改用以下形式之一：
   - 中文双引号：「goodToHave」「pass」「fail」
   - 反引号：\`goodToHave\` \`mustHave\` \`pass\`
   - 转义：\\"goodToHave\\"
2. 不要在字符串值里写裸换行；多行内容请用 \\n 转义或拆成多个字段。
3. 如果你不确定某个字符是否需要转义，宁可改写措辞，也不要让 JSON.parse 失败。
4. 整体输出必须能被 JSON.parse 成功解析，不要包 Markdown 代码围栏，不要在 JSON 外加任何解释。`;

// 9 维（原 6 维对应标准 §8.4 + learnerClarity/coverage 两个正交补洞 + seniorityDiscrimination 区分度天花板）。1-5 整数，<4 视为该维不达标。
export const JUDGE_DIMENSIONS = [
  "accuracy", // 事实/版本/复杂度/协议行为/框架机制正确；图、表、代码也按事实核验
  "cognitiveOrder", // 动机->定义->机制->例子->边界/失败->对比/取舍->面试表达
  "expertVoice", // 有机制/条件/指标/失败模式/工程边界与取舍，不是模板腔/百科腔
  "selfContained", // 正文足以回答自己的 recallPrompts 和 rubric.mustHave
  "interviewUsability", // 可形成 30 秒结论 + 机制主线 + 追问边界
  "difficultyFit", // 内容深度与 difficulty 标注一致
  "learnerClarity", // 零基础读者能否真看懂：句子清晰、术语先解释、认知负荷不过载
  "coverage", // 面试关键面是否讲全（按知识点该考什么评，不许拿本篇 rubric 当标尺）
  "seniorityDiscrimination", // 区分度天花板：技术类对标 P7/P7+——difficulty≥3 须能区分资深、4-5 须到专家深度；非技术类对应专家纵深；difficulty 1-2 基础题诚实标注即可
];

export const DIMENSION_FLOOR = 4; // 任一维 <4 视为不达标
const FACT_PROBLEM_VERDICTS = new Set(["wrong", "outdated"]);

// 构造单篇判官 prompt：只输出一个 review JSON 对象。
export function buildJudgePrompt(topic, ref) {
  const schema = {
    ref,
    title: topic.title,
    verdict: "pass | fail",
    score: 88,
    dimensions: Object.fromEntries(JUDGE_DIMENSIONS.map((d) => [d, 4])),
    factFindings: [
      { claim: "被核验的事实断言", verdict: "correct | wrong | suspicious | outdated", evidence: "核验依据或无法核验的原因" },
    ],
    orderFindings: [{ where: "卡片标题或位置", issue: "认知顺序问题", fix: "应如何调整" }],
    voiceFindings: [{ where: "卡片标题", issue: "模板腔/百科腔/空泛", fix: "改成本题专属的具体表达" }],
    selfContainedFindings: [{ where: "recallPrompt 或 rubric.mustHave", issue: "正文未覆盖", fix: "正文应补什么" }],
    clarityFindings: [{ where: "卡片标题或段落", issue: "零基础读者卡在哪/术语没解释", fix: "如何讲清" }],
    coverageFindings: [{ missingPoint: "面试会考但本篇没讲到的关键面", why: "为什么面试需要它" }],
    followUpFindings: [{ question: "原追问文案", isSpecific: true, answerAdequate: true, fix: "若不够，应如何尖锐化/补全答案" }],
    blockingFindings: [{ reason: "导致 fail 的硬问题（事实错/outdated 等）" }],
    notes: "",
  };
  return `你是独立的内容质量评审 agent，面向“零基础用户靠这一篇就能学会并拿去面试”的目标做审查。不要复用写作立场，只按事实和真实学习体验打分。

只返回一个 JSON 对象，第一个非空白字符是 {，最后一个是 }。不要解释、不要 Markdown 代码围栏。

评审维度（dimensions 用 1-5 整数）：
1. accuracy 事实正确性：关键事实、版本、复杂度、协议行为、框架机制不能错；图的流程方向、对比表结论、代码正确性也按事实核验。
2. cognitiveOrder 认知顺序：动机 -> 定义 -> 机制 -> 例子 -> 边界/失败路径 -> 对比/取舍 -> 面试表达，是否连贯不跳跃。
3. expertVoice 专家口吻真伪：有机制、条件、指标、失败模式、工程边界与取舍，而不是模板腔或百科腔。
4. selfContained 自包含：正文是否足以回答它自己的 recallPrompts 和 rubric.mustHave。
5. interviewUsability 面试可用性：能否形成可复述的 30 秒结论、机制主线和追问边界；追问是否本题专属、答案是否到位。
6. difficultyFit 难度匹配：内容深度与 difficulty 标注是否一致（低难不注水、高难讲透机制与权衡）。
7. learnerClarity 可教会零基础：一个不懂的人能否真看懂——句子是否清晰、术语是否先解释、认知负荷是否过载。
8. coverage 面试覆盖完整性：按“这个 title / difficulty 的知识点，资深面试官真正会考什么”来判断关键面是否讲全。**严禁拿本篇自己的 rubric/recallPrompts 当标尺**（那是循环论证）；要按你对该知识点的专家认知判断有没有漏掉该讲的点。
9. seniorityDiscrimination 区分度天花板：判断这篇“能筛到哪个职级”。技术类 difficulty≥3 必须深到能区分资深（对标 P7），difficulty 4-5 必须到专家深度（P7+：源码级机制、架构权衡、极端规模、疑难定位）；非技术类按对应职业的资深纵深。只考“是什么/列举”、recallPrompts/followUpQuestions 缺“为什么这样设计而非另一种 / 线上如何排查 / 取舍 / 极端场景”深问的，本维给 ≤3。difficulty 1-2 的基础题只要诚实标注、紧凑不注水即给 4，不要求其区分资深。

硬性要求：
- score 用 0-100；任一维 <4，或存在 wrong/outdated 事实，verdict 必须为 fail。
- factFindings 至少 3 条，覆盖定义、机制、边界/失败路径等关键事实；wrong/outdated 的事实必须同时进 blockingFindings。
- followUpFindings 必须逐条评每个 interviewAnswer 的 followUpQuestion：isSpecific（是否本题专属、不泛化）、answerAdequate（答案是否到位），不达标给出 fix。
- clarityFindings / coverageFindings 指出零基础读者会卡住的地方、以及面试该讲却没讲的关键面。
- rubric.mustHave/goodToHave/commonMistakes 内嵌代码片段（throw new ...()、function、=>、带分号语句、缩进代码块）→ 判 fail 并进 blockingFindings；代码只该在 code 卡。
- diagram 是纯线性关键词链（无分支/汇合/状态转移）或终点为“面试结论/答题要点/总结”类汇聚节点 → 判为假图，压低 expertVoice 并在 voiceFindings 标记要求重画。
- 不要臆造；无法核验的事实标 suspicious 并在 evidence 说明原因。

输出 JSON schema（仅示意字段，值要按真实评审填）：
${JSON.stringify(schema, null, 2)}

待评审 topic JSON：
${JSON.stringify(topic, null, 2)}
${JSON_STRING_RULES}
`;
}

export function buildJudgeBatchPrompt(items) {
  const schema = {
    reviews: items.map(({ ref, topic }) => ({
      ref,
      title: topic.title,
      verdict: "pass | fail",
      score: 88,
      dimensions: Object.fromEntries(JUDGE_DIMENSIONS.map((d) => [d, 4])),
      factFindings: [
        { claim: "被核验的事实断言", verdict: "correct | wrong | suspicious | outdated", evidence: "核验依据或无法核验的原因" },
      ],
      orderFindings: [],
      voiceFindings: [],
      selfContainedFindings: [],
      clarityFindings: [],
      coverageFindings: [],
      followUpFindings: [],
      blockingFindings: [],
      notes: "",
    })),
  };
  return `你是独立的内容质量评审 agent，面向“零基础用户靠这一篇就能学会并拿去面试”的目标做审查。不要复用写作立场，只按事实和真实学习体验打分。

只返回一个 JSON 对象，第一个非空白字符是 {，最后一个是 }。不要解释、不要 Markdown 代码围栏。

请逐篇评审下面这些 topic，输出 reviews 数组，必须覆盖每一个输入 ref，不能遗漏、合并或新增 ref。

评审维度（dimensions 用 1-5 整数）：
${JUDGE_DIMENSIONS.map((d, index) => `${index + 1}. ${d}`).join("\n")}

硬性要求：
- score 用 0-100；任一维 <4，或存在 wrong/outdated 事实，verdict 必须为 fail。
- factFindings 每篇至少 3 条，覆盖定义、机制、边界/失败路径等关键事实；wrong/outdated 的事实必须同时进 blockingFindings。
- coverage 必须按“这个 title / difficulty 的知识点，资深面试官真正会考什么”判断，严禁拿本篇自己的 rubric/recallPrompts 当唯一标尺。
- seniorityDiscrimination 区分度天花板：技术类 difficulty≥3 必须能区分资深（对标 P7）、4-5 须到专家深度（P7+），非技术类按对应专家纵深；只考“是什么/列举”、缺“为什么这样设计/如何排查/取舍/极端场景”深问的给 ≤3；difficulty 1-2 基础题诚实标注即给 4。
- rubric.mustHave/goodToHave/commonMistakes 内嵌代码片段 → fail；diagram 是纯线性关键词链或终点为“面试结论/答题要点”类汇聚节点 → 判假图、压低 expertVoice。

输出 JSON schema（仅示意字段，值要按真实评审填）：
${JSON.stringify(schema, null, 2)}

待评审 topics JSON：
${JSON.stringify(items.map(({ ref, topic }) => ({ ref, topic })), null, 2)}
${JSON_STRING_RULES}
`;
}

export function buildBlockJudgePrompt({ ref, title, blocks }) {
  const schema = {
    ref,
    blockReviews: blocks.map((block) => ({
      key: block.key,
      verdict: "improved | same | regressed | blocking",
      reason: "为什么这个块相对旧版更好/无变化/退步/有阻断问题",
      fix: "如果 regressed/blocking，应如何修",
    })),
  };
  return `你是内容精修 keep-best 的块级判官。任务是比较“旧块”和“候选块”，判断候选块是否真的变好。

只返回一个 JSON 对象，第一个非空白字符是 {，最后一个是 }。不要解释、不要 Markdown 代码围栏。

判定口径：
- improved：候选块在事实正确性、清晰度、覆盖、面试可用性、具体性上至少一项明显更好，且没有明显退步。
- same：候选块只是改写措辞、移动格式，质量没有实质提升。
- regressed：候选块比旧块更泛、更绕、漏掉关键点、追问变弱，或破坏 explain 与 interviewAnswer 的衔接。
- blocking：候选块引入 wrong/outdated 事实、明显误导、结构损坏或与 topic 主题不一致。

要求：
- 每个输入 block 都必须返回一个同 key 的 blockReview。
- 如果发现事实错或候选追问答案不充分，优先判 blocking 或 regressed。
- 不要因为候选更长就判 improved；必须看有效信息和面试可用性。

输出 JSON schema：
${JSON.stringify(schema, null, 2)}

Topic：${ref} / ${title}

待比较 blocks：
${JSON.stringify(blocks, null, 2)}
${JSON_STRING_RULES}
`;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// 把单个判官原始输出规整成统一结构。verdict 只有显式 "pass" 才算 pass。
export function normalizeJudgeReview(parsed) {
  const dimensions = Object.fromEntries(JUDGE_DIMENSIONS.map((d) => [d, toInt(parsed?.dimensions?.[d])]));
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    verdict: parsed?.verdict === "pass" ? "pass" : "fail",
    score: toInt(parsed?.score),
    dimensions,
    factFindings: arr(parsed?.factFindings),
    orderFindings: arr(parsed?.orderFindings),
    voiceFindings: arr(parsed?.voiceFindings),
    selfContainedFindings: arr(parsed?.selfContainedFindings),
    clarityFindings: arr(parsed?.clarityFindings),
    coverageFindings: arr(parsed?.coverageFindings),
    followUpFindings: arr(parsed?.followUpFindings),
    blockingFindings: arr(parsed?.blockingFindings),
    notes: typeof parsed?.notes === "string" ? parsed.notes : "",
  };
}

export function normalizeJudgeBatchReviews(parsed, items) {
  const reviews = Array.isArray(parsed?.reviews) ? parsed.reviews : [];
  return items.map((item) => {
    const raw = reviews.find((review) => review?.ref === item.ref);
    if (!raw) throw new Error(`batch output missing review for ${item.ref}`);
    return { ref: item.ref, review: normalizeJudgeReview(raw) };
  });
}

export function normalizeBlockJudgeReview(parsed, blocks) {
  const rawReviews = Array.isArray(parsed?.blockReviews) ? parsed.blockReviews : [];
  const byKey = new Map(rawReviews.map((review) => [String(review?.key ?? ""), review]));
  return blocks.map((block) => {
    const raw = byKey.get(block.key);
    if (!raw) {
      return { key: block.key, verdict: "same", reason: "block judge missing this key", fix: "" };
    }
    const verdict = ["improved", "same", "regressed", "blocking"].includes(raw.verdict) ? raw.verdict : "same";
    return {
      key: block.key,
      verdict,
      reason: typeof raw.reason === "string" ? raw.reason : "",
      fix: typeof raw.fix === "string" ? raw.fix : "",
    };
  });
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 多判官聚合：分数/维度取中位数（抗单个判官抽风）；事实问题取并集（任一判官报错就保留）。
export function aggregateReviews(reviews) {
  if (!reviews.length) return null;
  if (reviews.length === 1) return { ...reviews[0], judgeCount: 1 };
  const dimensions = Object.fromEntries(
    JUDGE_DIMENSIONS.map((d) => [d, median(reviews.map((r) => toInt(r.dimensions?.[d])))]),
  );
  const factFindings = reviews.flatMap((r) => r.factFindings);
  const blockingFindings = reviews.flatMap((r) => r.blockingFindings);
  // 任一判官 fail 则聚合 fail（保守，符合“宁可不退步”）。
  const verdict = reviews.every((r) => r.verdict === "pass") ? "pass" : "fail";
  return {
    verdict,
    score: median(reviews.map((r) => r.score)),
    dimensions,
    factFindings,
    orderFindings: reviews.flatMap((r) => r.orderFindings),
    voiceFindings: reviews.flatMap((r) => r.voiceFindings),
    selfContainedFindings: reviews.flatMap((r) => r.selfContainedFindings),
    clarityFindings: reviews.flatMap((r) => r.clarityFindings),
    coverageFindings: reviews.flatMap((r) => r.coverageFindings),
    followUpFindings: reviews.flatMap((r) => r.followUpFindings),
    blockingFindings,
    notes: reviews.map((r) => r.notes).filter(Boolean).join(" | "),
    judgeCount: reviews.length,
  };
}

// 事实问题数：factFindings 里 wrong/outdated + blockingFindings（并集思路，取较保守的计数）。
export function factProblemCount(review) {
  if (!review) return 0;
  const factWrong = (review.factFindings ?? []).filter((f) => FACT_PROBLEM_VERDICTS.has(String(f?.verdict).toLowerCase())).length;
  const blocking = (review.blockingFindings ?? []).length;
  return Math.max(factWrong, blocking);
}

// 判官判定“已经够好”：分数达线 + 每维 ≥ 地板 + 无事实问题。用于“已达标则不浪费改写”。
export function judgePasses(review, dynamicSkipMin) {
  if (!review) return false;
  if (review.score < dynamicSkipMin) return false;
  if (factProblemCount(review) > 0) return false;
  return JUDGE_DIMENSIONS.every((d) => toInt(review.dimensions?.[d]) >= DIMENSION_FLOOR);
}

// 接受候选的“回归向量”判据（不拿总分当唯一开关，避免误杀“部分更好但总分波动”的候选）：
//   - 静态分 ≥ 90（⟹ 静态各维不跌破地板，硬规则未破）
//   - 没有引入新的事实问题（after 的 wrong/outdated 计数 ≤ before）
//   - 动态每一维都不低于 before（不许“修一块、坏一块”）
//   - 且至少一处改善（某维↑ / 动态总分↑ / 事实问题↓ / 静态分↑）
export function acceptByJudge({ before, after, staticBefore, staticAfter, minStatic = 90 }) {
  const reasons = [];
  if (staticAfter < minStatic) return { accept: false, reason: `静态分 ${staticAfter} < ${minStatic} 地板` };
  if (factProblemCount(after) > factProblemCount(before)) {
    return { accept: false, reason: `引入了新的事实问题（${factProblemCount(before)} -> ${factProblemCount(after)}）` };
  }
  for (const d of JUDGE_DIMENSIONS) {
    const b = toInt(before?.dimensions?.[d]);
    const a = toInt(after?.dimensions?.[d]);
    if (a < b) return { accept: false, reason: `维度 ${d} 退步（${b} -> ${a}）` };
  }
  const dimUp = JUDGE_DIMENSIONS.some((d) => toInt(after?.dimensions?.[d]) > toInt(before?.dimensions?.[d]));
  const scoreUp = toInt(after?.score) > toInt(before?.score);
  const factDown = factProblemCount(after) < factProblemCount(before);
  const staticUp = staticAfter > staticBefore;
  if (dimUp) reasons.push("维度↑");
  if (scoreUp) reasons.push("动态分↑");
  if (factDown) reasons.push("事实问题↓");
  if (staticUp) reasons.push("静态分↑");
  if (!(dimUp || scoreUp || factDown || staticUp)) {
    return { accept: false, reason: "无任何改善（维度/动态分/事实/静态分都没变好）" };
  }
  return { accept: true, reason: reasons.join("+") };
}

// 把判官 findings 压成喂给改写 prompt 的“块级缺口清单”，驱动“每一块更精准”。
export function findingsToPromptLines(review) {
  if (!review) return [];
  const lines = [];
  for (const f of review.factFindings ?? []) {
    const v = String(f?.verdict ?? "").toLowerCase();
    if (v === "wrong" || v === "outdated" || v === "suspicious") {
      lines.push(`【事实(${v})】${f.claim ?? ""}${f.evidence ? `（依据：${f.evidence}）` : ""}`);
    }
  }
  for (const f of review.followUpFindings ?? []) {
    if (f && (f.isSpecific === false || f.answerAdequate === false)) {
      lines.push(`【追问】「${f.question ?? ""}」${f.isSpecific === false ? "不够本题专属；" : ""}${f.answerAdequate === false ? "答案不到位；" : ""}${f.fix ? `建议：${f.fix}` : ""}`);
    }
  }
  for (const f of review.orderFindings ?? []) lines.push(`【认知顺序】${f.where ?? ""}：${f.issue ?? ""}${f.fix ? `（${f.fix}）` : ""}`);
  for (const f of review.voiceFindings ?? []) lines.push(`【专家口吻】${f.where ?? ""}：${f.issue ?? ""}${f.fix ? `（${f.fix}）` : ""}`);
  for (const f of review.selfContainedFindings ?? []) lines.push(`【自包含】${f.where ?? ""}：${f.issue ?? ""}${f.fix ? `（${f.fix}）` : ""}`);
  for (const f of review.clarityFindings ?? []) lines.push(`【可读性】${f.where ?? ""}：${f.issue ?? ""}${f.fix ? `（${f.fix}）` : ""}`);
  for (const f of review.coverageFindings ?? []) lines.push(`【覆盖缺口】${f.missingPoint ?? ""}${f.why ? `（${f.why}）` : ""}`);
  return lines;
}

// ===== 3 个 API 模式 strict JSON schema（response_format=json_schema 用）=====
// 顶层 additionalProperties:false + required 钉全键；嵌套容错 additionalProperties:true。
// 数组元素是 object 时按 schemaForArrayItems 合并异构 key。
// 这些 schema 由 quality_refine.mjs 通过 runRefine/runJudge/runBlockJudge 传给 LLM。

function _jProp(type, description) {
  return { type, description };
}

function _jNum(min, max) {
  const s = { type: "integer" };
  if (min !== undefined) s.minimum = min;
  if (max !== undefined) s.maximum = max;
  return s;
}

function _jArr(itemSchema) {
  return { type: "array", items: itemSchema };
}

// 数组元素是 object 时合并所有元素的 key（异构 key 合并）。
function _jHeterogeneousArr(examples) {
  const keys = new Map();
  for (const ex of examples) {
    for (const k of Object.keys(ex)) {
      if (!keys.has(k)) {
        keys.set(k, { type: ["string", "null", "number", "boolean", "array", "object"] });
      } else {
        // 简化：保留第一条遇到的 schema（API 模式够用；normalize 层做严校验）
      }
    }
  }
  const props = Object.fromEntries(keys);
  return { type: "array", items: { type: "object", properties: props, additionalProperties: true } };
}

// 9 维 dimensions schema。
function _jDimensionsSchema() {
  return {
    type: "object",
    properties: Object.fromEntries(JUDGE_DIMENSIONS.map((d) => [d, _jNum(1, 5)])),
    required: [...JUDGE_DIMENSIONS],
    additionalProperties: true,
  };
}

// 单篇评审 schema。顶层钉全键 + additionalProperties:false。
// 这是新版本（API 模式）替换旧的 QWEN_JUDGE_SCHEMA。
export const JUDGE_REVIEW_SCHEMA = (() => {
  const factEx = { claim: "被核验的事实断言", verdict: "wrong", evidence: "核验依据" };
  const orderEx = { where: "卡片标题", issue: "问题", fix: "如何修" };
  const voiceEx = { where: "卡片标题", issue: "模板腔", fix: "本题专属表达" };
  const selfEx = { where: "recallPrompt 或 rubric.mustHave", issue: "正文未覆盖", fix: "应补什么" };
  const clarityEx = { where: "卡片标题或段落", issue: "零基础卡点", fix: "如何讲清" };
  const coverageEx = { missingPoint: "面试该讲却没讲到的关键面", why: "为什么面试需要它" };
  const followUpEx = { question: "原追问文案", isSpecific: true, answerAdequate: true, fix: "若不够如何修" };
  const blockingEx = { reason: "导致 fail 的硬问题" };

  return {
    type: "object",
    properties: {
      ref: _jProp("string", "topic 文件相对路径（保留原样）"),
      title: _jProp("string", "topic 标题"),
      verdict: { type: "string", enum: ["pass", "fail"] },
      score: _jNum(0, 100),
      dimensions: _jDimensionsSchema(),
      factFindings: _jHeterogeneousArr([factEx]),
      orderFindings: _jHeterogeneousArr([orderEx]),
      voiceFindings: _jHeterogeneousArr([voiceEx]),
      selfContainedFindings: _jHeterogeneousArr([selfEx]),
      clarityFindings: _jHeterogeneousArr([clarityEx]),
      coverageFindings: _jHeterogeneousArr([coverageEx]),
      followUpFindings: _jHeterogeneousArr([followUpEx]),
      blockingFindings: _jHeterogeneousArr([blockingEx]),
      notes: _jProp("string", "评审附加说明"),
    },
    required: [
      "ref",
      "title",
      "verdict",
      "score",
      "dimensions",
      "factFindings",
      "orderFindings",
      "voiceFindings",
      "selfContainedFindings",
      "clarityFindings",
      "coverageFindings",
      "followUpFindings",
      "blockingFindings",
      "notes",
    ],
    additionalProperties: false,
  };
})();

// 批量评审 schema。reviews 数组元素同 JUDGE_REVIEW_SCHEMA 形状。
export const QWEN_JUDGE_BATCH_SCHEMA = (() => {
  return {
    type: "object",
    properties: {
      reviews: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: _jProp("string", "topic 文件相对路径"),
            title: _jProp("string", "topic 标题"),
            verdict: { type: "string", enum: ["pass", "fail"] },
            score: _jNum(0, 100),
            dimensions: _jDimensionsSchema(),
            factFindings: _jHeterogeneousArr([{ claim: "事实", verdict: "correct", evidence: "依据" }]),
            orderFindings: _jHeterogeneousArr([{ where: "位置", issue: "问题", fix: "如何修" }]),
            voiceFindings: _jHeterogeneousArr([{ where: "位置", issue: "问题", fix: "如何修" }]),
            selfContainedFindings: _jHeterogeneousArr([{ where: "位置", issue: "问题", fix: "如何修" }]),
            clarityFindings: _jHeterogeneousArr([{ where: "位置", issue: "问题", fix: "如何修" }]),
            coverageFindings: _jHeterogeneousArr([{ missingPoint: "缺失面", why: "原因" }]),
            followUpFindings: _jHeterogeneousArr([{ question: "追问", isSpecific: true, answerAdequate: true, fix: "修法" }]),
            blockingFindings: _jHeterogeneousArr([{ reason: "阻断原因" }]),
            notes: _jProp("string", "评审说明"),
          },
          required: [
            "ref",
            "title",
            "verdict",
            "score",
            "dimensions",
            "factFindings",
            "orderFindings",
            "voiceFindings",
            "selfContainedFindings",
            "clarityFindings",
            "coverageFindings",
            "followUpFindings",
            "blockingFindings",
            "notes",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["reviews"],
    additionalProperties: false,
  };
})();

// 块级评审 schema。blockReviews 数组元素：key / verdict / reason / fix。
export const QWEN_BLOCK_JUDGE_SCHEMA = (() => {
  return {
    type: "object",
    properties: {
      ref: _jProp("string", "topic 文件相对路径"),
      blockReviews: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: _jProp("string", "块的稳定 key（与输入对齐）"),
            verdict: { type: "string", enum: ["improved", "same", "regressed", "blocking"] },
            reason: _jProp("string", "判定理由"),
            fix: _jProp("string", "如何修（regressed/blocking 时必填）"),
          },
          required: ["key", "verdict", "reason", "fix"],
          additionalProperties: false,
        },
      },
    },
    required: ["ref", "blockReviews"],
    additionalProperties: false,
  };
})();
