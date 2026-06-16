// scripts/llm/env-config.mjs
// 模型清单 + .env 加载 + 端点索引
// 模型清单硬编码(从 ~/.qwen/settings.json 提取,只保留 OpenAI 兼容端点),
// 实际 API key 走 .env(apiKeyEnv 字段指向 .env 里的 key 名)。
// .env 解析无依赖,自己实现;不支持 quoted multi-line,够用。

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// ===== 模型清单 =====
// value=id(端点真实 model 字段,带空格/中文会 400),label=name(人看)。
// 重复 id 靠 provider(host)区分——和 discover_models 旧协议一致。
// 火山(HUOSHAN_API_KEY + ark.cn-beijing.volces.com/api/coding/v3)4 个模型全列。
const MODELS = [
  // 火山(豆包方舟 coding v3 端点)
  { id: "deepseek-v4-flash", name: "火山 deepseek-v4-flash", provider: "volcengine", apiKeyEnv: "HUOSHAN_API_KEY", baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3" },
  { id: "deepseek-v4-pro", name: "火山 deepseek-v4-pro", provider: "volcengine", apiKeyEnv: "HUOSHAN_API_KEY", baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3" },
  { id: "glm-5.1", name: "火山 glm-5.1", provider: "volcengine", apiKeyEnv: "HUOSHAN_API_KEY", baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3", reasoning: true, reasoningEffort: "low" },
  { id: "minimax-m3", name: "火山 minimax-m3", provider: "volcengine", apiKeyEnv: "HUOSHAN_API_KEY", baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3" },
  // LongCat
  { id: "LongCat-2.0-Preview", name: "LongCat 2.0 Preview", provider: "longcat", apiKeyEnv: "LONGCHAT_API_KEY", baseUrl: "https://api.longcat.chat/openai" },
  // DeepSeek 官方
  { id: "deepseek-v4-flash", name: "DP DeepSeek V4 Flash", provider: "deepseek", apiKeyEnv: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/v1" },
  { id: "deepseek-v4-pro", name: "DP DeepSeek V4 Pro", provider: "deepseek", apiKeyEnv: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/v1" },
  // 百度千帆
  { id: "deepseek-v4-flash", name: "百度 deepseek-v4-flash", provider: "baidu", apiKeyEnv: "BAIDU_API_KEY", baseUrl: "https://qianfan.baidubce.com/v2/coding" },
  { id: "glm-5", name: "GLM 5 (百度)", provider: "baidu", apiKeyEnv: "BAIDU_API_KEY", baseUrl: "https://qianfan.baidubce.com/v2/coding" },
  { id: "glm-5.1", name: "GLM 5.1 (百度)", provider: "baidu", apiKeyEnv: "BAIDU_API_KEY", baseUrl: "https://qianfan.baidubce.com/v2/coding", reasoning: true, reasoningEffort: "low" },
  // 小米 MiMo
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", provider: "mimo", apiKeyEnv: "MIMO_API_KEY", baseUrl: "https://token-plan-cn.xiaomimimo.com/v1" },
  // OpenCode Go
  { id: "glm-5.1", name: "OpenCode Go GLM 5.1", provider: "opencode", apiKeyEnv: "OPENCODE_API_KEY", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, reasoningEffort: "low" },
  { id: "deepseek-v4-pro", name: "OpenCode Go DeepSeek V4 Pro", provider: "opencode", apiKeyEnv: "OPENCODE_API_KEY", baseUrl: "https://opencode.ai/zen/go/v1" },
];

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

let _envCache = null;
function loadEnv() {
  if (_envCache) return _envCache;
  const out = { ...process.env };
  // 仓库根 .env(已在 .gitignore)
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    Object.assign(out, parseEnvFile(readFileSync(envPath, "utf8")));
  }
  _envCache = out;
  return out;
}

function getEnv(key, fallback) {
  const v = loadEnv()[key];
  if (v == null || v === "") return fallback;
  return v;
}

function listModels({ hasKey = false } = {}) {
  if (!hasKey) return MODELS.slice();
  return MODELS.filter((m) => Boolean(getEnv(m.apiKeyEnv)));
}

function findModel(spec) {
  // spec = "volcengine:deepseek-v4-pro"
  if (!spec || typeof spec !== "string") return null;
  const idx = spec.indexOf(":");
  if (idx < 0) return null;
  const providerId = spec.slice(0, idx);
  const modelId = spec.slice(idx + 1);
  return MODELS.find((m) => m.provider === providerId && m.id === modelId) || null;
}

function resolveSpec(spec) {
  const m = findModel(spec);
  if (!m) throw new Error(`[env-config] 未知模型规格: ${spec}（格式: provider:modelId）`);
  const apiKey = getEnv(m.apiKeyEnv);
  if (!apiKey) {
    throw new Error(
      `[env-config] 缺少 API key: 在 .env 里设置 ${m.apiKeyEnv}（对应 ${m.name}）`,
    );
  }
  return { ...m, apiKey };
}

function reload() {
  _envCache = null;
}

export const envConfig = {
  MODELS,
  getEnv,
  listModels,
  findModel,
  resolveSpec,
  reload,
};
