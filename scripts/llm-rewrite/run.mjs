#!/usr/bin/env node
// llm-rewrite 主编排：并发改写 topic，原地写回（git 兜底）或预览目录。
// 用法示例：
//   node scripts/llm-rewrite/run.mjs --mock --preview-dir /tmp/rw --only topics/java/topic-030-e4f16979.json
//   node scripts/llm-rewrite/run.mjs --provider mimo --limit 5 --preview-dir /tmp/rw   # 真模型预览
//   node scripts/llm-rewrite/run.mjs --provider mimo                                    # 全量原地写回
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, REWRITE_DIR, DEFAULTS, resolveModel } from "./config.mjs";
import { buildMessages, mockResponse } from "./prompt.mjs";
import { callChat, extractJson } from "./client.mjs";
import { mergeRewrite } from "./topic-io.mjs";

function parseArgs(argv) {
  const a = { mock: false, force: false, concurrency: DEFAULTS.concurrency, only: [], previewDir: null, provider: "mimo", limit: 0, domain: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--mock") a.mock = true;
    else if (x === "--force") a.force = true;
    else if (x === "--concurrency") a.concurrency = Number(argv[++i]);
    else if (x === "--limit") a.limit = Number(argv[++i]);
    else if (x === "--domain") a.domain = argv[++i];
    else if (x === "--provider") a.provider = argv[++i];
    else if (x === "--preview-dir") a.previewDir = argv[++i];
    else if (x === "--only") a.only.push(argv[++i]);
  }
  return a;
}

// 按仓库学习路径顺序列出 topic：manifest.domains → domain.categories(按 order) → category.topics(列表序)。
// 不用字母序——要照仓库的顺序风格走。
function listTopics({ domain, only, limit }) {
  if (only.length) return only.map((r) => r.replace(/^\.\//, ""));
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "manifest.json"), "utf8"));
  const ordered = [];
  const seen = new Set();
  for (const de of manifest.domains || []) {
    if (domain && de.id !== domain) continue;
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, de.entry), "utf8")); } catch { continue; }
    const cats = [...(d.categories || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const c of cats) {
      for (const ref0 of c.topics || []) {
        const ref = ref0.replace(/^\.\//, "");
        if (!seen.has(ref)) { seen.add(ref); ordered.push(ref); }
      }
    }
  }
  let refs = ordered.filter((ref) => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ref), "utf8"));
      return Array.isArray(t.learningCards) && t.learningCards.length > 0;
    } catch { return false; }
  });
  if (limit > 0) refs = refs.slice(0, limit);
  return refs;
}

const ledgerPath = path.join(REWRITE_DIR, ".state.json");
function loadLedger() { try { return JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { return {}; } }
function saveLedger(l) { fs.writeFileSync(ledgerPath, JSON.stringify(l, null, 2)); }

function isDirty(ref) {
  try { return execFileSync("git", ["status", "--porcelain", "--", ref], { cwd: REPO_ROOT }).toString().trim() !== ""; }
  catch { return false; }
}

function atomicWrite(absPath, obj) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = absPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, absPath);
}

async function processOne(ref, { model, mock, previewDir }) {
  const abs = path.join(REPO_ROOT, ref);
  const topic = JSON.parse(fs.readFileSync(abs, "utf8"));
  // JSON 解析或校验失败就 re-roll 重调（MiMo 出 JSON 是随机的，重试多半能拿到合法输出）。
  const attempts = mock ? 1 : 3;
  let merged, diagramRequests, usage = null, lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      let text;
      if (mock) {
        text = mockResponse(topic);
      } else {
        const r = await callChat({ model, messages: buildMessages(topic) });
        text = r.text; usage = r.usage;
      }
      ({ topic: merged, diagramRequests } = mergeRewrite(topic, extractJson(text)));
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (mock) break;
    }
  }
  if (lastErr) throw lastErr;
  const outAbs = previewDir ? path.join(previewDir, ref) : abs;
  atomicWrite(outAbs, merged);
  return { usage, diagramRequests, outAbs };
}

async function pool(items, concurrency, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; await worker(items[i], i); }
  });
  await Promise.all(runners);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const model = args.mock ? { name: "mock" } : resolveModel({ provider: args.provider });
  const refs = listTopics(args);
  const ledger = loadLedger();
  const todo = refs.filter((r) => args.force || ledger[r]?.status !== "done");

  if (!args.previewDir && !args.mock) {
    const dirty = todo.filter(isDirty);
    if (dirty.length && !args.force) {
      console.error(`✗ ${dirty.length} 篇目标有未提交改动，原地写回会混淆 diff。先提交/还原，或加 --force / --preview-dir。`);
      console.error(dirty.slice(0, 5).join("\n"));
      process.exit(1);
    }
  }

  console.log(`模型=${model.name} 共${refs.length}篇 待处理${todo.length}篇 并发${args.concurrency}${args.mock ? " [MOCK]" : ""}${args.previewDir ? ` 预览→${args.previewDir}` : " 原地写回"}`);
  const t0 = Date.now();
  let done = 0, failed = 0, inTok = 0, outTok = 0;
  const diagramQueue = [];
  const failures = [];

  await pool(todo, args.concurrency, async (ref, i) => {
    const ts = Date.now();
    try {
      const { usage, diagramRequests, outAbs } = await processOne(ref, { model, mock: args.mock, previewDir: args.previewDir });
      done++;
      if (usage) { inTok += usage.prompt_tokens || 0; outTok += usage.completion_tokens || 0; }
      for (const d of diagramRequests) diagramQueue.push({ topicRef: ref, topicTitle: JSON.parse(fs.readFileSync(outAbs, "utf8")).title, ...d });
      ledger[ref] = { status: "done", at: new Date().toISOString(), model: model.name };
      const eta = ((Date.now() - t0) / Math.max(done + failed, 1)) * (todo.length - done - failed);
      console.log(`[${done + failed}/${todo.length}] ✓ ${ref} ${Math.round((Date.now() - ts) / 1000)}s | 完成${done} 失败${failed} | ETA ${Math.round(eta / 1000)}s`);
    } catch (err) {
      failed++;
      failures.push({ ref, error: String(err.message || err).slice(0, 300) });
      ledger[ref] = { status: "failed", at: new Date().toISOString(), error: String(err.message || err).slice(0, 300) };
      console.log(`[${done + failed}/${todo.length}] ✗ ${ref} — ${String(err.message || err).slice(0, 120)}`);
    }
    if ((done + failed) % 10 === 0) saveLedger(ledger);
  });
  saveLedger(ledger);

  // 产物：SVG 待生成清单（机器 + 人读）+ 失败清单
  if (diagramQueue.length) {
    fs.writeFileSync(path.join(REWRITE_DIR, "diagram-queue.jsonl"), diagramQueue.map((d) => JSON.stringify(d)).join("\n") + "\n");
    const rows = diagramQueue.map((d, i) =>
      `| ${i + 1} | ${d.topicRef} | ${d.cardTitle || ""} | ${(d.mustShow || "").replace(/\|/g, "/").slice(0, 60)} | ${d.suggestedFileName || ""} |`);
    fs.writeFileSync(path.join(REWRITE_DIR, "svg-pending.md"),
      `# 待生成 SVG（${diagramQueue.length} 处）\n\n| # | topic | 卡片 | 画什么 | 建议文件名 |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`);
  }
  if (failures.length) fs.writeFileSync(path.join(REWRITE_DIR, "failures.json"), JSON.stringify(failures, null, 2));

  console.log(`\n完成 ${done} / 失败 ${failed} | 墙钟 ${Math.round((Date.now() - t0) / 1000)}s` +
    (args.mock ? "" : ` | token 入${inTok} 出${outTok}`) +
    (diagramQueue.length ? ` | 待生成 SVG ${diagramQueue.length} → scripts/llm-rewrite/svg-pending.md` : "") +
    (failures.length ? ` | 失败清单 → scripts/llm-rewrite/failures.json` : ""));
}

// 仅作为 CLI 直接运行时才执行；被 import 时不自动开跑（防误触发全量）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
