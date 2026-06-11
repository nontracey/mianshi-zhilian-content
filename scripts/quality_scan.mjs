import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

async function listJson(dir) {
  const full = path.join(root, dir);
  const entries = await readdir(full, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listJson(child)));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(child);
  }
  return files;
}

function stripCodeFences(text) {
  return text.replace(/```[\s\S]*?```/g, "");
}

function normalizeCodeContent(text) {
  return (text ?? "").replace(/\\n/g, "\n").trim();
}

function firstNonEmptyLine(text) {
  return normalizeCodeContent(text)
    .split("\n")
    .find((line) => line.trim().length > 0)
    ?.trim() ?? "";
}

function detectCodeLanguageIssue(card) {
  if (card.type !== "code") return null;

  const language = (card.language ?? "").trim().toLowerCase();
  if (!language || language === "markdown") return null;

  const content = normalizeCodeContent(card.content);
  const firstLine = firstNonEmptyLine(content);
  const head = content.slice(0, 1200);

  if (language === "java") {
    if (/^<(!|\w)/.test(firstLine)) return "CODE_LANGUAGE_JAVA_XML";
    if (/^#\s*application\.ya?ml|^server:\s*$|(^|\n)\s*spring:\s*$/m.test(head)) {
      return "CODE_LANGUAGE_JAVA_YAML";
    }
    if (/^#\s*(使用Serial收集器|手动触发|主从配置)|^-XX:|^redis-cli>|^SAVE\b|^BGSAVE\b/.test(firstLine)) {
      return "CODE_LANGUAGE_JAVA_SHELL";
    }
  }

  if (language === "javascript") {
    if (/^#\s*GitHub Actions|^name:\s|(^|\n)\s*jobs:\s*$/m.test(head)) {
      return "CODE_LANGUAGE_JAVASCRIPT_CICD";
    }
  }

  if (language === "python") {
    if (/^\$\s*(nslookup|dig|openssl)\b/m.test(head) || /package\s+main/.test(head)) {
      return "CODE_LANGUAGE_PYTHON_MIXED";
    }
  }

  if (language === "css" && /\b(if\s*\(|return\s+|JSON\.parseObject|LocalDate\b)/.test(head)) {
    return "CODE_LANGUAGE_CSS_WRONG";
  }

  if (language === "bash" && /\b(LocalDate|public\s+class|import\s+java\.|#include\s*<)/.test(head)) {
    return "CODE_LANGUAGE_BASH_WRONG";
  }

  if (language === "c" && /\b(public\s+class|jmap\s+|jstat\s+|package\s+main)\b/.test(head)) {
    return "CODE_LANGUAGE_C_MIXED";
  }

  return null;
}

const checks = [
  {
    code: "TEMPLATE_EMPTY",
    pattern: /建议结合实际项目|没有银弹|这个问题要看具体情况|理论和实践脱节/,
  },
  {
    code: "INLINE_NUMBER",
    pattern: /(^|[：:；;。\n])\s*(?<![:\dA-Za-z])[1-9]）/,
  },
  {
    code: "FRONTEND_GENERIC",
    pattern: /在现代前端框架（React\/Vue）中的应用和注意事项是什么/,
  },
  {
    code: "PLACEHOLDER_ANSWER",
    pattern: /回答时要先给出机制结论/,
  },
  {
    code: "INTERVIEW_GREETING",
    pattern: /面试官您好/,
  },
  {
    code: "DOTNET_JAVA_DIFF_TEMPLATE",
    pattern: /和 Java 对应技术有什么异同/,
  },
  {
    code: "AGENT_RAG_MISMATCH",
    pattern: /出现效果不佳（如召回不准/,
  },
  {
    code: "AGENT_GENERIC_DESIGN_RECALL",
    pattern: /核心设计模式是什么？如何处理异常和边界情况/,
  },
  {
    code: "OS_CONTAINER_TEMPLATE",
    pattern: /容器化（Docker\/K8s）环境下有什么特殊考虑/,
  },
  {
    code: "FOUR_STEP_TEMPLATE",
    pattern: /四段式/,
  },
  {
    code: "MCP_LEGACY_TRANSPORT_ONLY",
    pattern: /stdio\s*和\s*SSE\s*两种传输|stdio和SSE两种传输/,
  },
];

const issues = [];
for (const file of await listJson("topics")) {
  const topic = await readJson(file);
  const fields = [];

  for (const card of topic.learningCards ?? []) {
    if (card.type === "code") {
      const languageIssue = detectCodeLanguageIssue(card);
      if (languageIssue) {
        issues.push({
          code: languageIssue,
          file,
          title: topic.title,
          field: `learningCards.code.${card.title}`,
        });
      }
      continue;
    }

    if (typeof card.content === "string") {
      fields.push([`learningCards.${card.type}.${card.title}`, stripCodeFences(card.content)]);
    }
    for (const item of card.items ?? []) {
      fields.push([`learningCards.${card.type}.items`, item]);
    }
    for (const qa of card.followUpQuestions ?? []) {
      fields.push([`followUp.${qa.question}`, qa.question]);
      fields.push([`followUpAnswer.${qa.question}`, qa.answer ?? ""]);
    }
  }

  for (const prompt of topic.recallPrompts ?? []) {
    fields.push([`recallPrompts.${prompt.id}`, prompt.prompt]);
  }

  for (const key of ["mustHave", "goodToHave", "commonMistakes"]) {
    for (const item of topic.rubric?.[key] ?? []) {
      fields.push([`rubric.${key}`, item]);
    }
  }

  for (const [name, text] of fields) {
    for (const check of checks) {
      if (check.pattern.test(text)) {
        issues.push({ code: check.code, file, title: topic.title, field: name });
      }
    }
  }

  const explainTitles = new Set();
  for (const card of topic.learningCards ?? []) {
    if (card.type !== "explain") continue;
    if (explainTitles.has(card.title)) {
      issues.push({
        code: "DUPLICATE_EXPLAIN_TITLE",
        file,
        title: topic.title,
        field: `learningCards.explain.${card.title}`,
      });
    }
    explainTitles.add(card.title);
  }
}

if (issues.length > 0) {
  for (const issue of issues) {
    console.log(`${issue.code}\t${issue.file}\t${issue.title}\t${issue.field}`);
  }
  process.exitCode = 1;
} else {
  console.log("Quality scan passed: no template text, duplicated explain titles, unsafe code-language labels, generic frontend follow-up, placeholder answer, or unsafe inline numbering found.");
}
