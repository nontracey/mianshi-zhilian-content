// llm-rewrite 配置：加载 .env、解析改写模型端点。
// 改写模型 = OpenAI 兼容 /chat/completions。MiMo key 一到，填 LLM_REWRITE_* 即可。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REWRITE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(REWRITE_DIR, "..", "..");

// 极简 .env 解析（KEY=VALUE，不覆盖已存在的真实环境变量）。
export function loadDotenv(file = path.join(REPO_ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

// 已在 .env 里配好的现成 OpenAI 兼容 provider，可作改写模型的临时替身（验证管线 / 质量预览）。
// 注意：端点/model 在 loadDotenv() 之后惰性读取，避免模块加载早于 .env 加载。
function knownProviders() {
  return {
    xfyun: { baseUrl: "https://maas-api.cn-huabei-1.xf-yun.com/v2", model: "xopqwen36v35b", apiKeyEnv: "XF_MAAS_API_KEY" },
    zhipu: { baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.7-flash", apiKeyEnv: "ZHIPU_API_KEY" },
    longcat: { baseUrl: "https://api.longcat.chat/openai", model: "LongCat-2.0-Preview", apiKeyEnv: "LONGCAT_API_KEY" },
    // MiMo：key 未配置时 baseUrl 为空，resolveModel 会报错提示补 key。
    mimo: { baseUrl: process.env.MIMO_BASE_URL || "", model: process.env.MIMO_MODEL || "mimo-v2.5", apiKeyEnv: "MIMO_API_KEY" },
  };
}

// 解析最终使用的改写端点。优先级：显式 LLM_REWRITE_* > --provider 快捷映射。
export function resolveModel({ provider } = {}) {
  loadDotenv();
  const KNOWN_PROVIDERS = knownProviders();
  // 1) 显式 LLM_REWRITE_*（推荐：MiMo key 到位后填这三个）
  if (process.env.LLM_REWRITE_API_KEY && process.env.LLM_REWRITE_BASE_URL && process.env.LLM_REWRITE_MODEL) {
    return {
      name: process.env.LLM_REWRITE_MODEL,
      baseUrl: process.env.LLM_REWRITE_BASE_URL.replace(/\/$/, ""),
      apiKey: process.env.LLM_REWRITE_API_KEY,
      model: process.env.LLM_REWRITE_MODEL,
      maxTokens: Number(process.env.LLM_REWRITE_MAX_TOKENS || 16384),
    };
  }
  // 2) --provider 快捷映射到 .env 现成 provider
  const p = KNOWN_PROVIDERS[provider];
  if (p && p.baseUrl && p.model && process.env[p.apiKeyEnv]) {
    return {
      name: `${provider}:${p.model}`,
      baseUrl: p.baseUrl.replace(/\/$/, ""),
      apiKey: process.env[p.apiKeyEnv],
      model: p.model,
      maxTokens: Number(process.env.LLM_REWRITE_MAX_TOKENS || 16384),
    };
  }
  const hint = provider === "mimo" || !provider
    ? "MiMo 未配置 key。请在 .env 设 MIMO_API_KEY/MIMO_BASE_URL/MIMO_MODEL，或直接设 LLM_REWRITE_API_KEY/LLM_REWRITE_BASE_URL/LLM_REWRITE_MODEL。"
    : `provider=${provider} 不可用（缺 baseUrl/model/${p?.apiKeyEnv || "apiKey"}）。`;
  throw new Error(hint + " 或用 --mock 验证管线（不调用 API）。");
}

export const DEFAULTS = {
  concurrency: Number(process.env.LLM_REWRITE_CONCURRENCY || 8),
  maxRetries: 4,
  retryBaseMs: 1500,
  requestTimeoutMs: Number(process.env.LLM_REWRITE_TIMEOUT_MS || 180000),
  temperature: Number(process.env.LLM_REWRITE_TEMPERATURE || 0.4),
};
