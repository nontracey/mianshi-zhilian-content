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

function normalizeComparableText(text) {
  return stripCodeFences(text ?? "")
    .replace(/\s+/g, "")
    .replace(/[，。；：、,.!！?？()[\]（）【】#*_`|>~\-]/g, "")
    .toLowerCase();
}

function findEmptyMarkdownHeadings(text) {
  const lines = (text ?? "").split(/\r?\n/);
  const headings = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!heading) continue;

    const level = heading[1].length;
    let hasContent = false;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor];
      if (/^\s*```/.test(next)) {
        hasContent = true;
        break;
      }

      const nextHeading = next.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (nextHeading && nextHeading[1].length <= level) break;
      if (nextHeading && nextHeading[1].length > level) {
        hasContent = true;
        break;
      }
      if (!nextHeading && next.trim()) {
        hasContent = true;
        break;
      }
    }

    if (!hasContent) headings.push({ line: index + 1, title: heading[2] });
  }

  return headings;
}

function countMarkdownFenceLines(text) {
  return (text ?? "").split(/\r?\n/).filter((line) => /^\s*```/.test(line)).length;
}

function hasMarkdownFenceLine(text) {
  return /^\s*```/m.test(text ?? "");
}

function normalizeCodeContent(text) {
  return (text ?? "").replace(/\\n/g, "\n").trim();
}

function stripShellHeredocs(text) {
  return (text ?? "").replace(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*\n[\s\S]*?\n\s*\1\b/g, "");
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

  if (language === "bash" && /\b(LocalDate|public\s+class|import\s+java\.|#include\s*<)/.test(stripShellHeredocs(content).slice(0, 1200))) {
    return "CODE_LANGUAGE_BASH_WRONG";
  }

  if (language === "c" && /\b(public\s+class|jmap\s+|jstat\s+|package\s+main)\b/.test(head)) {
    return "CODE_LANGUAGE_C_MIXED";
  }

  return null;
}

const genericHighlightPatterns = [
  /入口\/结构行/,
  /关键行/,
  /关键分支/,
  /状态变化行/,
  /循环主路径/,
  /异步边界/,
  /讲解锚点/,
  /输出语义/,
  /承担的职责，再展开内部流程/,
  /复述时要说明条件成立后的状态变化/,
  /这段代码围绕/,
  /如何处理输入、状态变化和边界/,
];

const generatedDiagramCaptionPattern =
  /^这张图把 .+ 的核心对象、状态变化和边界风险串起来，便于按链路解释。$/;
const algorithmTemplateLeakPattern =
  /要先说明题目约束，再给出核心解法和复杂度|先复述输入、输出和限制条件|空输入、重复值、指针越界或状态初始化|给出时间、空间复杂度/;
const machineRelationPhrasePattern = /能否说清|的定义和核心目标|如何影响[^，。；\n]{2,60}/;

const exactDuplicateBuckets = new Map();
const longDuplicateBuckets = new Map();

function canonicalContentFile(file) {
  return file.replace(/^(staging|draft)\//, "");
}

function rememberDuplicate(bucket, keyPrefix, text, entry, minComparableLength) {
  const comparable = normalizeComparableText(text);
  if (comparable.length < minComparableLength) return;
  const key = `${keyPrefix}\t${comparable}`;
  const entries = bucket.get(key) ?? [];
  entries.push({ ...entry, canonicalFile: canonicalContentFile(entry.file) });
  bucket.set(key, entries);
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
    code: "META_TEMPLATE_ANSWER",
    pattern: /先给出清晰结论：它解决什么问题|再说明核心机制和关键流程；随后补充复杂度/,
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
    code: "OS_KERNEL_RECALL_TEMPLATE",
    pattern: /内核实现机制是什么？用户态和内核态如何交互？/,
  },
  {
    code: "NETWORK_PACKET_RECALL_TEMPLATE",
    pattern: /协议报文格式是什么？关键字段有哪些含义？/,
  },
  {
    code: "LINUX_TOOL_FOLLOWUP_TEMPLATE",
    pattern: /相关的排查工具有哪些？能举一个实际排查案例吗？/,
  },
  {
    code: "GENERIC_ONLINE_EXCEPTION_TEMPLATE",
    pattern: /如果线上出现与\s*.+?\s*相关的异常/,
  },
  {
    code: "GENERIC_ONLINE_PERF_TEMPLATE",
    pattern: /如果线上服务出现与\s*.+?\s*相关的性能瓶颈或异常/,
  },
  {
    code: "FOUR_STEP_TEMPLATE",
    pattern: /四段式/,
  },
  {
    code: "EXPLAIN_LEARNING_SCAFFOLD",
    pattern: /学透这题的抓手|追问落点|复述校验|必须讲透的主线/,
  },
  {
    code: "GENERIC_COMMON_MISTAKE",
    pattern: /理解不深入|不能手写|不知道如何排查|不清楚和Java\/Spring的异同|不能结合实际项目说明应用场景|只背概念不讲原因|忽略边界条件|缺少面试化表达/,
  },
  {
    code: "MCP_LEGACY_TRANSPORT_ONLY",
    pattern: /stdio\s*和\s*SSE\s*两种传输|stdio和SSE两种传输/,
  },
  {
    code: "JAVA_HASHMAP_RECALL_TEMPLATE",
    pattern: /的底层数据结构是什么？扩容机制和哈希冲突处理方式有什么区别？/,
  },
  {
    code: "JAVA_DCL_RECALL_TEMPLATE",
    pattern: /请手写一个线程安全的单例模式（DCL）/,
  },
  {
    code: "RUBRIC_MACHINE_SPLICE",
    pattern: /准确解释(?:\d+\.|[一二三四五六七八九十]+[、.．])|定义的定义/,
  },
  {
    code: "UNNATURAL_PATCH_LANGUAGE",
    pattern:
      /从零理解可以抓住这条主线|它不是一串名词|把这几层连起来看|深入理解时重点看三个问题|的难点在于把「[^」]+」「[^」]+」「[^」]+」连成因果链|实际使用时，应回到输入规模、执行顺序、依赖状态和可观测证据上验证|验证理解是否落到真实链路|不能只给工具名|到了 .+ 的高阶追问|回答时要给出触发条件、状态变化和验证证据|继续往下看，.+不能只记结论/,
  },
  {
    code: "STALE_MODEL_CONTEXT_TABLE",
    pattern: /GPT-4o 为 128K|Claude 3\.5 为 200K|Gemini 1\.5 Pro/,
  },
  {
    code: "STALE_DOTNET_VERSION_TEMPLATE",
    pattern: /\.NET Core\/8\+|\.NET Core\s*\/\s*\.NET 8\+|\.NET 6\/7\/8/,
  },
];

const issues = [];
for (const topicRoot of ["topics", "staging/topics", "draft/topics"]) {
for (const file of await listJson(topicRoot)) {
  const topic = await readJson(file);
  const fields = [];
  if (typeof topic.interviewerFocus === "string") {
    fields.push(["interviewerFocus", topic.interviewerFocus]);
    rememberDuplicate(exactDuplicateBuckets, "DUPLICATE_INTERVIEWER_FOCUS", topic.interviewerFocus, {
      file,
      title: topic.title,
      field: "interviewerFocus",
    }, 20);
  }

  for (const card of topic.learningCards ?? []) {
    if (typeof card.content === "string") {
      const fenceCount = countMarkdownFenceLines(card.content);
      if (fenceCount % 2 !== 0) {
        issues.push({
          code: "UNBALANCED_MARKDOWN_FENCE",
          file,
          title: topic.title,
          field: `learningCards.${card.type}.${card.title}`,
        });
      }
      if (card.type === "code" && hasMarkdownFenceLine(card.content)) {
        issues.push({
          code: "CODE_CARD_MARKDOWN_FENCE",
          file,
          title: topic.title,
          field: `learningCards.code.${card.title}`,
        });
      }
    }

    if (card.type === "code") {
      const highlights = Array.isArray(card.highlights)
        ? card.highlights
        : card.highlights?.item && Array.isArray(card.highlights.item)
          ? card.highlights.item
          : Array.isArray(card.highlights)
            ? card.highlights
            : [];
      for (const highlight of highlights) {
        if (genericHighlightPatterns.some((pattern) => pattern.test(highlight.note ?? ""))) {
          issues.push({
            code: "GENERIC_CODE_HIGHLIGHT",
            file,
            title: topic.title,
            field: `learningCards.code.${card.title}.highlights.line${highlight.line ?? "?"}`,
          });
        }
      }
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

    if (
      card.type === "diagram" &&
      /关键链路图$/.test(card.title ?? "") &&
      generatedDiagramCaptionPattern.test(card.caption ?? "") &&
      / -> /.test(card.fallback ?? "")
    ) {
      issues.push({
        code: "AUTO_SPLICED_DIAGRAM",
        file,
        title: topic.title,
        field: `learningCards.diagram.${card.title}`,
      });
    }

    if (
      card.type === "diagram" &&
      machineRelationPhrasePattern.test(`${card.title ?? ""}${card.content ?? ""}${card.fallback ?? ""}${card.caption ?? ""}`)
    ) {
      issues.push({
        code: "MACHINE_RELATION_DIAGRAM",
        file,
        title: topic.title,
        field: `learningCards.diagram.${card.title}`,
      });
    }

    if (typeof card.content === "string") {
      for (const emptyHeading of findEmptyMarkdownHeadings(card.content)) {
        issues.push({
          code: "EMPTY_MARKDOWN_HEADING",
          file,
          title: topic.title,
          field: `learningCards.${card.type}.${card.title}:L${emptyHeading.line}:${emptyHeading.title}`,
        });
      }
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
      if (key === "commonMistakes") {
        rememberDuplicate(exactDuplicateBuckets, "DUPLICATE_COMMON_MISTAKE", item, {
          file,
          title: topic.title,
          field: `rubric.${key}`,
        }, 12);
      }
    }
  }

  for (const [name, text] of fields) {
    rememberDuplicate(longDuplicateBuckets, "DUPLICATE_LONG_TEXT", text, {
      file,
      title: topic.title,
      field: name,
    }, 100);

    for (const check of checks) {
      if (check.pattern.test(text)) {
        issues.push({ code: check.code, file, title: topic.title, field: name });
      }
    }
    if (topic.domain !== "algorithm" && algorithmTemplateLeakPattern.test(text)) {
      issues.push({ code: "ALGORITHM_TEMPLATE_LEAK", file, title: topic.title, field: name });
    }
    if (/^rubric\./.test(name) && machineRelationPhrasePattern.test(text)) {
      issues.push({ code: "MACHINE_RELATION_RUBRIC", file, title: topic.title, field: name });
    }
  }

  const explainTitles = new Set();
  const explainContents = new Map();
  for (const card of topic.learningCards ?? []) {
    if (card.type !== "explain") continue;
    if (!(card.content ?? "").trim()) {
      issues.push({
        code: "EMPTY_EXPLAIN_CONTENT",
        file,
        title: topic.title,
        field: `learningCards.explain.${card.title}`,
      });
    }
    if (/^\s*\/\//.test(card.title ?? "")) {
      issues.push({
        code: "CODE_COMMENT_EXPLAIN_TITLE",
        file,
        title: topic.title,
        field: `learningCards.explain.${card.title}`,
      });
    }
    if (/(?:（续）|\(续\)|续篇|第\s*\d+\s*部分|(?:^|[：:\s])续(?:$|[：:\s]))/.test(card.title ?? "")) {
      issues.push({
        code: "CONTINUATION_EXPLAIN_TITLE",
        file,
        title: topic.title,
        field: `learningCards.explain.${card.title}`,
      });
    }
    if (explainTitles.has(card.title)) {
      issues.push({
        code: "DUPLICATE_EXPLAIN_TITLE",
        file,
        title: topic.title,
        field: `learningCards.explain.${card.title}`,
      });
    }
    explainTitles.add(card.title);

    const titleSegments = (card.title ?? "")
      .split(/[：:、，,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 2);
    if (titleSegments.some((s, i) => titleSegments.indexOf(s) !== i)) {
      issues.push({
        code: "REPEATED_TITLE_SEGMENT",
        file,
        title: topic.title,
        field: `learningCards.explain.${card.title}`,
      });
    }

    const comparableContent = normalizeComparableText(card.content);
    if (comparableContent.length >= 120) {
      const previousTitle = explainContents.get(comparableContent);
      if (previousTitle) {
        issues.push({
          code: "DUPLICATE_EXPLAIN_CONTENT",
          file,
          title: topic.title,
          field: `learningCards.explain.${previousTitle} / ${card.title}`,
        });
      }
      explainContents.set(comparableContent, card.title);
    }
  }
}
}

for (const bucket of [exactDuplicateBuckets, longDuplicateBuckets]) {
  for (const [key, entries] of bucket.entries()) {
    const uniqueEntries = Array.from(
      new Map(entries.map((entry) => [`${entry.canonicalFile}:${entry.field}`, entry])).values(),
    );
    if (uniqueEntries.length < 3) continue;
    const [code] = key.split("\t");
    const sample = uniqueEntries
      .slice(0, 5)
      .map((entry) => `${entry.file}:${entry.field}`)
      .join(", ");
    issues.push({
      code,
      file: uniqueEntries[0].file,
      title: uniqueEntries[0].title,
      field: `${uniqueEntries.length} repeated fields; examples: ${sample}`,
    });
  }
}

if (issues.length > 0) {
  for (const issue of issues) {
    console.log(`${issue.code}\t${issue.file}\t${issue.title}\t${issue.field}`);
  }
  process.exitCode = 1;
} else {
  console.log("Quality scan passed: no template text, duplicated explain titles/content, unsafe code-language labels, broken markdown fences, generic frontend follow-up, placeholder answer, or unsafe inline numbering found.");
}
