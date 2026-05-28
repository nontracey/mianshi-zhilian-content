/**
 * 修复 explain 卡片中代码块的缩进丢失问题。
 *
 * 根因：pickExcerpt() 中 .map(line => line.trim()) 把代码块内的行首缩进也去掉了。
 * 本脚本遍历所有 topic JSON，对 explain 卡片内容中的围栏代码块做智能重缩进。
 *
 * 用法：node scripts/fix_code_indentation.mjs [--dry-run]
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const INDENT = "    "; // 4 spaces

// ── 缩进引擎 ──────────────────────────────────────────────

/**
 * 根据语言对代码块做智能重缩进。
 * 主要支持 Java/C/JS/TS 等大括号语言，以及 Python 等冒号语言。
 */
function reindentCode(code, language) {
  const lang = (language || "").toLowerCase();

  // SQL / Shell / YAML 等不需要大括号缩进的语言，直接返回
  if (["sql", "bash", "sh", "shell", "yaml", "yml", "toml", "properties", "xml", "html", "css"].includes(lang)) {
    return code;
  }

  // Python 用冒号缩进
  if (["python", "py"].includes(lang)) {
    return reindentByColon(code);
  }

  // 默认：大括号语言（java, javascript, js, typescript, ts, c, cpp, csharp, cs, go, rust, dart, kotlin, scala 等）
  return reindentByBraces(code);
}

/**
 * 大括号语言缩进恢复
 */
function reindentByBraces(code) {
  const lines = code.split("\n");
  const result = [];
  let depth = 0;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    // 空行保留
    if (trimmed === "") {
      result.push("");
      continue;
    }

    // 多行注释块追踪
    if (inBlockComment) {
      result.push(INDENT.repeat(depth) + trimmed);
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    // 以 } 或 ) 结尾的行（闭合）→ 先减深度
    // 但要处理一行中既有 } 又有 { 的情况
    const closeCount = countChar(trimmed, "}");
    const openCount = countChar(trimmed, "{");

    // 如果行以 } 开头，减缩进
    if (trimmed.startsWith("}")) {
      depth = Math.max(0, depth - 1);
    }

    // 特殊处理：else、catch、finally 等需要和对应的 } 同级
    if (/^(}\s*)?(else|catch|finally)\b/.test(trimmed) && trimmed.startsWith("}")) {
      // } else { 这种情况，depth 已经减过了，输出后要加回来
      result.push(INDENT.repeat(depth) + trimmed);
      if (trimmed.endsWith("{")) {
        depth++;
      }
      continue;
    }

    // case / default：减少一级缩进
    if (/^(case\s|default\s*:)/.test(trimmed)) {
      const caseIndent = Math.max(0, depth - 1);
      result.push(INDENT.repeat(caseIndent) + trimmed);
      continue;
    }

    // 普通行
    result.push(INDENT.repeat(depth) + trimmed);

    // 计算深度变化
    // 开括号增加深度（但排除字符串和注释中的括号）
    if (!trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
      if (trimmed.endsWith("{")) {
        depth++;
      } else if (openCount > closeCount) {
        depth += (openCount - closeCount);
      } else if (closeCount > openCount) {
        depth = Math.max(0, depth - (closeCount - openCount));
      }
    }

    // 检测多行注释开始
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
    }
  }

  return result.join("\n");
}

/**
 * Python 冒号缩进恢复
 */
function reindentByColon(code) {
  const lines = code.split("\n");
  const result = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      result.push("");
      continue;
    }

    // 以 } 或 ] 结尾 → 减少缩进
    if (trimmed.startsWith("}") || trimmed.startsWith("]")) {
      depth = Math.max(0, depth - 1);
    }

    // dedent 关键字
    if (/^(elif |else:|except |finally:)/.test(trimmed)) {
      depth = Math.max(0, depth - 1);
    }

    result.push(INDENT.repeat(depth) + trimmed);

    // 以冒号结尾 → 增加缩进
    if (trimmed.endsWith(":") && !trimmed.startsWith("#")) {
      depth++;
    }

    // 以 { 或 [ 结尾 → 增加缩进
    if (trimmed.endsWith("{") || trimmed.endsWith("[")) {
      depth++;
    }

    // 以 } 或 ] 开头已经减过了
  }

  return result.join("\n");
}

function countChar(str, ch) {
  let count = 0;
  for (const c of str) {
    if (c === ch) count++;
  }
  return count;
}

// ── 代码块提取与替换 ──────────────────────────────────────

/**
 * 在 Markdown 内容中找到围栏代码块，对代码内容做缩进修复后替换回去。
 */
function fixCodeBlocksInContent(content) {
  // 匹配 ```lang\n...\n``` 格式
  const regex = /(```[a-zA-Z0-9_-]*\n)([\s\S]*?)(```)/g;

  return content.replace(regex, (match, open, code, close) => {
    const langMatch = open.match(/```([a-zA-Z0-9_-]*)/);
    const language = langMatch?.[1] || "";

    // 如果代码已经有正确缩进（至少有一行以 4 空格开头），跳过
    const codeLines = code.split("\n").filter(l => l.trim());
    const hasIndentation = codeLines.some(l => /^(    |\t)/.test(l));
    if (hasIndentation) {
      return match;
    }

    // 如果代码行数太少（1-2 行），不需要重缩进
    if (codeLines.length <= 2) {
      return match;
    }

    // 检查是否是 ASCII 图形（box-drawing），跳过
    if (/[┌┐└┘├┤┬┴┼│─═╔╗╚╝╠╣╦╩╬]/.test(code)) {
      return match;
    }

    // 执行缩进修复
    const fixed = reindentCode(code.trimEnd(), language);
    return open + fixed + "\n" + close;
  });
}

// ── 主流程 ──────────────────────────────────────────────

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const files = (await walk(path.join(repoRoot, "topics"))).sort();

  let fixedFiles = 0;
  let fixedBlocks = 0;

  for (const filePath of files) {
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    let changed = false;

    for (const card of data.learningCards || []) {
      if (card.type !== "explain") continue;

      const original = card.content;
      const fixed = fixCodeBlocksInContent(original);

      if (fixed !== original) {
        card.content = fixed;
        changed = true;
        // 统计修复了多少个代码块
        const originalBlocks = (original.match(/```[a-zA-Z0-9_-]*\n[\s\S]*?```/g) || []).length;
        const fixedBlocksInContent = (fixed.match(/```[a-zA-Z0-9_-]*\n[\s\S]*?```/g) || []).length;
        fixedBlocks += Math.max(originalBlocks, fixedBlocksInContent);
      }
    }

    if (changed) {
      fixedFiles++;
      if (!DRY_RUN) {
        await writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
      }
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}修复完成：`);
  console.log(`  - 扫描文件：${files.length}`);
  console.log(`  - 修复文件：${fixedFiles}`);
  console.log(`  - 修复代码块：~${fixedBlocks}`);
  if (DRY_RUN) {
    console.log(`\n使用不带 --dry-run 的命令执行实际修复`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
