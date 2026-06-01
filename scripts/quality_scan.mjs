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
];

const issues = [];
for (const file of await listJson("topics")) {
  const topic = await readJson(file);
  const fields = [];

  for (const card of topic.learningCards ?? []) {
    if (card.type === "code") continue;

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
}

if (issues.length > 0) {
  for (const issue of issues) {
    console.log(`${issue.code}\t${issue.file}\t${issue.title}\t${issue.field}`);
  }
  process.exitCode = 1;
} else {
  console.log("Quality scan passed: no template text, generic frontend follow-up, placeholder answer, or unsafe inline numbering found.");
}
