#!/usr/bin/env node
/**
 * 修复 followUpQuestions 泛化问题 v2
 * 核心策略：基于 topic 的实际内容（explain 卡片、compareTable、checklist、rubric）
 * 生成真正有针对性的追问链
 *
 * 用法: node scripts/fix_followup_v2.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const TOPICS_DIR = path.resolve('topics');

// ========== 工具函数 ==========

function getAllTopicFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...getAllTopicFiles(full));
    else if (entry.name.endsWith('.json')) files.push(full);
  }
  return files;
}

function isGenericFollowUp(followUps) {
  if (!followUps || followUps.length === 0) return true;
  const genericAnswers = [
    '在项目中做选择时，我通常会考虑几个维度',
    '关键要理解它的底层机制',
    '性能需求、团队熟悉度、维护成本',
    '没有绝对的最优解',
    '在实际开发中，这直接影响到我们如何选择合适的方案',
  ];
  return followUps.some(fu => {
    const a = fu.answer || '';
    return genericAnswers.some(p => a.includes(p));
  });
}

// ========== 内容提取 ==========

function extractContent(topic) {
  const title = topic.title || '';
  const summary = topic.summary || '';
  const domain = topic.domain || '';
  const category = topic.category || '';

  // 提取 explain 卡片内容
  const explains = (topic.learningCards || []).filter(c => c.type === 'explain');
  const allExplainText = explains.map(c => c.content || '').join('\n\n');

  // 提取 explain 卡片的标题
  const explainTitles = explains.map(c => c.title || '').filter(Boolean);

  // 提取 compareTable
  const ctCard = (topic.learningCards || []).find(c => c.type === 'compareTable');
  const ctContent = ctCard ? (ctCard.content || '') : '';

  // 提取 checklist
  const clCard = (topic.learningCards || []).find(c => c.type === 'checklist');
  const clItems = clCard ? (clCard.items || []) : [];

  // 提取 interviewAnswer 中的高频问题
  const iaCard = (topic.learningCards || []).find(c => c.type === 'interviewAnswer');
  const iaContent = iaCard ? (iaCard.content || '') : '';
  const existingQs = [];
  const qRegex = /\*\*高频问题\d+：(.+?)\*\*/g;
  let m;
  while ((m = qRegex.exec(iaContent)) !== null) existingQs.push(m[1].trim());

  // 提取 rubric 中的 mustHave 和 commonMistakes
  const rubric = topic.rubric || {};
  const mustHave = rubric.mustHave || [];
  const commonMistakes = rubric.commonMistakes || [];

  // 提取 markdown 二级标题作为核心知识点
  const h2s = [];
  const h2Regex = /^## (.+)$/gm;
  while ((m = h2Regex.exec(allExplainText)) !== null) {
    const h = m[1].replace(/[一二三四五六七八九十]+[、.．]\s*/g, '').trim();
    if (h.length > 1 && h.length < 40) h2s.push(h);
  }

  // 提取 explain 中的关键段落（第一段通常是定义/概述）
  const paragraphs = allExplainText.split(/\n\n+/).filter(p => {
    const t = p.trim();
    return t.length > 30 && !t.startsWith('#') && !t.startsWith('```') && !t.startsWith('|') && !t.startsWith('┌') && !t.startsWith('│');
  });

  return {
    title, summary, domain, category,
    explainTitles, allExplainText, paragraphs,
    ctContent, clItems, existingQs,
    mustHave, commonMistakes, h2s,
  };
}

// ========== 追问生成核心 ==========

function generateFollowUps(topic) {
  const c = extractContent(topic);
  const followUps = [];

  // === 追问1: 面试官追问深层原理 ===
  // 策略: 基于 topic 标题和 explain 内容，问一个面试官常问的深入问题
  const q1 = generateQ1(c);
  const a1 = generateA1(c);
  followUps.push({ question: q1, answer: a1 });

  // === 追问2: 实际场景/对比/选型 ===
  const q2 = generateQ2(c);
  const a2 = generateA2(c);
  followUps.push({ question: q2, answer: a2 });

  // === 追问3: 常见误区/踩坑（高难度或内容丰富时）===
  if ((topic.difficulty || 2) >= 3 || c.commonMistakes.length >= 2 || c.clItems.length >= 5) {
    const q3 = generateQ3(c);
    const a3 = generateA3(c);
    followUps.push({ question: q3, answer: a3 });
  }

  return followUps;
}

// ========== 追问1: 深层原理 ==========

function generateQ1(c) {
  const { title, h2s, explainTitles, domain, category } = c;

  // 从 explain 卡片标题中找"深入理解"或第二个标题
  const deepTitle = explainTitles.find(t => t.includes('深入')) || explainTitles[1] || '';

  // 从 h2s 中找到除了"什么是"之外的核心概念
  const coreConcepts = h2s.filter(h =>
    !h.startsWith('什么是') && !h.startsWith('概述') &&
    !h.startsWith('总结') && !h.startsWith('参考')
  );

  // 领域特定的追问模式
  const domainQ = {
    java: {
      jvm: () => `能说说${title}中${coreConcepts[0] || '核心机制'}的具体实现原理吗？`,
      concurrent: () => `${title}底层是怎么保证线程安全的？能从源码层面解释一下吗？`,
      collection: () => `${title}的底层数据结构是什么？扩容/缩容机制是怎样的？`,
      spring: () => `${title}在Spring源码中的核心流程是怎样的？`,
      database: () => `${title}的底层存储结构是什么？查询优化的关键在哪里？`,
      middleware: () => `${title}的核心架构是怎样的？消息流转/数据处理的关键路径是什么？`,
      'new-features': () => `${title}的编译器/VM层面是怎么处理的？和旧写法相比性能差异在哪里？`,
    },
    os: {
      'process-thread': () => `${title}在Linux内核层面是怎么实现的？涉及到哪些系统调用或内核数据结构？`,
      'memory-management': () => `${title}的地址转换/内存分配过程是怎样的？`,
      'io-model': () => `${title}的内核实现机制是什么？数据从网卡到用户空间经历了什么？`,
      'linux-basics': () => `${title}背后涉及哪些内核机制或系统原理？`,
    },
    network: {
      'tcp-udp': () => `${title}在协议报文层面的具体字段和含义是什么？`,
      'http-https': () => `${title}的协议细节是怎样的？比如报文格式、握手流程等关键步骤？`,
      'dns-cdn': () => `${title}的完整查询/分发流程中，每一步涉及哪些服务器和协议？`,
      websocket: () => `${title}的握手过程和帧格式是怎样的？`,
    },
    frontend: {
      javascript: () => `${title}在V8引擎中的执行机制是怎样的？`,
      react: () => `${title}在React Fiber架构中的调度/渲染流程是怎样的？`,
      vue: () => `${title}在Vue响应式系统中的实现原理是什么？`,
      typescript: () => `${title}的类型推导/类型检查机制是怎样的？`,
      engineering: () => `${title}的底层实现原理是什么？比如webpack/vite的处理流程？`,
    },
    agent: () => `${title}的技术细节能展开说说吗？比如${coreConcepts[0] || '核心流程'}的具体实现？`,
    algorithm: () => `${title}的时间复杂度和空间复杂度分别是多少？能推导一下吗？`,
    'design-pattern': () => `${title}的UML类图是怎样的？核心抽象方法和具体实现分别是什么？`,
    architecture: () => `${title}在大规模系统中的具体实现方案是什么？有哪些关键设计决策？`,
    dotnet: () => `${title}在CLR/.NET运行时中的实现原理是什么？`,
  };

  // 获取追问
  const domainFn = typeof domainQ[domain] === 'function' ? domainQ[domain] : domainQ[domain]?.[category];
  if (domainFn) return domainFn();

  // 通用回退
  if (coreConcepts.length > 0) {
    return `能深入解释一下"${coreConcepts[0]}"的具体原理和实现细节吗？`;
  }
  return `关于${title}，能从原理层面展开讲讲吗？`;
}

function generateA1(c) {
  const { title, paragraphs, h2s, explainTitles, mustHave } = c;

  // 从 paragraphs 中找包含技术细节的段落（非首段，因为首段通常是定义）
  const detailParagraphs = paragraphs.filter((p, i) => {
    if (i === 0 && p.length < 100) return false; // 跳过过短的首段
    // 优先选择包含具体技术描述的段落
    return p.length > 40;
  });

  // 提取关键信息点
  const keyPoints = [];

  // 从 mustHave 中提取关键点
  if (mustHave.length > 0) {
    const relevantMustHave = mustHave.filter(m =>
      !m.includes('定义准确') && !m.includes('面试表达') && !m.includes('关键机制')
    ).slice(0, 3);
    keyPoints.push(...relevantMustHave);
  }

  // 从 explain 中提取关键句
  if (detailParagraphs.length > 0) {
    const sentences = detailParagraphs[0]
      .split(/[。；\n]/)
      .filter(s => s.trim().length > 15 && s.trim().length < 200)
      .slice(0, 3);
    keyPoints.push(...sentences.map(s => s.trim()));
  }

  if (keyPoints.length >= 2) {
    return `这个问题可以从几个层面来回答。${keyPoints[0]}。` +
      `${keyPoints[1]}。` +
      (keyPoints[2] ? `${keyPoints[2]}。` : '') +
      `把这些要点串起来，就能给面试官一个有深度的回答。`;
  }

  // 回退：用 summary 和 h2s 构造
  const concept = h2s[0] || title;
  return `关于${concept}，核心要理解其内部机制。` +
    `从实现角度看，它涉及到数据结构的选择和算法的优化。` +
    `建议从源码层面分析其核心流程，特别关注关键方法的实现细节。`;
}

// ========== 追问2: 场景/对比 ==========

function generateQ2(c) {
  const { title, ctContent, clItems, domain, category, existingQs } = c;

  // 如果有 compareTable，基于对比维度提问
  if (ctContent) {
    const rows = ctContent.split('\n').filter(l => l.includes('|') && !l.includes('---') && !l.startsWith('| 对比'));
    if (rows.length >= 2) {
      const cols = ctContent.split('\n')[0].split('|').map(s => s.trim()).filter(Boolean);
      // 过滤掉表头占位列
      const realCols = cols.filter(c => c !== '对比项' && c !== '维度' && c !== '特性' && c.length > 1);
      if (realCols.length >= 2) {
        return `实际项目中，${realCols[0]}和${realCols[1]}你会怎么选？能结合具体场景说说吗？`;
      }
    }
  }

  // 如果有 checklist 中包含排查/优化相关项
  const debugItem = clItems.find(i =>
    i.includes('排查') || i.includes('优化') || i.includes('解决') ||
    i.includes('监控') || i.includes('调优')
  );
  if (debugItem) {
    return `在生产环境遇到${title}相关的问题，你的排查思路是什么？`;
  }

  // 领域特定的场景问题
  const domainQ = {
    java: `你在项目中用过${title}吗？能说说实际使用场景和踩过的坑吗？`,
    os: `${title}相关的内核参数调优你会怎么做？`,
    network: `线上出现${title}相关的问题（如连接异常、性能下降），你怎么排查？`,
    frontend: `${title}在你们项目中的最佳实践是什么？`,
    agent: `${title}上线后如何监控效果？怎么评估和迭代优化？`,
    algorithm: `如果面试官出了一道${title}的变体题，你的解题思路是什么？`,
    'design-pattern': `在实际项目中，你是怎么识别出需要用${title}的场景的？`,
    architecture: `在系统设计中，${title}的选型依据是什么？不同方案的trade-off是什么？`,
    dotnet: `${title}在.NET Core和.NET Framework中的实现有什么区别？`,
  };

  return domainQ[domain] || `能举一个${title}在实际项目中的应用案例吗？`;
}

function generateA2(c) {
  const { title, ctContent, clItems, paragraphs, domain } = c;

  // 如果有 compareTable，用对比数据构造答案
  if (ctContent) {
    const rows = ctContent.split('\n').filter(l => l.includes('|') && !l.includes('---') && !l.startsWith('| 对比'));
    if (rows.length >= 2) {
      const insights = rows.slice(0, 3).map(r => {
        const cells = r.split('|').map(s => s.trim()).filter(Boolean);
        return cells;
      }).filter(a => a.length >= 3);

      if (insights.length >= 2) {
        // 用对比表的实际内容构造答案
        const dim = insights[0][0]; // 第一个对比维度
        const parts = insights.slice(0, 3).map(a => {
          const label = (a[0] || '').replace(/方面$/, '');
          return `${label}：${a.length >= 2 ? a[1] : '—'} vs ${a.length >= 3 ? a[2] : '—'}`;
        }).join('；');
        return `选型要看具体场景。以${dim}为例，${parts}。` +
          `关键不是哪个绝对更好，而是根据业务场景的约束条件做出合理选择，并能说清楚trade-off。`;
      }
    }
  }

  // 如果有 checklist，用 checklist 内容构造排查思路
  if (clItems.length >= 3) {
    const steps = clItems.slice(0, 4).map((item, i) => `${i + 1}) ${item}`).join('；');
    return `排查${title}相关问题时，我会按以下步骤：${steps}。` +
      `关键是先定位问题根因，再针对性解决，避免盲目调参。`;
  }

  // 通用场景答案
  return `在实际项目中应用${title}时，需要考虑几个维度：` +
    `1）业务场景的具体需求和约束；2）性能和可扩展性要求；` +
    `3）团队的技术栈和维护成本。选型时没有绝对的最优解，关键是能说清楚选择的理由和权衡。`;
}

// ========== 追问3: 误区/踩坑 ==========

function generateQ3(c) {
  const { title, commonMistakes, clItems } = c;

  // 如果有 commonMistakes，基于具体误区提问
  if (commonMistakes.length >= 1) {
    const mistake = commonMistakes[0];
    if (mistake.length > 5 && mistake.length < 80) {
      return `有人说"${mistake}"，这种说法对吗？为什么？`;
    }
  }

  // 从 checklist 中找容易出错的点
  const trickyItem = clItems.find(i =>
    i.includes('区分') || i.includes('注意') || i.includes('不要') ||
    i.includes('容易') || i.includes('误区')
  );
  if (trickyItem) {
    return `很多人在理解${title}时容易犯什么错误？能举个例子吗？`;
  }

  return `关于${title}，有没有什么面试官可能会追问的刁钻问题？你会怎么回答？`;
}

function generateA3(c) {
  const { title, commonMistakes, paragraphs } = c;

  // 如果有 commonMistakes，直接用
  if (commonMistakes.length >= 2) {
    return `面试官确实喜欢从这个角度追问。常见误区有：${commonMistakes[0]}；${commonMistakes[1]}。` +
      `回答时不要只是说"这是错的"，要解释为什么错、正确的做法是什么，最好能结合具体代码或场景。`;
  }

  if (commonMistakes.length === 1) {
    return `关于${title}，一个常见误区是"${commonMistakes[0]}"。` +
      `面试中遇到这类追问，回答时要说明为什么这是误区、正确的理解是什么，展示出你真正动手踩过坑。`;
  }

  // 从 explain 中找注意事项
  const warningParagraphs = paragraphs.filter(p =>
    p.includes('注意') || p.includes('误区') || p.includes('容易') ||
    p.includes('常见问题') || p.includes('踩坑')
  );

  if (warningParagraphs.length > 0) {
    const content = warningParagraphs[0].replace(/^#+\s+/gm, '').replace(/\*\*/g, '');
    const sentences = content.split(/[。；\n]/).filter(s => s.trim().length > 10).slice(0, 3);
    if (sentences.length >= 2) {
      return `面试中关于${title}的刁钻问题通常围绕细节展开。${sentences[0].trim()}。${sentences[1].trim()}。回答时要展示出对底层原理的理解，而不是背诵概念。`;
    }
  }

  // 通用回退
  return `关于${title}，面试官可能会从以下角度追问：` +
    `1）底层实现原理的细节；2）与其他类似技术的区别和选型；3）实际项目中的踩坑经验。` +
    `建议准备时从这三个维度深入思考，特别是要能结合具体案例来回答。`;
}

// ========== 主流程 ==========

function main() {
  console.log('=== 修复 followUpQuestions 泛化问题 v2 ===\n');
  if (DRY_RUN) console.log('🔍 DRY RUN 模式\n');

  const allFiles = getAllTopicFiles(TOPICS_DIR);
  console.log(`扫描到 ${allFiles.length} 个 topic 文件\n`);

  let totalFixed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const fixedByDomain = {};
  const samples = [];

  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const topic = JSON.parse(raw);
      const domain = topic.domain || 'unknown';

      const iaCard = (topic.learningCards || []).find(c => c.type === 'interviewAnswer');
      if (!iaCard) { totalSkipped++; continue; }

      if (!isGenericFollowUp(iaCard.followUpQuestions)) {
        totalSkipped++;
        continue;
      }

      const newFollowUps = generateFollowUps(topic);
      iaCard.followUpQuestions = newFollowUps;

      if (!DRY_RUN) {
        fs.writeFileSync(filePath, JSON.stringify(topic, null, 2) + '\n');
      }

      totalFixed++;
      fixedByDomain[domain] = (fixedByDomain[domain] || 0) + 1;

      // 收集样本（每个领域各一个）
      if (!fixedByDomain[domain + '_sampled']) {
        fixedByDomain[domain + '_sampled'] = true;
        samples.push({ id: topic.id, title: topic.title, followUps: newFollowUps });
      }
    } catch (err) {
      totalErrors++;
      console.error(`❌ ${filePath}: ${err.message}`);
    }
  }

  // 输出样本
  console.log('=== 样本预览 ===\n');
  for (const s of samples) {
    console.log(`📌 ${s.id} (${s.title})`);
    s.followUps.forEach((fu, i) => {
      console.log(`   Q${i + 1}: ${fu.question}`);
      console.log(`   A${i + 1}: ${fu.answer.substring(0, 120)}...`);
    });
    console.log();
  }

  console.log('\n=== 修复统计 ===');
  console.log(`总计: ${allFiles.length} 个 topic`);
  console.log(`已修复: ${totalFixed} 个`);
  console.log(`跳过(已有高质量): ${totalSkipped} 个`);
  console.log(`错误: ${totalErrors} 个`);
  console.log('\n按领域分布:');
  for (const [domain, count] of Object.entries(fixedByDomain)
    .filter(([k]) => !k.endsWith('_sampled'))
    .sort((a, b) => b[1] - a[1])) {
    console.log(`  ${domain}: ${count} 个`);
  }
}

main();
