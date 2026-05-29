#!/usr/bin/env node
/**
 * 修复两个问题：
 * 1. 拆分超长 explain 卡片（>800 字符的单个 explain）
 * 2. 修复泛化/过短 summary
 *
 * 用法: node scripts/fix_explain_and_summary.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const TOPICS_DIR = path.resolve('topics');

function getAllTopicFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...getAllTopicFiles(full));
    else if (entry.name.endsWith('.json')) files.push(full);
  }
  return files;
}

// ========== Explain 拆分 ==========

function splitExplainCard(card) {
  const content = card.content || '';
  if (content.length <= 800) return null; // 不需要拆分

  const lines = content.split('\n');
  const totalLen = content.length;

  // 找到合适的拆分点：优先在 ## 标题处拆分
  const h2Indices = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^## /.test(lines[i])) h2Indices.push(i);
  }

  let splitLine = -1;

  if (h2Indices.length >= 2) {
    // 找到最接近中间的 h2 标题
    const midLine = Math.floor(lines.length / 2);
    let bestIdx = h2Indices[0];
    let bestDist = Math.abs(h2Indices[0] - midLine);
    for (const idx of h2Indices) {
      const dist = Math.abs(idx - midLine);
      if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
    }
    // 确保拆分后两部分都不太短
    const part1Len = lines.slice(0, bestIdx).join('\n').length;
    if (part1Len > 200 && (totalLen - part1Len) > 200) {
      splitLine = bestIdx;
    }
  }

  if (splitLine === -1) {
    // 找不到好的 h2 拆分点，在段落边界拆分
    const midLine = Math.floor(lines.length / 2);
    // 从中间向前找空行
    for (let i = midLine; i >= Math.max(0, midLine - 20); i--) {
      if (lines[i].trim() === '' && i > 3) { splitLine = i + 1; break; }
    }
    if (splitLine === -1) {
      // 从中间向后找空行
      for (let i = midLine; i < Math.min(lines.length, midLine + 20); i++) {
        if (lines[i].trim() === '' && i > 3) { splitLine = i + 1; break; }
      }
    }
  }

  if (splitLine === -1 || splitLine < 3) return null; // 无法找到好的拆分点

  const part1 = lines.slice(0, splitLine).join('\n').trim();
  const part2 = lines.slice(splitLine).join('\n').trim();

  if (part1.length < 200 || part2.length < 200) return null;

  // 确定第一张卡片的标题
  const title1 = card.title || '核心概念';
  const title2 = card.title === '核心概念' ? '深入理解' :
                 card.title === '知识全景' ? '深入理解' :
                 card.title + '（续）';

  return [
    { type: 'explain', title: title1, content: part1 },
    { type: 'explain', title: title2, content: part2 },
  ];
}

// ========== Summary 修复 ==========

const GENERIC_SUMMARY_PATTERNS = [
  /深入理解.+的核心原理与关键机制，掌握面试高频考点和实际应用/,
  /深入理解.+的核心原理与关键机制/,
  /掌握面试高频考点和实际应用/,
  /准确解释.+的定义和作用/,
  /准确解释.+定义和作用；能结合实际场景说明/,
  /能说清.+的关键机制/,
];

function isGenericSummary(summary, title) {
  if (!summary || summary.trim().length === 0) return true;
  if (summary.trim().length < 20) return true;
  // 检查是否与标题重复
  if (summary.trim() === title.trim()) return true;
  if (summary.trim() === title.trim() + '实战') return true;
  // 检查是否是泛化模板（必须完全匹配模式，不能包含具体技术术语）
  if (/^深入理解.+的核心原理与关键机制$/.test(summary.trim())) return true;
  if (/^深入理解.+的核心原理与关键机制，掌握面试高频考点和实际应用。?$/.test(summary.trim())) return true;
  // 检查是否是 mustHave 风格的文本（以"准确解释"开头）
  if (/^准确解释/.test(summary.trim())) return true;
  // 检查是否只是标题的简单变体
  if (summary.trim() === `深入理解${title}的核心原理与关键机制`) return true;
  return false;
}

function generateSummary(topic) {
  const title = topic.title || '';
  const domain = topic.domain || '';
  const category = topic.category || '';
  const cards = topic.learningCards || [];

  // 从 explain 卡片中提取第一段有意义的内容
  const explainCards = cards.filter(c => c.type === 'explain');
  const firstExplain = explainCards[0]?.content || '';
  const paragraphs = firstExplain.split(/\n\n+/).filter(p => {
    const t = p.trim();
    return t.length > 20 && !t.startsWith('#') && !t.startsWith('```') && !t.startsWith('|') && !t.startsWith('┌');
  });

  // 从 checklist 中提取关键能力点
  const clCard = cards.find(c => c.type === 'checklist');
  const clItems = clCard?.items || [];

  // 从 rubric mustHave 中提取关键点
  const mustHave = topic.rubric?.mustHave || [];
  const goodMustHave = mustHave.filter(m =>
    !m.includes('定义准确') && !m.includes('面试表达') && !m.includes('关键机制') &&
    !m.includes('准确解释') && !m.includes('定义和作用') && !m.includes('能说清') &&
    !m.includes('能结合实际') && !m.includes('能区分') &&
    !m.startsWith('理解') && !m.startsWith('能') && m.length > 10
  );

  // 策略1：用第一个有意义的段落的前两句
  if (paragraphs.length > 0) {
    const firstPara = paragraphs[0].replace(/^#+\s+/gm, '').replace(/\*\*/g, '');
    const sentences = firstPara.split(/[。！？]/).filter(s => s.trim().length > 8);
    if (sentences.length >= 2) {
      let summary = sentences.slice(0, 2).map(s => s.trim()).join('，') + '。';
      if (summary.length >= 30 && summary.length <= 150) return summary;
    }
    if (sentences.length >= 1) {
      let summary = sentences[0].trim();
      if (!summary.endsWith('。')) summary += '。';
      if (summary.length >= 30 && summary.length <= 150) return summary;
    }
  }

  // 策略2：用 mustHave 的前 2-3 个点构造
  if (goodMustHave.length >= 2) {
    const summary = goodMustHave.slice(0, 3).join('；') + '。';
    if (summary.length >= 30 && summary.length <= 150) return summary;
  }

  // 策略3：从 explain 卡片中提取关键知识点
  if (explainCards.length > 0) {
    const allText = explainCards.map(c => c.content || '').join('\n');
    // 提取加粗术语
    const boldTerms = [];
    const boldRegex = /\*\*([^*]{4,30})\*\*/g;
    let match;
    while ((match = boldRegex.exec(allText)) !== null) {
      const term = match[1].trim();
      if (!term.includes('：') && !term.includes(':') && !term.includes('|') &&
          !term.startsWith('第') && !term.startsWith('注')) {
        boldTerms.push(term);
      }
    }
    const uniqueTerms = [...new Set(boldTerms)].slice(0, 4);
    if (uniqueTerms.length >= 2) {
      return `掌握${title}中${uniqueTerms.join('、')}等核心概念，理解其原理和实际应用。`;
    }
  }

  // 策略4：从 explain 的 h2 标题中提取关键概念
  if (explainCards.length > 0) {
    const allText = explainCards.map(c => c.content || '').join('\n');
    const h2s = [];
    const h2Regex = /^## (.+)$/gm;
    let match;
    while ((match = h2Regex.exec(allText)) !== null) {
      const h = match[1].replace(/[一二三四五六七八九十]+[、.．]\s*/g, '').trim();
      if (h.length > 2 && h.length < 30) h2s.push(h);
    }
    if (h2s.length >= 2) {
      return `理解${title}的${h2s.slice(0, 3).join('、')}等核心知识点，掌握面试中的高频考点。`;
    }
  }

  // 策略5：基于标题和领域生成（最后手段）
  const domainDesc = {
    java: 'Java开发',
    os: '操作系统',
    network: '计算机网络',
    frontend: '前端开发',
    agent: 'AI Agent开发',
    algorithm: '算法与数据结构',
    'design-pattern': '设计模式',
    architecture: '架构设计',
    dotnet: '.NET开发',
  };

  return `理解${title}的核心原理和实现机制，掌握其在${domainDesc[domain] || domain}面试中的高频考点和应用。`;
}

// ========== 主流程 ==========

function main() {
  console.log('=== 修复 Explain 拆分 + Summary 优化 ===\n');
  if (DRY_RUN) console.log('🔍 DRY RUN 模式\n');

  const allFiles = getAllTopicFiles(TOPICS_DIR);
  console.log(`扫描到 ${allFiles.length} 个 topic 文件\n`);

  let explainFixed = 0;
  let summaryFixed = 0;
  let totalErrors = 0;
  const explainByDomain = {};
  const summaryByDomain = {};

  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const topic = JSON.parse(raw);
      const domain = topic.domain || 'unknown';
      let modified = false;

      // === 修复 Explain 拆分 ===
      const cards = topic.learningCards || [];
      const explainCount = cards.filter(c => c.type === 'explain').length;
      const newCards = [];
      for (const card of cards) {
        if (card.type === 'explain' && explainCount === 1) {
            // 只对只有1张explain卡片且内容>800字符的topic进行拆分
          const split = splitExplainCard(card);
          if (split) {
            newCards.push(...split);
            explainFixed++;
            explainByDomain[domain] = (explainByDomain[domain] || 0) + 1;
            modified = true;
            if (explainFixed <= 5) {
              console.log(`✂️  Explain拆分: ${topic.id} (${card.content.length} 字符 → ${split[0].content.length} + ${split[1].content.length})`);
            }
          } else {
            newCards.push(card);
          }
        } else {
          newCards.push(card);
        }
      }
      if (newCards.length !== cards.length) {
        topic.learningCards = newCards;
      }

      // === 修复 Summary ===
      if (isGenericSummary(topic.summary, topic.title)) {
        const newSummary = generateSummary(topic);
        if (newSummary && newSummary !== topic.summary && !isGenericSummary(newSummary, topic.title)) {
          topic.summary = newSummary;
          summaryFixed++;
          summaryByDomain[domain] = (summaryByDomain[domain] || 0) + 1;
          modified = true;
          if (summaryFixed <= 5) {
            console.log(`📝 Summary修复: ${topic.id} (${topic.title})`);
            console.log(`   旧: ${topic.summary.substring(0, 60)}...`);
            console.log(`   新: ${newSummary.substring(0, 60)}...`);
            console.log();
          }
        }
      }

      if (modified && !DRY_RUN) {
        fs.writeFileSync(filePath, JSON.stringify(topic, null, 2) + '\n');
      }
    } catch (err) {
      totalErrors++;
      console.error(`❌ ${filePath}: ${err.message}`);
    }
  }

  console.log('\n=== 修复统计 ===');
  console.log(`\nExplain 拆分:`);
  console.log(`  已拆分: ${explainFixed} 个`);
  for (const [d, c] of Object.entries(explainByDomain).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${d}: ${c}`);
  }

  console.log(`\nSummary 修复:`);
  console.log(`  已修复: ${summaryFixed} 个`);
  for (const [d, c] of Object.entries(summaryByDomain).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${d}: ${c}`);
  }

  console.log(`\n错误: ${totalErrors} 个`);
}

main();
