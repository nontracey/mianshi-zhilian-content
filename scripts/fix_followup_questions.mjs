#!/usr/bin/env node
/**
 * 修复 followUpQuestions 泛化问题
 * 为每个 topic 基于其实际内容生成针对性的追问链
 *
 * 用法: node scripts/fix_followup_questions.mjs [--dry-run]
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
    if (entry.isDirectory()) {
      files.push(...getAllTopicFiles(full));
    } else if (entry.name.endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

function extractKeyConcepts(topic) {
  const title = topic.title || '';
  const summary = topic.summary || '';
  // 从 explain 卡片中提取关键术语
  const explainCards = (topic.learningCards || []).filter(c => c.type === 'explain');
  const explainText = explainCards.map(c => c.content || '').join('\n');

  // 提取 markdown 标题作为关键概念
  const headings = [];
  const headingRegex = /^#{1,3}\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(explainText)) !== null) {
    headings.push(match[1].replace(/[：:]/g, '').trim());
  }

  // 提取加粗术语
  const boldTerms = [];
  const boldRegex = /\*\*([^*]+)\*\*/g;
  while ((match = boldRegex.exec(explainText)) !== null) {
    const term = match[1].trim();
    if (term.length > 2 && term.length < 30 && !term.includes('：') && !term.includes(':')) {
      boldTerms.push(term);
    }
  }

  return { title, summary, headings: headings.slice(0, 10), boldTerms: [...new Set(boldTerms)].slice(0, 15), explainText };
}

function extractInterviewQuestions(topic) {
  const iaCard = (topic.learningCards || []).find(c => c.type === 'interviewAnswer');
  if (!iaCard) return [];
  const content = iaCard.content || '';
  const questions = [];
  const qRegex = /\*\*高频问题\d+：(.+?)\*\*/g;
  let match;
  while ((match = qRegex.exec(content)) !== null) {
    questions.push(match[1].trim());
  }
  return questions;
}

function extractCompareItems(topic) {
  const ctCard = (topic.learningCards || []).find(c => c.type === 'compareTable');
  if (!ctCard) return [];
  const content = ctCard.content || '';
  // 提取表头
  const firstLine = content.split('\n')[0] || '';
  const cols = firstLine.split('|').map(s => s.trim()).filter(s => s && s !== '---');
  return cols;
}

function extractChecklistItems(topic) {
  const clCard = (topic.learningCards || []).find(c => c.type === 'checklist');
  if (!clCard) return [];
  return (clCard.items || []).slice(0, 5);
}

// ========== 追问生成策略 ==========

/**
 * 基于 topic 内容生成针对性的 followUpQuestions
 * 策略：
 * 1. 追问1：深入原理/底层实现（基于标题和关键概念）
 * 2. 追问2：实际场景/踩坑经验（基于 checklist 和 compareTable）
 * 3. 追问3（可选）：面试官可能的刁钻追问（基于 commonMistakes）
 */
function generateFollowUps(topic) {
  const { title, summary, headings, boldTerms, explainText } = extractKeyConcepts(topic);
  const interviewQs = extractInterviewQuestions(topic);
  const compareItems = extractCompareItems(topic);
  const checklistItems = extractChecklistItems(topic);
  const domain = topic.domain || '';
  const category = topic.category || '';
  const difficulty = topic.difficulty || 2;

  const followUps = [];

  // === 追问1：深入原理 ===
  // 基于 topic 的关键概念，生成一个追问底层原理的问题
  const mainConcept = title;
  const keyTerm = boldTerms[0] || headings[0] || title;

  // 根据领域和内容生成不同的追问
  const deepQ = generateDeepQuestion(domain, category, title, keyTerm, headings, boldTerms, difficulty);
  const deepA = generateDeepAnswer(domain, category, title, keyTerm, headings, explainText, difficulty);
  followUps.push({ question: deepQ, answer: deepA });

  // === 追问2：实际场景/对比 ===
  const scenarioQ = generateScenarioQuestion(domain, category, title, keyTerm, compareItems, checklistItems, boldTerms);
  const scenarioA = generateScenarioAnswer(domain, category, title, keyTerm, compareItems, checklistItems, explainText);
  followUps.push({ question: scenarioQ, answer: scenarioA });

  // === 追问3（高难度 topic 才有）：刁钻追问 ===
  if (difficulty >= 3 || boldTerms.length >= 5) {
    const trickyQ = generateTrickyQuestion(domain, category, title, keyTerm, boldTerms, headings);
    const trickyA = generateTrickyAnswer(domain, category, title, keyTerm, boldTerms, explainText);
    followUps.push({ question: trickyQ, answer: trickyA });
  }

  return followUps;
}

// ========== 深入原理追问生成 ==========

function generateDeepQuestion(domain, category, title, keyTerm, headings, boldTerms, difficulty) {
  // 基于标题和关键概念生成深入原理问题
  const concepts = boldTerms.filter(t => t !== title).slice(0, 3);
  const subConcept = concepts[0] || headings.find(h => h !== title && !h.startsWith('一') && !h.startsWith('二')) || '';

  // 不同领域的追问模式
  const patterns = {
    java: {
      jvm: [
        `${title}的底层数据结构是什么？内存布局是怎样的？`,
        `能画出${title}的内部结构图吗？关键字段有哪些？`,
        `${subConcept ? subConcept + '的' : ''}底层实现原理是什么？`,
      ],
      concurrent: [
        `${title}的底层是如何保证线程安全的？`,
        `${keyTerm}使用了什么锁机制？CAS还是synchronized？`,
        `${title}在高并发场景下可能出现什么问题？`,
      ],
      collection: [
        `${title}的底层数据结构是什么？扩容机制是怎样的？`,
        `${keyTerm}的put/get操作的时间复杂度是多少？最坏情况呢？`,
        `${title}在多线程环境下安全吗？为什么？`,
      ],
      spring: [
        `${title}的源码实现中，核心流程是怎样的？`,
        `${keyTerm}在Spring容器启动时的初始化顺序是什么？`,
        `${title}如果出问题，排查思路是什么？`,
      ],
      database: [
        `${title}的底层数据结构是什么？（如B+树、哈希表等）`,
        `${keyTerm}在高并发读写场景下如何优化？`,
        `${title}的实现中有哪些关键的算法或数据结构？`,
      ],
      middleware: [
        `${title}的底层架构是怎样的？核心组件有哪些？`,
        `${keyTerm}在高可用场景下如何保证可靠性？`,
        `${title}的消息存储/数据流转机制是什么？`,
      ],
      'new-features': [
        `${title}的底层实现原理是什么？编译器/VM如何处理？`,
        `${keyTerm}相比旧方案，性能提升的关键在哪里？`,
        `${title}在实际项目中的最佳实践是什么？`,
      ],
    },
    os: {
      'process-thread': [
        `${title}在Linux内核中是如何实现的？涉及哪些系统调用？`,
        `${keyTerm}的内核态和用户态表现有什么不同？`,
        `${title}在高并发服务器中如何应用？`,
      ],
      'memory-management': [
        `${title}在操作系统层面的数据结构是什么？`,
        `${keyTerm}的地址转换过程是怎样的？`,
        `${title}对程序性能有什么影响？如何调优？`,
      ],
      'io-model': [
        `${title}的内核实现机制是什么？`,
        `${keyTerm}在高并发场景下的性能瓶颈在哪里？`,
        `${title}和传统IO模型相比，性能差异的根本原因是什么？`,
      ],
      'linux-basics': [
        `${title}背后的系统原理是什么？`,
        `${keyTerm}的常用参数有哪些？各自的作用是什么？`,
        `${title}在生产环境排查问题时怎么用？`,
      ],
    },
    network: {
      'tcp-udp': [
        `${title}在协议层面的报文结构是怎样的？`,
        `${keyTerm}如果出现异常（如丢包、超时），协议栈如何处理？`,
        `${title}在高并发服务器调优中有什么注意事项？`,
      ],
      'http-https': [
        `${title}在协议层面的报文格式是怎样的？`,
        `${keyTerm}的安全机制是如何工作的？`,
        `${title}对Web应用性能有什么影响？如何优化？`,
      ],
      'dns-cdn': [
        `${title}的查询过程涉及哪些服务器？每一步的作用是什么？`,
        `${keyTerm}出现故障时如何排查和降级？`,
        `${title}在大规模系统中如何优化？`,
      ],
      websocket: [
        `${title}的握手过程和报文格式是怎样的？`,
        `${keyTerm}在断线重连场景下如何处理？`,
        `${title}在百万连接场景下的性能优化方案是什么？`,
      ],
    },
    frontend: {
      javascript: [
        `${title}的V8引擎实现原理是什么？`,
        `${keyTerm}在浏览器中的执行机制是怎样的？`,
        `${title}在ES6+中有什么改进？`,
      ],
      react: [
        `${title}在React Fiber架构中是如何工作的？`,
        `${keyTerm}的源码实现中核心流程是什么？`,
        `${title}对渲染性能有什么影响？如何优化？`,
      ],
      vue: [
        `${title}在Vue 3的Composition API中是如何实现的？`,
        `${keyTerm}的响应式原理是什么？`,
        `${title}在Vue 2和Vue 3中的实现有什么区别？`,
      ],
      typescript: [
        `${title}在TypeScript编译器中是如何处理的？`,
        `${keyTerm}的类型推导机制是什么？`,
        `${title}在复杂类型体操中如何应用？`,
      ],
      engineering: [
        `${title}的底层实现原理是什么？`,
        `${keyTerm}在大型项目中的最佳实践是什么？`,
        `${title}如何影响构建产物的大小和性能？`,
      ],
    },
    agent: {
      'llm-basics': [
        `${title}的底层原理是什么？（如Transformer架构等）`,
        `${keyTerm}在大模型推理中的计算过程是怎样的？`,
        `${title}对模型输出质量有什么影响？`,
      ],
      rag: [
        `${title}在RAG Pipeline中的具体实现流程是什么？`,
        `${keyTerm}的质量如何评估和优化？`,
        `${title}在生产环境中的常见问题和解决方案是什么？`,
      ],
      'agent-arch': [
        `${title}的架构设计中核心组件有哪些？`,
        `${keyTerm}的执行流程和状态管理是怎样的？`,
        `${title}在复杂任务场景下如何保证可靠性？`,
      ],
      'ai-engineering': [
        `${title}在生产环境中的实现架构是怎样的？`,
        `${keyTerm}的监控和评估指标有哪些？`,
        `${title}如何处理大规模并发和成本控制？`,
      ],
    },
    algorithm: {
      default: [
        `${title}的时间复杂度和空间复杂度分别是多少？`,
        `${keyTerm}的核心思想是什么？能用一句话概括吗？`,
        `${title}有哪些变体题目？解题思路有什么共性？`,
      ],
    },
    'design-pattern': {
      default: [
        `${title}在JDK/框架源码中有哪些经典应用？`,
        `${keyTerm}的UML类图是怎样的？核心角色有哪些？`,
        `${title}和相似模式的区别是什么？如何选择？`,
      ],
    },
    architecture: {
      default: [
        `${title}在大规模系统中的具体实现方案是什么？`,
        `${keyTerm}的架构演进路径是怎样的？`,
        `${title}在实际项目中踩过什么坑？如何解决的？`,
      ],
    },
    dotnet: {
      default: [
        `${title}在.NET运行时中的实现原理是什么？`,
        `${keyTerm}的CLR处理机制是怎样的？`,
        `${title}和Java中的类似实现有什么区别？`,
      ],
    },
  };

  // 获取领域特定的追问模式
  const domainPatterns = patterns[domain] || {};
  const categoryPatterns = domainPatterns[category] || domainPatterns['default'] || [
    `${title}的底层实现原理是什么？`,
    `${keyTerm}的核心机制是怎样的？`,
    `能深入解释一下${title}中最关键的技术点吗？`,
  ];

  // 选择一个追问（基于标题哈希确保确定性）
  const hash = simpleHash(title);
  return categoryPatterns[hash % categoryPatterns.length];
}

function generateDeepAnswer(domain, category, title, keyTerm, headings, explainText, difficulty) {
  // 从 explain 内容中提取与 keyTerm 相关的段落作为答案基础
  const paragraphs = explainText.split('\n\n').filter(p => p.trim().length > 20);

  // 找到包含关键术语的段落
  const relevantParagraphs = paragraphs.filter(p =>
    p.includes(keyTerm) || p.includes(title) ||
    (headings.some(h => p.includes(h)))
  ).slice(0, 3);

  if (relevantParagraphs.length > 0) {
    // 基于实际内容生成答案
    const coreContent = relevantParagraphs.map(p => {
      // 清理 markdown 标记，提取核心信息
      return p.replace(/^#+\s+/gm, '').replace(/\*\*/g, '').trim();
    }).join(' ');

    // 截取关键信息生成答案
    const sentences = coreContent.split(/[。！？\n]/).filter(s => s.trim().length > 10).slice(0, 4);
    if (sentences.length >= 2) {
      return `关于${keyTerm}，需要从几个层面来理解：${sentences[0].trim()}。` +
        (sentences[1] ? `具体来说，${sentences[1].trim()}。` : '') +
        (sentences[2] ? `此外，${sentences[2].trim()}。` : '') +
        `建议结合源码或实验来加深理解。`;
    }
  }

  // 回退：生成通用但有意义的答案
  return `关于${keyTerm}，核心要理解其内部机制和设计思想。` +
    `从实现角度看，它涉及到数据结构的选择、算法的优化以及并发控制等方面。` +
    `建议从源码层面分析其核心流程，特别关注关键方法的实现细节和性能优化点。` +
    `面试中可以从"是什么→为什么→怎么做→有什么坑"的结构来组织回答。`;
}

// ========== 场景追问生成 ==========

function generateScenarioQuestion(domain, category, title, keyTerm, compareItems, checklistItems, boldTerms) {
  // 基于对比表和 checklist 生成场景问题
  if (compareItems.length >= 3) {
    const item1 = compareItems[0];
    const item2 = compareItems[1] || compareItems[0];
    return `实际项目中，什么时候选择${item1}，什么时候选择${item2}？能举个具体例子吗？`;
  }

  if (checklistItems.length >= 2) {
    const item = checklistItems.find(i => i.includes('排查') || i.includes('优化') || i.includes('解决')) || checklistItems[0];
    return `如果在生产环境遇到${keyTerm}相关的问题，你的排查和解决思路是什么？`;
  }

  // 基于领域生成场景问题
  const scenarioPatterns = {
    java: `${keyTerm}在你们项目中是怎么用的？遇到过什么问题吗？`,
    os: `在Linux服务器上调优${keyTerm}相关的参数，你会怎么做？`,
    network: `线上出现${keyTerm}相关的问题（如连接超时、丢包），你怎么排查？`,
    frontend: `${keyTerm}在移动端和PC端的表现有什么差异？如何做兼容？`,
    agent: `${keyTerm}在生产环境中上线后，如何监控和评估效果？`,
    algorithm: `如果面试中遇到${title}的变体题，你会怎么分析和拆解？`,
    'design-pattern': `在重构项目时，你是如何识别出需要使用${keyTerm}的场景的？`,
    architecture: `在系统设计中，${keyTerm}的选型依据是什么？`,
    dotnet: `${keyTerm}在.NET Core和.NET Framework中的行为有什么不同？`,
  };

  return scenarioPatterns[domain] || `能举一个${title}在实际项目中的应用案例吗？`;
}

function generateScenarioAnswer(domain, category, title, keyTerm, compareItems, checklistItems, explainText) {
  // 从 compareTable 提取对比信息
  if (compareItems.length >= 3) {
    const rows = explainText.split('\n').filter(l => l.includes('|') && !l.includes('---'));
    const dataRows = rows.slice(1, 4); // 取前3行数据
    if (dataRows.length >= 2) {
      const insights = dataRows.map(r => {
        const cells = r.split('|').map(s => s.trim()).filter(Boolean);
        return cells.slice(0, 3).join('的特性是');
      }).join('；');
      return `选择时主要看场景需求。${insights}。在实际项目中，我通常会先评估性能需求、团队技术栈和维护成本，然后做出选择。关键是能说清楚选择的理由和权衡。`;
    }
  }

  // 通用场景答案
  return `在实际项目中应用${keyTerm}时，我通常会考虑以下几点：` +
    `1）业务场景的具体需求和约束条件；` +
    `2）团队的技术栈和熟悉程度；` +
    `3）性能要求和可扩展性需求；` +
    `4）运维复杂度和故障恢复能力。` +
    `选型时没有绝对的最优解，关键是能说清楚为什么选了当前方案，以及它的局限性和未来可能的演进方向。`;
}

// ========== 刁钻追问生成 ==========

function generateTrickyQuestion(domain, category, title, keyTerm, boldTerms, headings) {
  const mistakes = boldTerms.filter(t =>
    t.includes('注意') || t.includes('避免') || t.includes('误区') ||
    t.includes('不要') || t.includes('容易') || t.includes('常见')
  );

  if (mistakes.length > 0) {
    return `很多人在理解${keyTerm}时容易犯${mistakes[0]}的错误，你能说说为什么这是错的吗？`;
  }

  // 基于领域生成刁钻问题
  const trickyPatterns = {
    java: `如果面试官说"${keyTerm}的性能不行"，你怎么反驳？`,
    os: `${keyTerm}在容器化环境（Docker/K8s）中有什么需要注意的？`,
    network: `HTTP/3已经用QUIC替代了TCP，那${keyTerm}的知识还有用吗？`,
    frontend: `如果让你从零实现一个简化版的${keyTerm}，你会怎么做？`,
    agent: `${keyTerm}在多轮对话场景下会出现什么问题？如何解决？`,
    algorithm: `如果把${title}的数据规模扩大到10亿级别，方案需要怎么调整？`,
    'design-pattern': `${keyTerm}过度使用会导致什么问题？什么情况下应该避免使用？`,
    architecture: `如果系统流量增长10倍，${keyTerm}的方案需要怎么演进？`,
    dotnet: `${keyTerm}在高并发.NET Core应用中的性能瓶颈在哪里？`,
  };

  return trickyPatterns[domain] || `关于${keyTerm}，有没有什么面试官可能会追问的刁钻问题？怎么回答？`;
}

function generateTrickyAnswer(domain, category, title, keyTerm, boldTerms, explainText) {
  // 从 explain 中找常见误区相关内容
  const mistakeParagraphs = explainText.split('\n\n').filter(p =>
    p.includes('误区') || p.includes('注意') || p.includes('容易') ||
    p.includes('常见问题') || p.includes('踩坑') || p.includes('坑')
  );

  if (mistakeParagraphs.length > 0) {
    const content = mistakeParagraphs[0].replace(/^#+\s+/gm, '').replace(/\*\*/g, '').trim();
    const sentences = content.split(/[。！？\n]/).filter(s => s.trim().length > 10).slice(0, 3);
    if (sentences.length >= 2) {
      return `这是一个好问题。${sentences[0].trim()}。${sentences[1].trim()}。` +
        `面试中遇到这类追问时，关键是展示出你对技术细节的深入理解，而不是泛泛而谈。`;
    }
  }

  // 通用刁钻答案
  return `这类追问考察的是对${keyTerm}的深度理解。回答时可以：` +
    `1）先承认这个观点有一定道理，但要补充具体场景；` +
    `2）从原理层面解释为什么在某些场景下确实有局限性；` +
    `3）给出具体的优化方案或替代方案；` +
    `4）结合自己的项目经验说明如何解决的。` +
    `关键是展示出辩证思考能力，而不是简单地同意或反驳。`;
}

// ========== 辅助函数 ==========

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function isGenericFollowUp(followUps) {
  if (!followUps || followUps.length === 0) return true;
  // 检查是否包含泛化模板
  const genericPatterns = [
    '在项目中做选择时，我通常会考虑几个维度',
    '关键要理解它的底层机制',
    '关于.*关键要理解它的底层机制',
    '在实际开发中，这直接影响到我们如何选择合适的方案',
    '性能需求、团队熟悉度、维护成本',
    '没有绝对的最优解，关键是能说清楚为什么选了当前方案',
  ];
  return followUps.some(fu => {
    const answer = fu.answer || '';
    return genericPatterns.some(p => new RegExp(p).test(answer));
  });
}

// ========== 主流程 ==========

function main() {
  console.log('=== 修复 followUpQuestions 泛化问题 ===\n');
  if (DRY_RUN) console.log('🔍 DRY RUN 模式\n');

  const allFiles = getAllTopicFiles(TOPICS_DIR);
  console.log(`扫描到 ${allFiles.length} 个 topic 文件\n`);

  let totalFixed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const fixedByDomain = {};

  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const topic = JSON.parse(raw);
      const domain = topic.domain || 'unknown';

      // 找到 interviewAnswer 卡片
      const iaCard = (topic.learningCards || []).find(c => c.type === 'interviewAnswer');
      if (!iaCard) {
        totalSkipped++;
        continue;
      }

      // 检查是否需要修复
      if (!isGenericFollowUp(iaCard.followUpQuestions)) {
        totalSkipped++;
        continue;
      }

      // 生成新的 followUpQuestions
      const newFollowUps = generateFollowUps(topic);
      iaCard.followUpQuestions = newFollowUps;

      if (!DRY_RUN) {
        fs.writeFileSync(filePath, JSON.stringify(topic, null, 2) + '\n');
      }

      totalFixed++;
      fixedByDomain[domain] = (fixedByDomain[domain] || 0) + 1;

      if (totalFixed <= 3) {
        console.log(`✅ ${topic.id}`);
        newFollowUps.forEach((fu, i) => {
          console.log(`   追问${i + 1}: ${fu.question}`);
          console.log(`   回答: ${fu.answer.substring(0, 80)}...`);
        });
        console.log();
      }
    } catch (err) {
      totalErrors++;
      console.error(`❌ ${filePath}: ${err.message}`);
    }
  }

  console.log('\n=== 修复统计 ===');
  console.log(`总计: ${allFiles.length} 个 topic`);
  console.log(`已修复: ${totalFixed} 个`);
  console.log(`跳过(已有高质量): ${totalSkipped} 个`);
  console.log(`错误: ${totalErrors} 个`);
  console.log('\n按领域分布:');
  for (const [domain, count] of Object.entries(fixedByDomain).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${domain}: ${count} 个`);
  }
}

main();
