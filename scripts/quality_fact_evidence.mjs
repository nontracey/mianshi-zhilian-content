// scripts/quality_fact_evidence.mjs
// 联网事实核验：MCP 工具（多工具 serial 递进）+ 内置 web 后端（auto 优先级链）。
//
// v3.3 升级：
// - 多 MCP 串联：FACT_CHECK_MCP_TOOLS（serial 递进，前一个结果喂给下一个）
// - 内置后端：FACT_CHECK_BACKEND=auto 时按 google-cse → bing → baidu → sogou → duckduckgo 优先级
// - 联网缓存：1h TTL，避免同 topic 多轮重复搜索
// - 断网兜底：全失败 → status=unreachable，不阻塞精修
// - 优先级链：显式 backend > MCP > auto 内置 > not_checked

import { createHash } from "node:crypto";
import { envConfig } from "./llm/env-config.mjs";
import { liveEvents } from "./llm/live-events.mjs";
import { callConfiguredTools } from "./mcp/registry.mjs";
import { builtinFactCheck } from "./web/builtin-fact-check.mjs";

const cache = new Map(); // queryHash -> {result, fetchedAt}
const FACT_CHECK_CACHE_TTL_MS = Number(envConfig.getEnv("FACT_CHECK_CACHE_TTL_MS", "3600000")) || 3600000;

function boolEnv(key, fallback = false) {
  const raw = envConfig.getEnv(key);
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function parseToolJson(result) {
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent;
  for (const item of result.content ?? []) {
    if (item.type === "text" && item.text) {
      try {
        return JSON.parse(item.text);
      } catch {
        return { status: "checked", summary: item.text, findings: [], sources: [] };
      }
    }
  }
  return null;
}

function normalizeEvidence(result) {
  const parsed = parseToolJson(result) ?? result ?? {};
  return {
    status: parsed.status ?? "checked",
    summary: String(parsed.summary ?? ""),
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    checkedAt: parsed.checkedAt ?? new Date().toISOString(),
  };
}

function queryHints(topic) {
  const tags = Array.isArray(topic.tags) ? topic.tags.join(" ") : "";
  const base = `${topic.title} ${topic.domain} ${topic.category} ${tags}`.trim();
  const recency = Number(envConfig.getEnv("FACT_CHECK_RECENCY_DAYS", "1095")) || 1095;
  return {
    title: topic.title,
    domain: topic.domain,
    category: topic.category,
    difficulty: topic.difficulty,
    tags: topic.tags ?? [],
    query: base,
    recencyDays: recency,
    requirePrimarySources: true,
    instructions: [
      "优先官方文档、标准规范、源码文档、论文或权威 release notes。",
      "只核验 topic 中时间敏感或容易错的事实：版本、默认值、复杂度、协议行为、API 行为、命令参数。",
      "返回 wrong/outdated/suspicious 时必须带 source URL 或无法核验原因。",
    ],
  };
}

// ===== MCP 事实核验（多工具 serial 递进）=====
async function mcpFactCheck(topic, ref) {
  const refs = [
    envConfig.getEnv("FACT_CHECK_MCP_TOOLS"),
    envConfig.getEnv("FACT_CHECK_MCP_TOOL"),
  ].filter(Boolean);
  if (!refs.length) return null;
  const args = {
    ref,
    topic: {
      id: topic.id,
      title: topic.title,
      domain: topic.domain,
      category: topic.category,
      difficulty: topic.difficulty,
      summary: topic.summary,
      tags: topic.tags,
    },
    query: queryHints(topic),
  };
  const results = await callConfiguredTools("FACT_CHECK_MCP_TOOLS", "FACT_CHECK_MCP_TOOL", args, { mode: "serial" });
  const ok = results.filter((entry) => entry.ok);
  if (!ok.length) {
    return {
      status: "unreachable",
      summary: `所有事实核验 MCP 工具失败：${results.map((r) => `${r.ref.server}:${r.ref.tool}=${r.error}`).join("; ")}`,
      findings: [],
      sources: [],
    };
  }
  // 合并 serial 链上所有 MCP 的结果
  const merged = ok.reduce((acc, entry) => {
    const parsed = normalizeEvidence(entry.result);
    return {
      status: /^(wrong|outdated|fail)$/i.test(parsed.status) ? "fail" : acc.status,
      summary: [acc.summary, parsed.summary].filter(Boolean).join(" | "),
      findings: [...acc.findings, ...parsed.findings],
      sources: [...acc.sources, ...parsed.sources],
    };
  }, { status: "checked", summary: "", findings: [], sources: [] });
  return merged;
}

// ===== 主入口 =====
export async function buildFactEvidence(topic, ref) {
  const enabled = boolEnv("FACT_CHECK_ENABLED", false);
  if (!enabled) {
    return {
      status: "not_checked",
      summary: "FACT_CHECK_ENABLED=false；判官只能基于模型知识和 topic 内容核验。",
      findings: [],
      sources: [],
    };
  }

  const backend = String(envConfig.getEnv("FACT_CHECK_BACKEND", "auto")).toLowerCase();
  const cacheKey = hash(JSON.stringify({
    ref,
    topicHash: hash(JSON.stringify(topic)),
    backend,
    mcp: envConfig.getEnv("FACT_CHECK_MCP_TOOLS") ?? envConfig.getEnv("FACT_CHECK_MCP_TOOL") ?? "",
    recency: envConfig.getEnv("FACT_CHECK_RECENCY_DAYS"),
  }));
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < FACT_CHECK_CACHE_TTL_MS) {
    return cached.result;
  }

  let evidence;
  try {
    liveEvents.emitEvent("factcheck.start", { ref, backend });
    if (backend === "none") {
      evidence = {
        status: "not_checked",
        summary: "FACT_CHECK_BACKEND=none；判官只能基于模型知识和 topic 内容核验。",
        findings: [],
        sources: [],
      };
    } else if (backend === "mcp") {
      evidence = await mcpFactCheck(topic, ref) ?? {
        status: "not_checked",
        summary: "未配置 FACT_CHECK_MCP_TOOLS/TOOL。",
        findings: [],
        sources: [],
      };
    } else if (backend === "auto") {
      // 优先级：MCP > 内置 web > unreachable
      const mcpResult = await mcpFactCheck(topic, ref);
      if (mcpResult) {
        evidence = mcpResult;
      } else {
        evidence = await builtinFactCheck(topic, ref);
      }
    } else {
      // 显式内置 backend：google-cse | bing | baidu | sogou | duckduckgo | http
      evidence = await builtinFactCheck(topic, ref, { backend });
    }
  } catch (error) {
    evidence = {
      status: "unreachable",
      summary: `事实核验失败：${error.message}`,
      findings: [],
      sources: [],
    };
  }

  cache.set(cacheKey, { result: evidence, fetchedAt: Date.now() });
  liveEvents.emitEvent("factcheck.done", {
    ref,
    backend: evidence?.backend ?? backend,
    ok: evidence?.status !== "unreachable",
    findings: evidence?.findings?.length ?? 0,
    sources: evidence?.sources?.length ?? 0,
  });
  return evidence;
}

export function applyFactEvidenceToJudgeReview(review, factEvidence) {
  if (!review || !factEvidence) return review;
  const out = JSON.parse(JSON.stringify(review));
  out.externalFactEvidence = factEvidence;
  const externalProblems = (factEvidence.findings ?? []).filter((finding) =>
    /^(wrong|outdated)$/i.test(String(finding.verdict ?? finding.status ?? "")),
  );
  if (externalProblems.length) {
    out.verdict = "fail";
    out.factFindings ??= [];
    out.blockingFindings ??= [];
    for (const finding of externalProblems) {
      out.factFindings.push({
        claim: finding.claim ?? finding.issue ?? "外部事实核验发现问题",
        verdict: String(finding.verdict ?? finding.status).toLowerCase(),
        evidence: finding.evidence ?? finding.source ?? factEvidence.summary ?? "",
      });
      out.blockingFindings.push({ reason: `外部事实核验阻断：${finding.claim ?? finding.issue ?? "wrong/outdated"}` });
    }
  }
  return out;
}
