// scripts/mcp/registry.mjs
// MCP server 注册表 + 工具调用入口。
//
// v3.3 升级：
// - 多工具串联：VISION_JUDGE_MCP_TOOLS / FACT_CHECK_MCP_TOOLS（逗号分隔，旧单数兼容）
// - callConfiguredTools 支持 parallel（并发 merge）和 serial（递进串行）模式
// - 故障隔离：单 server 失败 → 标 unhealthyUntil=now+30s，期间跳过该 server
// - callTool 失败不影响其他 server（parallel 模式下）

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { envConfig } from "../llm/env-config.mjs";
import { McpStdioClient } from "./client.mjs";
import { liveEvents } from "../llm/live-events.mjs";

const root = process.cwd();
const clients = new Map();
const unhealthyUntil = new Map(); // server -> timestamp
const MCP_UNHEALTHY_MS = 30_000;

function parseJson(raw, label) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.servers)) return parsed.servers;
    throw new Error("root is not array and has no servers[]");
  } catch (error) {
    throw new Error(`[mcp] ${label} 不是合法 MCP JSON：${error.message}`);
  }
}

function splitList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envSuffix(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function maybeNum(raw) {
  if (raw == null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseJsonObject(raw, label) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    throw new Error("root is not object");
  } catch (error) {
    throw new Error(`[mcp] ${label} 不是合法 JSON object：${error.message}`);
  }
}

function parseJsonArray(raw, label) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    throw new Error("root is not array");
  } catch (error) {
    throw new Error(`[mcp] ${label} 不是合法 JSON array：${error.message}`);
  }
}

function compactObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

function parseScalarServerConfigs() {
  const aliases = splitList(envConfig.getEnv("MCP_SERVERS"));
  return aliases.map((alias) => {
    const suffix = envSuffix(alias);
    if (!suffix) return null;
    const key = (name) => envConfig.getEnv(`MCP_SERVER_${suffix}_${name}`);
    const args = parseJsonArray(key("ARGS_JSON"), `MCP_SERVER_${suffix}_ARGS_JSON`) ?? splitList(key("ARGS"));
    return compactObject({
      name: key("NAME") || alias,
      command: key("COMMAND"),
      args,
      timeoutMs: maybeNum(key("TIMEOUT_MS")),
      cwd: key("CWD"),
      env: parseJsonObject(key("ENV_JSON"), `MCP_SERVER_${suffix}_ENV_JSON`),
    });
  }).filter((config) => config && config.name && config.command);
}

function serverConfigs() {
  const configs = [];
  configs.push(...parseScalarServerConfigs());
  const file = envConfig.getEnv("MCP_SERVERS_FILE");
  if (file) {
    const filePath = path.isAbsolute(file) ? file : path.join(root, file);
    if (!existsSync(filePath)) throw new Error(`[mcp] MCP_SERVERS_FILE 不存在：${filePath}`);
    configs.push(...parseJson(readFileSync(filePath, "utf8"), "MCP_SERVERS_FILE"));
  }
  configs.push(...parseJson(envConfig.getEnv("MCP_SERVERS_JSON"), "MCP_SERVERS_JSON"));
  return configs.filter((config) => config && config.name && config.command);
}

function getClient(name) {
  if (clients.has(name)) return clients.get(name);
  const config = serverConfigs().find((entry) => entry.name === name);
  if (!config) throw new Error(`[mcp] 未找到 server：${name}`);
  const client = new McpStdioClient(config);
  clients.set(name, client);
  return client;
}

function isHealthy(name) {
  const until = unhealthyUntil.get(name) ?? 0;
  return Date.now() >= until;
}

function markUnhealthy(name, durationMs = MCP_UNHEALTHY_MS) {
  const until = Date.now() + durationMs;
  unhealthyUntil.set(name, until);
  liveEvents.emitEvent("mcp.unhealthy", { server: name, until });
}

function markHealthy(name) {
  unhealthyUntil.delete(name);
}

function parseToolRef(ref) {
  if (!ref) return null;
  const text = String(ref).trim();
  const idx = text.indexOf(":");
  if (idx <= 0 || idx >= text.length - 1) {
    throw new Error(`[mcp] 工具引用必须是 server:tool，实际 ${text}`);
  }
  return { server: text.slice(0, idx), tool: text.slice(idx + 1) };
}

function parseToolRefs(refs) {
  if (!refs) return [];
  return String(refs)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseToolRef);
}

// 取多工具引用：优先读复数 env，回退到单数 env（向后兼容）
function readToolRefs(envKeyPlural, envKeySingular) {
  const plural = envConfig.getEnv(envKeyPlural);
  if (plural) return parseToolRefs(plural);
  const singular = envConfig.getEnv(envKeySingular);
  if (singular) return parseToolRefs(singular);
  return [];
}

// 调用单个工具，带 unhealthy 隔离
async function callOneTool(ref, args) {
  if (!isHealthy(ref.server)) {
    const err = new Error(`[mcp] server ${ref.server} 当前 unhealthy，跳过`);
    err.mcpUnhealthy = true;
    err.server = ref.server;
    throw err;
  }
  try {
    const client = getClient(ref.server);
    const result = await client.callTool(ref.tool, args);
    markHealthy(ref.server);
    return { ref, result, ok: true };
  } catch (error) {
    // 启动失败 / 调用失败都标 unhealthy
    markUnhealthy(ref.server);
    return { ref, error: error.message, ok: false };
  }
}

// 调用单个配置的工具（旧 API，向后兼容）
export async function callConfiguredTool(envKey, args) {
  const refs = parseToolRefs(envConfig.getEnv(envKey));
  if (!refs.length) return null;
  const { result, ok } = await callOneTool(refs[0], args);
  if (!ok) throw new Error(`[mcp] ${refs[0].server}:${refs[0].tool} 失败`);
  return result;
}

// 调用多个工具：
// - parallel: Promise.all 并发，merge findings（适合视觉判官）
// - serial: 串行，前一个结果作为后一个的 priorResults，最后合并（适合事实核验递进）
export async function callConfiguredTools(envKeyPlural, envKeySingular, args, { mode = "parallel" } = {}) {
  const refs = readToolRefs(envKeyPlural, envKeySingular);
  if (!refs.length) return [];
  if (mode === "parallel") {
    const results = await Promise.all(refs.map((ref) => callOneTool(ref, args)));
    return results;
  }
  // serial
  const results = [];
  let priorResults = [];
  for (const ref of refs) {
    const enrichedArgs = { ...args, priorResults };
    const entry = await callOneTool(ref, enrichedArgs);
    results.push(entry);
    if (entry.ok) priorResults = [...priorResults, { server: ref.server, tool: ref.tool, result: entry.result }];
  }
  return results;
}

export async function listConfiguredTools() {
  const out = [];
  for (const config of serverConfigs()) {
    if (!isHealthy(config.name)) {
      out.push({ server: config.name, tools: [], unhealthy: true });
      continue;
    }
    try {
      const client = getClient(config.name);
      const tools = await client.listTools();
      out.push({ server: config.name, tools });
    } catch (error) {
      markUnhealthy(config.name);
      out.push({ server: config.name, tools: [], error: error.message, unhealthy: true });
    }
  }
  return out;
}

export function mcpHealthSnapshot() {
  const now = Date.now();
  return [...unhealthyUntil.entries()]
    .filter(([, until]) => until > now)
    .map(([server, until]) => ({ server, remainingMs: until - now }));
}

export function stopMcpClients() {
  for (const client of clients.values()) client.stop();
  clients.clear();
}

export function __serverConfigsForTest() {
  return serverConfigs();
}
