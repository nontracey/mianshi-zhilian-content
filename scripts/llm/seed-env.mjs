#!/usr/bin/env node
// scripts/llm/seed-env.mjs
// 从 ~/.qwen/settings.json 的 env 段把 API key 写入仓库根 .env。
// 不会覆盖 .env 里已经填好的值；已存在的 key 会跳过并报告。
//
// 用法：
//   node scripts/llm/seed-env.mjs
//   node scripts/llm/seed-env.mjs --force          # 强制覆盖 secret（仅当你明确想用 ~/.qwen 的为准）
//   node scripts/llm/seed-env.mjs --dry-run        # 只打印不写
//   node scripts/llm/seed-env.mjs --merge-defaults # 把 .env.example 里缺失的非 secret 配置项补到 .env
//                                                  #（保留 .env 已有值；老版本 .env 升级到 v3 时跑一次）

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = process.cwd();
const ENV_FILE = path.join(REPO_ROOT, ".env");
const ENV_EXAMPLE = path.join(REPO_ROOT, ".env.example");
const QWEN_SETTINGS = path.join(os.homedir(), ".qwen", "settings.json");

const SECRET_KEYS = new Set([
  "ZHIPU_API_KEY",
  "LONGCAT_API_KEY",
  "AGNES_API_KEY",
  // v3.3 内置联网 + 长上下文模型
  "FACT_CHECK_API_KEY",
  "BING_API_KEY",
  "DASHSCOPE_API_KEY",
  "GOOGLE_CSE_API_KEY",
]);

function parseEnv(text) {
  // 保留原始行顺序与注释；只解析出 KEY → 行号映射
  const lines = text.split(/\r?\n/);
  const map = new Map(); // KEY -> { line: number, value: string }
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const m = rawLine.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map.set(m[1], { line: i, value: v });
  });
  return { lines, map };
}

function setLine(lines, idx, key, value) {
  lines[idx] = `${key}=${value}`;
}

function loadQwenSecrets() {
  if (!existsSync(QWEN_SETTINGS)) {
    return { ok: false, reason: `~/.qwen/settings.json 不存在: ${QWEN_SETTINGS}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(QWEN_SETTINGS, "utf8"));
  } catch (e) {
    return { ok: false, reason: `解析失败: ${e.message}` };
  }
  const env = parsed?.env || {};
  const out = {};
  for (const k of Object.keys(env)) {
    if (SECRET_KEYS.has(k) && typeof env[k] === "string" && env[k].trim()) {
      out[k] = env[k].trim();
    }
  }
  return { ok: true, secrets: out };
}

function ensureEnvFile() {
  if (existsSync(ENV_FILE)) return false;
  if (!existsSync(ENV_EXAMPLE)) {
    console.error("[seed-env] 既没有 .env 也没有 .env.example，无从下手。");
    process.exit(1);
  }
  copyFileSync(ENV_EXAMPLE, ENV_FILE);
  return true;
}

function mergeMissingDefaults({ dryRun }) {
  const exampleText = readFileSync(ENV_EXAMPLE, "utf8");
  const envText = readFileSync(ENV_FILE, "utf8");
  const exampleParsed = parseEnv(exampleText);
  const envParsed = parseEnv(envText);

  const missing = [];
  for (const [key] of exampleParsed.map.entries()) {
    if (SECRET_KEYS.has(key)) continue;
    if (!envParsed.map.has(key)) missing.push(key);
  }
  if (missing.length === 0) return;

  // 直接把 .env.example 里这些缺失行追加到 .env 末尾，附一个分隔注释
  const exampleLines = exampleText.split(/\r?\n/);
  const appended = [];
  appended.push("");
  appended.push("# ===== v3 自动补齐：以下默认值来自 .env.example（首次升级生成）=====");
  for (const key of missing) {
    const idx = exampleParsed.map.get(key).line;
    // 把注释块跟着一起带过来：往上回溯连续 # 行直到空行
    const collected = [];
    let cursor = idx - 1;
    while (cursor >= 0 && exampleLines[cursor].trim().startsWith("#")) {
      collected.unshift(exampleLines[cursor]);
      cursor -= 1;
    }
    appended.push(...collected);
    appended.push(exampleLines[idx]);
  }
  if (dryRun) {
    console.log(`[seed-env] DRY-RUN：将追加 ${missing.length} 个缺失默认（${missing.join(", ")}）`);
    return;
  }
  writeFileSync(ENV_FILE, envText.replace(/\s*$/, "") + "\n" + appended.join("\n") + "\n");
  console.log(`[seed-env] 补齐 ${missing.length} 个缺失默认: ${missing.join(", ")}`);
}

// v3 默认值变更（仅在 --upgrade-defaults 下执行；会覆盖旧值）
const V3_DEFAULTS = {
  REFINE_MODEL_CHAIN: "zhipu:glm-4.7-flash,longcat:LongCat-2.0-Preview",
  JUDGE_MODEL_CHAIN: "longcat:LongCat-2.0-Preview,zhipu:glm-4.7-flash",
  BLOCK_JUDGE_MODEL_CHAIN: "zhipu:glm-4.7-flash,longcat:LongCat-2.0-Preview",
};

function upgradeDefaults({ dryRun }) {
  const text = readFileSync(ENV_FILE, "utf8");
  const { lines, map } = parseEnv(text);
  const changed = [];
  for (const [key, want] of Object.entries(V3_DEFAULTS)) {
    const entry = map.get(key);
    if (!entry) continue;
    if (entry.value === want) continue;
    if (!dryRun) setLine(lines, entry.line, key, want);
    changed.push(`${key}: ${entry.value} → ${want}`);
  }
  if (changed.length === 0) {
    console.log("[seed-env] 默认值已是 v3，无需升级");
    return;
  }
  if (dryRun) {
    console.log(`[seed-env] DRY-RUN：将更新 ${changed.length} 个默认值`);
  } else {
    writeFileSync(ENV_FILE, lines.join("\n"));
    console.log(`[seed-env] 升级 ${changed.length} 个默认值到 v3:`);
  }
  changed.forEach((c) => console.log(`    ${c}`));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const force = args.has("--force");
  const dryRun = args.has("--dry-run");
  const mergeDefaults = args.has("--merge-defaults") || !args.has("--no-merge-defaults");

  const created = ensureEnvFile();
  if (created) console.log("[seed-env] 已从 .env.example 创建 .env");

  // —— 先补齐 .env.example 里有、.env 里没有的非 secret 配置（v3 升级路径）——
  if (mergeDefaults && existsSync(ENV_EXAMPLE)) {
    mergeMissingDefaults({ dryRun });
  }

  // —— v3 默认值变更（旧 .env 显式更新到新默认；只在 --upgrade-defaults 下执行）——
  if (args.has("--upgrade-defaults")) {
    upgradeDefaults({ dryRun });
  }

  const qwen = loadQwenSecrets();
  if (!qwen.ok) {
    console.error(`[seed-env] 未能从 ~/.qwen 读取 secrets: ${qwen.reason}`);
    console.error("[seed-env] 请手动编辑 .env 填入 API key。");
    process.exit(0); // 不报错退出，仅提示
  }

  const text = readFileSync(ENV_FILE, "utf8");
  const { lines, map } = parseEnv(text);

  const filled = [];
  const skipped = [];
  const overwritten = [];
  const missing = [];

  for (const key of SECRET_KEYS) {
    const fromQwen = qwen.secrets[key];
    const entry = map.get(key);
    if (!fromQwen) {
      if (!entry || !entry.value) missing.push(key);
      continue;
    }
    if (!entry) {
      // 末尾追加（理论上 .env.example 里都有这些 key，这里兜底）
      lines.push(`${key}=${fromQwen}`);
      filled.push(key);
      continue;
    }
    if (entry.value && !force) {
      skipped.push(key);
      continue;
    }
    if (entry.value && force) {
      overwritten.push(key);
    } else {
      filled.push(key);
    }
    setLine(lines, entry.line, key, fromQwen);
  }

  if (filled.length === 0 && overwritten.length === 0) {
    console.log("[seed-env] 无变化（已有值都保留；--force 可强制覆盖）。");
  } else if (dryRun) {
    console.log(`[seed-env] DRY-RUN：将写入 ${filled.length + overwritten.length} 个 key`);
  } else {
    writeFileSync(ENV_FILE, lines.join("\n"));
    console.log(`[seed-env] 已更新 .env（${filled.length} 新填，${overwritten.length} 覆盖）`);
  }

  if (filled.length) console.log(`  ✓ 新填: ${filled.join(", ")}`);
  if (overwritten.length) console.log(`  ↻ 覆盖: ${overwritten.join(", ")}`);
  if (skipped.length) console.log(`  ⏭ 已有保留: ${skipped.join(", ")}（--force 可覆盖）`);
  if (missing.length) console.log(`  ⚠ ~/.qwen 也没有: ${missing.join(", ")}（如需用到请手填）`);
}

main();
