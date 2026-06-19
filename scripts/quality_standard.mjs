// Single source for the long-lived content quality contract used by docs,
// deterministic audits and the LLM refiner prompts. Keep this file small:
// executable checks live in the audit/refine scripts, while this module fixes
// the shared terminology and hard policy text so prompts do not drift.

export const CONTENT_STANDARD_VERSION = "knowledge-content-standard-v1.1";
export const PRODUCTION_STRICT_MIN_SCORE = 95;

export const JUDGE_DIMENSIONS = [
  "accuracy",
  "cognitiveOrder",
  "expertVoice",
  "selfContained",
  "interviewUsability",
  "difficultyFit",
  "learnerClarity",
  "coverage",
  "seniorityDiscrimination",
];

export const DIMENSION_FLOOR = 4;

export const DIAGRAM_FORMATS = ["svg", "mermaid", "compareTable", "code", "text", "none"];
export const DIAGRAM_VISUAL_FITS = ["pass", "fail", "not_checked"];

export const DIAGRAM_MODALITY_FINDING_EXAMPLE = {
  currentBestFormat: "svg | mermaid | compareTable | code | text | none",
  recommendedFormat: "svg | mermaid | compareTable | code | text | none",
  isCurrentFormatFit: true,
  isCandidateDowngrade: false,
  visualFit: "pass | fail | not_checked",
  reason: "为什么当前/候选图解形态适合或不适合这个 topic",
  requiredFix: "如果不适合，应改成 SVG、Mermaid、compareTable、code/text 还是不需要图",
};

export const DIAGRAM_MODALITY_POLICY = `
【图解形态适配规则（diagram modality）】
1. SVG、Mermaid、compareTable 都不是天然高级或低级；只按“这个 topic 的机制用哪种表达让用户最低成本看懂”判断。
2. 不是每个 topic 都必须有 SVG、Mermaid 或其他 diagram；当文字、代码卡或 compareTable 已经能低成本讲清时，recommendedFormat 可以是 code、compareTable、text 或 none。
3. SVG 更适合表现真实空间/状态形态：算法数组窗口、双指针移动、DP 表、矩阵、树/图遍历 frontier、堆、链表指针变化、多面板步骤、JVM/缓存/索引/内存引用链、网络包结构等。
4. Mermaid 更适合结构关系：sequenceDiagram 表达协议/参与者交互，stateDiagram 表达状态机，flowchart/graph+subgraph 表达架构边界、调用链、数据流。
5. compareTable 更适合概念对比、分类边界和方案选型；不要为了“有图”把对比题硬画成流程图。
6. 不得无脑把所有图都升级成 SVG；如果 SVG 只是 Mermaid 节点换皮、没有额外信息、文字过密或移动端看不清，应改用 Mermaid/compareTable/text，或在不需要图时移除图解。
7. 不得无脑把已有 SVG 降级成 Mermaid；如果原 SVG 表达了空间结构、步骤状态或数据结构细节，候选替换为 Mermaid 必须证明没有丢信息且可读性/维护性更好，否则视为图解退化。
8. 算法图解一旦存在，就必须体现题目真实结构和过程，不能复用“四个节点换名字”的模板图；边和布局必须承载窗口移动、状态转移、递归/回溯展开、DP 填表、堆/队列变化或图遍历 frontier 等真实信息。
9. 只要使用 diagram 或 animation，就必须提供可读的 fallback、caption 或 text source 兜底；sources 使用 SVG 时，还必须保留 mermaid 或 text 降级链，不能只有 svg path 让渲染失败后用户完全看不懂。
`;

export const DIAGRAM_VISUAL_POLICY = `
【图解视觉质量规则】
1. 文本模型不能假装“看见” SVG 或渲染后的 Mermaid；它只能评估源码、节点语义、caption/fallback 与 topic 的贴合度。
2. 重叠、裁切、空白、显示不全、文字过密、字号过小、边线压字等视觉问题必须由渲染 QA 或视觉模型评估；没有视觉报告时 visualFit 应标 not_checked。
3. 一旦有渲染 QA 指出空白、裁切、节点/文字重叠或移动端不可读，候选必须 fail 或要求重画，不能只靠文字判官放行。
`;

export function diagramPolicyPrompt() {
  return `${DIAGRAM_MODALITY_POLICY}\n${DIAGRAM_VISUAL_POLICY}`.trim();
}
