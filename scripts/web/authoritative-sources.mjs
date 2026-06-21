// scripts/web/authoritative-sources.mjs
// 联网事实核验"优先官方文档"支持：领域/关键词 → 权威文档站点映射。
// 用法：① buildDocBiasedQueries(topic) 生成"先官方文档"的查询；② isAuthoritative(url) 给抓到的源打权威标记，判官据此加权。
//
// 设计取向：尽量用官方一手文档 / 标准规范 / 源码托管站，而不是博客/营销页。
// 可用 .env FACT_CHECK_DOC_SITES_JSON 追加或覆盖（{ "<domainOrKeyword>": ["site1","site2"] }）。

import { envConfig } from "../llm/env-config.mjs";

// 跨领域通用一手来源（永远纳入权威白名单）。
const GENERIC_AUTHORITATIVE = [
  "github.com", "gitlab.com", "stackoverflow.com",
  "developer.mozilla.org", "datatracker.ietf.org", "rfc-editor.org",
  "w3.org", "ietf.org", "apache.org", "cncf.io", "openjdk.org",
  // 中国镜像/官方中文站
  "golang.google.cn", "docs.pythontab.com",
];

// 领域/关键词 → 官方文档站点。键既匹配 topic.domain，也匹配 title/tags 里出现的关键词（小写包含）。
const DOC_SITES = {
  java: ["docs.oracle.com", "openjdk.org", "docs.spring.io", "jakarta.ee"],
  spring: ["docs.spring.io", "spring.io"],
  python: ["docs.python.org", "peps.python.org", "packaging.python.org"],
  go: ["go.dev", "pkg.go.dev", "golang.google.cn"],
  golang: ["go.dev", "pkg.go.dev", "golang.google.cn"],
  rust: ["doc.rust-lang.org", "docs.rs"],
  dotnet: ["learn.microsoft.com", "docs.microsoft.com"],
  "design-pattern": ["refactoring.guru", "learn.microsoft.com"],
  frontend: ["developer.mozilla.org", "react.dev", "vuejs.org", "tc39.es", "webpack.js.org", "typescriptlang.org"],
  react: ["react.dev"],
  typescript: ["typescriptlang.org"],
  webpack: ["webpack.js.org"],
  database: ["dev.mysql.com", "postgresql.org", "redis.io", "mongodb.com", "docs.oracle.com"],
  mysql: ["dev.mysql.com"],
  postgres: ["postgresql.org"],
  redis: ["redis.io"],
  os: ["man7.org", "kernel.org", "docs.kernel.org"],
  linux: ["man7.org", "kernel.org"],
  network: ["datatracker.ietf.org", "rfc-editor.org", "developer.mozilla.org"],
  security: ["owasp.org", "cve.mitre.org", "nvd.nist.gov", "datatracker.ietf.org"],
  devops: ["kubernetes.io", "docs.docker.com", "docs.github.com", "developer.hashicorp.com"],
  kubernetes: ["kubernetes.io"],
  docker: ["docs.docker.com"],
  "data-engineering": ["spark.apache.org", "kafka.apache.org", "flink.apache.org", "airflow.apache.org"],
  architecture: ["martinfowler.com", "microservices.io", "aws.amazon.com"],
  agent: ["platform.openai.com", "docs.anthropic.com", "ai.google.dev"],
  algorithm: ["cp-algorithms.com", "en.wikipedia.org"],
};

function loadOverrides() {
  const raw = envConfig.getEnv("FACT_CHECK_DOC_SITES_JSON");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// 收集本 topic 命中的权威站点（领域键 + title/tags 关键词键）。
export function authoritativeSitesFor(topic) {
  const table = { ...DOC_SITES, ...loadOverrides() };
  const hay = `${topic?.domain ?? ""} ${topic?.category ?? ""} ${topic?.title ?? ""} ${(topic?.tags ?? []).join(" ")}`.toLowerCase();
  const sites = new Set();
  for (const [key, list] of Object.entries(table)) {
    if (!key) continue;
    if ((topic?.domain ?? "").toLowerCase() === key.toLowerCase() || hay.includes(key.toLowerCase())) {
      for (const s of list) sites.add(s);
    }
  }
  return [...sites];
}

// 完整权威白名单（命中站点 + 通用一手来源）。
export function authoritativeAllowlist(topic) {
  return [...new Set([...authoritativeSitesFor(topic), ...GENERIC_AUTHORITATIVE])];
}

// 抓到的 URL 是否来自权威站点。
export function isAuthoritative(url, topic) {
  if (typeof url !== "string") return false;
  let host = "";
  try { host = new URL(url).host.toLowerCase(); } catch { host = url.toLowerCase(); }
  return authoritativeAllowlist(topic).some((site) => host === site || host.endsWith(`.${site}`) || host.includes(site));
}

// 生成"先官方文档"的查询序列：① site: 受限的官方文档查询（取命中的前若干站点）；② 关键词加权的通用查询；③ 原始兜底查询。
// site: OR 跨引擎兼容性一般，这里对每个权威站点各发一条 site: 查询，再加一条不带 site 的兜底。
export function buildDocBiasedQueries(topic, opts = {}) {
  const tags = Array.isArray(topic.tags) ? topic.tags.slice(0, 3).join(" ") : "";
  const base = `${topic.title} ${topic.domain} ${tags}`.trim().slice(0, 120);
  const sites = authoritativeSitesFor(topic).slice(0, opts.maxSites ?? 3);
  const queries = [];
  for (const site of sites) queries.push({ query: `${topic.title} ${tags}`.trim().slice(0, 100) + ` site:${site}`, authoritative: true, site });
  // 关键词加权（不带 site:，对不支持 site: 的引擎也能把官方文档排前）
  queries.push({ query: `${base} 官方文档 documentation`.slice(0, 120), authoritative: true });
  queries.push({ query: base, authoritative: false });
  return queries;
}
