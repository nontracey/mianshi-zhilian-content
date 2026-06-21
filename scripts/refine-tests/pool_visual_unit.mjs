import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TaskQueue, AutoScalingSemaphore } from "../llm/task-queue.mjs";
import { buildVisualReview } from "../quality_visual_judge.mjs";
import { envConfig } from "../llm/env-config.mjs";
import { costTracker, estimateImageTokens, BUILTIN_PRICES } from "../llm/cost-tracker.mjs";
import { stripTags, extractMainText } from "../web/fetch.mjs";

let pass = 0;
let fail = 0;
function check(name, ok) {
  if (ok) {
    console.log(`  ✓ ${name}`);
    pass += 1;
  } else {
    console.error(`  ✗ ${name}`);
    fail += 1;
  }
}

console.log("=== TaskQueue concurrency ===");
{
  const queue = new TaskQueue({ concurrency: 2, label: "unit" });
  let active = 0;
  let maxActive = 0;
  await Promise.all(Array.from({ length: 8 }, () => queue.run(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  })));
  check("最多同时运行 2 个任务", maxActive === 2);
  check("任务全部释放", queue.snapshot().active === 0 && queue.snapshot().queued === 0);
}

console.log("\n=== AutoScalingSemaphore ===");
{
  const sem = new AutoScalingSemaphore({ min: 1, max: 5, targetLatencyMs: 100, errorBackoffMs: 1000, label: "scale" });
  check("初始 limit=1", sem.limit === 1);
  for (let i = 0; i < 3; i++) sem.recordSuccess(50);
  check("3 次快速成功后 limit=2", sem.limit === 2);
  sem.recordError("quota");
  sem.recordError("quota");
  check("2 次 quota 后 limit=1", sem.limit === 1);
  check("cooldownUntil > now", sem.cooldownUntil > Date.now());
  // 边界：limit 不能超过 max
  const sem2 = new AutoScalingSemaphore({ min: 1, max: 2, targetLatencyMs: 100, label: "cap" });
  for (let i = 0; i < 6; i++) sem2.recordSuccess(10);
  check("limit 不超过 max=2", sem2.limit <= 2);
}

console.log("\n=== 多账号轮询 + 冷却 ===");
{
  // 通过 envConfig 测：单 apiKeyEnv 被包成 default account
  const m = envConfig.findModel("zhipu:glm-4.7-flash");
  check("单 apiKeyEnv 包成 default account", m.accounts.length === 1 && m.accounts[0].id === "default");
  // 冷却：标失败后再 resolve 仍能用（单账号 fallback 到冷却到期最早）
  envConfig.markAccountFailure("zhipu:glm-4.7-flash", "default", 5000);
  const snap = envConfig.accountCooldownSnapshot();
  check("accountCooldownSnapshot 记录冷却中", snap.length === 1 && snap[0].key === "zhipu:glm-4.7-flash|default");
  envConfig.markAccountSuccess("zhipu:glm-4.7-flash", "default");
  check("markAccountSuccess 后冷却清空", envConfig.accountCooldownSnapshot().length === 0);
}

console.log("\n=== 模型 modality / imageUnderstanding 推断 ===");
{
  const glm = envConfig.findModel("zhipu:glm-4.7-flash");
  check("GLM-4.7-Flash modality 含 text/json", glm.modality.includes("text") && glm.modality.includes("json"));
  check("GLM-4.7-Flash imageUnderstanding=none（无 image）", glm.imageUnderstanding === "none");
  check("GLM-4.7-Flash tier=free autoScale.enabled=true", glm.tier === "free" && glm.autoScale.enabled);
  const longcat = envConfig.findModel("longcat:LongCat-2.0-Preview");
  check("LongCat 1M 上下文声明", longcat.maxContext === 1000000 && longcat.maxOutputTokens === 131072);
  check("pickFreeModels 挑出免费模型", envConfig.pickFreeModels(["zhipu:glm-4.7-flash", "longcat:LongCat-2.0-Preview"]).length === 2);
}

console.log("\n=== 人类可编辑模型/MCP 配置 ===");
{
  const envBackup = { ...process.env };
  const injectedEnv = {
    LLM_CUSTOM_MODELS: "unit_local,unit_free",
    LLM_MODEL_UNIT_LOCAL_PROVIDER: "unit-local",
    LLM_MODEL_UNIT_LOCAL_ID: "qwen-test:14b",
    LLM_MODEL_UNIT_LOCAL_BASE_URL: "http://127.0.0.1:11434/v1",
    LLM_MODEL_UNIT_LOCAL_API_KEY_OPTIONAL: "true",
    LLM_MODEL_UNIT_LOCAL_LOCAL: "true",
    LLM_MODEL_UNIT_LOCAL_TIER: "local",
    LLM_MODEL_UNIT_LOCAL_MODALITY: "text,json",
    LLM_MODEL_UNIT_LOCAL_MAX_CONTEXT: "32768",
    LLM_MODEL_UNIT_LOCAL_MAX_OUTPUT_TOKENS: "8192",
    LLM_MODEL_UNIT_FREE_PROVIDER: "unit-free",
    LLM_MODEL_UNIT_FREE_ID: "glm-test",
    LLM_MODEL_UNIT_FREE_BASE_URL: "https://example.test/v1",
    LLM_MODEL_UNIT_FREE_API_KEY_ENV: "UNIT_FREE_KEY",
    LLM_MODEL_UNIT_FREE_TIER: "free",
    LLM_MODEL_UNIT_FREE_ACCOUNTS: "a,b",
    LLM_MODEL_UNIT_FREE_ACCOUNT_A_API_KEY_ENV: "UNIT_FREE_KEY_A",
    LLM_MODEL_UNIT_FREE_ACCOUNT_A_WEIGHT: "2",
    LLM_MODEL_UNIT_FREE_ACCOUNT_B_API_KEY_ENV: "UNIT_FREE_KEY_B",
    LLM_MODEL_UNIT_FREE_IMAGE_UNDERSTANDING: "mcp",
    LLM_MODEL_UNIT_FREE_PRICE_INPUT_PER_MTOK: "0.1",
    LLM_MODEL_UNIT_FREE_PRICE_OUTPUT_PER_MTOK: "0.2",
    MCP_SERVERS: "agnes",
    MCP_SERVER_AGNES_COMMAND: "node",
    MCP_SERVER_AGNES_ARGS: "scripts/mcp/agnes-image-server.mjs,--unit",
    MCP_SERVER_AGNES_TIMEOUT_MS: "90000",
  };
  Object.assign(process.env, injectedEnv);
  envConfig.reload();
  const local = envConfig.findModel("unit-local:qwen-test:14b");
  check("LLM_CUSTOM_MODELS 可注册本地模型", local?.local === true && local.apiKeyOptional === true);
  check("分组模型读取 modality/maxContext", local.modality.includes("json") && local.maxContext === 32768);
  const free = envConfig.findModel("unit-free:glm-test");
  check("分组模型读取多账号", free.accounts.length === 2 && free.accounts[0].weight === 2);
  check("分组模型读取价格/视觉模式", free.pricePerMtok.input === 0.1 && free.imageUnderstanding === "mcp");
  const { __serverConfigsForTest } = await import("../mcp/registry.mjs");
  const mcpConfigs = __serverConfigsForTest();
  check("MCP_SERVERS 分组配置可注册 server", mcpConfigs.some((cfg) => (
    cfg.name === "agnes"
    && cfg.command === "node"
    && cfg.args[0] === "scripts/mcp/agnes-image-server.mjs"
    && cfg.timeoutMs === 90000
  )));
  for (const key of Object.keys(injectedEnv)) delete process.env[key];
  Object.assign(process.env, envBackup);
  envConfig.reload();
}

console.log("\n=== 内置价格表 + 成本统计 ===");
{
  costTracker.reset();
  check("GLM-4.7-Flash 内置零成本", BUILTIN_PRICES["zhipu:glm-4.7-flash"].input === 0);
  check("LongCat 内置零成本", BUILTIN_PRICES["longcat:LongCat-2.0-Preview"].output === 0);
  // 1x1 PNG token 估算
  const pngTokens = estimateImageTokens("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==");
  check("1x1 PNG token=255（1 tile * 170 + 85 base）", pngTokens === 255);
  // record + summary
  costTracker.record({ spec: "zhipu:glm-4.7-flash", accountId: "default", kind: "refine", inputTokens: 1000, outputTokens: 500, durationMs: 2000, tier: "free" });
  costTracker.record({ spec: "ollama:qwen2.5:14b", accountId: "default", kind: "refine", inputTokens: 800, outputTokens: 300, durationMs: 5000, tier: "local" });
  const sum = costTracker.summary();
  check("summary.calls=2", sum.calls === 2);
  check("本地模型 cost=0", sum.cost.bySpec.find((s) => s.isLocal)?.cost === 0);
  check("本地 GPU 时间累加 5s", sum.cost.localGpuSeconds === 5);
  check("bySpec 含 zhipu:glm-4.7-flash", sum.cost.bySpec.some((s) => s.spec === "zhipu:glm-4.7-flash"));
  // 预算超限
  costTracker.setBudget({ maxCostPerRun: 0.0001 });
  costTracker.setBudget({ maxTokensPerRun: 1000 });
  costTracker.record({ spec: "zhipu:glm-4.7-flash", accountId: "default", kind: "refine", inputTokens: 100000, outputTokens: 50000, durationMs: 2000, tier: "free" });
  check("token 预算超限触发 exceeded=true", costTracker.exceeded === true);
}

console.log("\n=== 内置 web 工具：stripTags / extractMainText ===");
{
  const html = '<html><head><title>Test</title></head><body><p>Hello <b>world</b></p><script>bad()</script></body></html>';
  check("stripTags 去脚本+标签", stripTags(html) === "Hello world");
  const html2 = '<div><p>This is paragraph one with enough text to be kept as main content for testing.</p><p>Second paragraph also long enough to pass the threshold check.</p></div>';
  const main = extractMainText(html2);
  check("extractMainText 抽取段落", main.includes("paragraph one") && main.includes("Second paragraph"));
}

console.log("\n=== 内置搜索：Baidu HTML 解析 ===");
{
  // 注意：searchBaidu 有「页面 <5000 字符即判 CAPTCHA」的启发式守卫，fixture 必须够长才不被误判。
  const baiduFiller = `<!-- ${"x".repeat(5200)} -->`;
  const baiduHtml = `<html><body>${baiduFiller}<div class="result"><h3><a href="http://example.com/1">Result One</a></h3><div class="c-abstract">First snippet here</div></div><div class="result"><h3><a href="http://example.com/2">Result Two</a></h3><div class="c-abstract">Second snippet</div></div></body></html>`;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => baiduHtml, headers: new Map() });
  const { searchBaidu } = await import("../web/search.mjs");
  const results = await searchBaidu("test query", { num: 2 });
  check("Baidu 解析返回 2 条", results.length === 2);
  check("Baidu 第一条标题正确", results[0].title === "Result One");
  check("Baidu source 标记", results[0].source === "baidu");
  globalThis.fetch = origFetch;
}

console.log("\n=== visual static QA ===");
const priorVisionJudgeEnabled = process.env.VISION_JUDGE_ENABLED;
process.env.VISION_JUDGE_ENABLED = "false";
envConfig.reload();
const svgPath = "assets/diagrams/__visual-unit-overlap.svg";
const abs = path.join(process.cwd(), svgPath);
await mkdir(path.dirname(abs), { recursive: true });
try {
  await writeFile(abs, `<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
  <text x="20" y="40" font-size="12">first label</text>
  <text x="22" y="44" font-size="12">second label</text>
</svg>`);
  const topic = {
    id: "unit.visual",
    title: "视觉单测",
    domain: "algorithm",
    category: "unit",
    difficulty: 3,
    summary: "检查静态视觉 QA。",
    tags: ["SVG"],
    learningCards: [
      {
        type: "diagram",
        title: "重叠图",
        sources: [{ kind: "svg", path: svgPath }, { kind: "text", content: "图解展示两个标签重叠的坏例子。" }],
        fallback: "图解展示两个标签重叠的坏例子。",
      },
    ],
  };
  const review = await buildVisualReview(topic, "unit.visual");
  check("重叠 SVG 被判 fail", review.visualFit === "fail");
  check("包含重叠发现", review.findings.some((finding) => /重叠/.test(finding.issue ?? "")));

  const inlineTopic = {
    ...topic,
    learningCards: [
      {
        type: "diagram",
        title: "内联重叠图",
        format: "svg",
        sources: [
          {
            kind: "svg",
            content: `<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
              <text x="20" y="40" font-size="12">first label</text>
              <text x="22" y="44" font-size="12">second label</text>
            </svg>`,
          },
          { kind: "text", content: "图解展示两个标签重叠的内联 SVG 坏例子。" },
        ],
        fallback: "图解展示两个标签重叠的内联 SVG 坏例子。",
      },
    ],
  };
  const inlineReview = await buildVisualReview(inlineTopic, "unit.visual.inline");
  check("内联 SVG 也会被静态视觉 QA 检查", inlineReview.visualFit === "fail");
  check("内联 SVG 产出 artifact", inlineReview.artifacts.some((artifact) => artifact.path.includes("inline")));
} finally {
  await rm(abs, { force: true });
  if (priorVisionJudgeEnabled == null) delete process.env.VISION_JUDGE_ENABLED;
  else process.env.VISION_JUDGE_ENABLED = priorVisionJudgeEnabled;
  envConfig.reload();
}

console.log(`\n=== pool/visual unit: PASS=${pass} FAIL=${fail} ===`);
process.exit(fail ? 1 : 0);
