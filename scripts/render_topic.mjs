#!/usr/bin/env node
// 把一篇 topic JSON 渲染成终端可读的文字版，方便直观看生成效果（测试模式用）。
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("用法：node scripts/render_topic.mjs <topic.json>");
  process.exit(1);
}
const topic = JSON.parse(readFileSync(file, "utf8"));

const useColor = process.stdout.isTTY;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = (text) => paint("1", text);
const cyan = (text) => paint("36", text);
const dim = (text) => paint("2", text);
const yellow = (text) => paint("33", text);
const green = (text) => paint("32", text);
const width = Math.min(process.stdout.columns || 90, 90);
const rule = (char = "─") => dim(char.repeat(width));
const out = (text = "") => console.log(text);
const h1 = (text) => {
  out(`\n${bold(cyan(`█ ${text}`))}`);
  out(rule());
};
const h2 = (text) => out(`\n${bold(yellow(`▸ ${text}`))}`);

const typeLabel = {
  explain: "讲解",
  interviewAnswer: "面试回答",
  checklist: "清单",
  compareTable: "对比表",
  code: "代码",
  diagram: "图示",
  animation: "动画",
};

function stringify(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function renderContent(card) {
  if (card.content) out(card.content);
  else if (card.fallback) out(card.fallback);
  else if (card.asset) out(dim(`资源：${card.asset}`));
  else if (card.svgPath) out(dim(`SVG：${card.svgPath}`));
  else if (card.svg) out(card.svg);
}

function renderCompareTable(columns = [], rows = []) {
  if (!columns.length) return;
  out(dim(`列：${columns.join("  |  ")}`));
  for (const row of rows) {
    out(`  • ${bold(String(row[0] ?? ""))}`);
    for (let index = 1; index < columns.length; index += 1) {
      out(`      ${dim(`${columns[index]}：`)}${row[index] ?? ""}`);
    }
  }
}

out(rule("═"));
out(`${bold(topic.title ?? "(无标题)")}  ${dim(`[${topic.domain} / ${topic.category}]  难度 ${topic.difficulty ?? "?"}  状态 ${topic.status}`)}`);
out(dim(`id：${topic.id ?? ""}    updatedAt：${topic.updatedAt ?? "?"}`));
if (topic.summary) out(topic.summary);
if (topic.interviewerFocus) out(dim(`面试官关注：${topic.interviewerFocus}`));
if (topic.tags?.length) out(dim(`标签：${topic.tags.join(" · ")}`));
out(rule("═"));

for (const card of topic.learningCards ?? []) {
  h1(`${typeLabel[card.type] ?? card.type}：${card.title ?? ""}`);
  switch (card.type) {
    case "explain":
      renderContent(card);
      break;
    case "interviewAnswer":
      renderContent(card);
      if (card.followUpQuestions?.length) {
        h2("追问 / 应对");
        card.followUpQuestions.forEach((item, index) => {
          out(`${green(`Q${index + 1}`)} ${item.question ?? ""}`);
          out(`${dim("A  ")}${item.answer ?? ""}`);
        });
      }
      break;
    case "checklist":
      if (card.content) out(card.content);
      for (const item of card.items ?? []) out(`  ☐ ${stringify(item)}`);
      break;
    case "compareTable":
      if (card.content) out(card.content);
      renderCompareTable(card.columns, card.rows);
      if (card.caption) out(dim(card.caption));
      break;
    case "code":
      out(dim(`\`\`\`${card.language ?? ""}`));
      out(card.content ?? "");
      out(dim("```"));
      if (card.highlights?.length) {
        h2("代码要点");
        for (const hl of card.highlights) out(`  • ${hl.note ?? hl.text ?? JSON.stringify(hl)}`);
      }
      break;
    case "diagram":
      if (card.format) out(dim(`format：${card.format}`));
      renderContent(card);
      if (card.caption) out(dim(card.caption));
      break;
    case "animation":
      renderContent(card);
      if (card.caption) out(dim(card.caption));
      break;
    default:
      out(card.content ?? stringify(card));
  }
}

if (topic.rubric) {
  h1("评分量规 rubric");
  const rubric = topic.rubric;
  if (rubric.mustHave?.length) {
    h2("必答 mustHave");
    for (const item of rubric.mustHave) out(`  • ${item}`);
  }
  if (rubric.goodToHave?.length) {
    h2("加分 goodToHave");
    for (const item of rubric.goodToHave) out(`  • ${item}`);
  }
  if (rubric.commonMistakes?.length) {
    h2("常见错误 commonMistakes");
    for (const item of rubric.commonMistakes) out(`  • ${item}`);
  }
  if (rubric.scoreWeights) out(dim(`\n权重：${JSON.stringify(rubric.scoreWeights)}`));
}

if (topic.recallPrompts?.length) {
  h1("复述题 recallPrompts");
  topic.recallPrompts.forEach((prompt, index) => out(`  ${index + 1}. ${prompt.prompt ?? prompt}`));
}
out("");
