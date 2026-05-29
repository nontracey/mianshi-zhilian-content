#!/usr/bin/env node
/**
 * scoreWeights 差异化
 * 根据 topic 的难度和类别调整权重分配
 *
 * 原则：
 * - 简单题（difficulty 1-2）：偏重 coverage（覆盖面）和 interviewExpression（表达）
 * - 中等题（difficulty 2-3）：均衡分配
 * - 困难题（difficulty 3-4）：偏重 depth（深度）和 accuracy（准确性）
 * - 算法题：偏重 accuracy
 * - 架构/设计题：偏重 depth
 * - 面试场景题：偏重 interviewExpression
 *
 * 用法: node scripts/fix_score_weights.mjs [--dry-run]
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

// 权重方案（coverage, accuracy, interviewExpression, depth）
const WEIGHT_SCHEMES = {
  // 简单概念题：偏重覆盖面和表达
  easy_concept: { coverage: 45, accuracy: 20, interviewExpression: 25, depth: 10 },
  // 中等技术题：均衡
  medium_tech: { coverage: 35, accuracy: 30, interviewExpression: 20, depth: 15 },
  // 困难深入题：偏重深度和准确性
  hard_deep: { coverage: 25, accuracy: 30, interviewExpression: 20, depth: 25 },
  // 算法题：偏重准确性
  algorithm: { coverage: 25, accuracy: 40, interviewExpression: 15, depth: 20 },
  // 架构设计题：偏重深度
  architecture: { coverage: 25, accuracy: 25, interviewExpression: 20, depth: 30 },
  // 面试场景题：偏重表达
  interview_scene: { coverage: 30, accuracy: 20, interviewExpression: 35, depth: 15 },
  // 源码/原理题：偏重深度和准确性
  source_principle: { coverage: 20, accuracy: 30, interviewExpression: 20, depth: 30 },
};

function selectWeightScheme(topic) {
  const difficulty = topic.difficulty || 2;
  const domain = topic.domain || '';
  const category = topic.category || '';
  const title = topic.title || '';

  // 算法领域
  if (domain === 'algorithm') {
    return difficulty >= 3 ? WEIGHT_SCHEMES.hard_deep : WEIGHT_SCHEMES.algorithm;
  }

  // 架构设计领域
  if (domain === 'architecture') {
    return WEIGHT_SCHEMES.architecture;
  }

  // 面试场景题
  if (title.includes('面试') || category.includes('interview')) {
    return WEIGHT_SCHEMES.interview_scene;
  }

  // JVM/底层原理
  if (category === 'jvm' || category === 'jmm' || title.includes('原理') || title.includes('源码')) {
    return difficulty >= 3 ? WEIGHT_SCHEMES.source_principle : WEIGHT_SCHEMES.hard_deep;
  }

  // 并发编程
  if (category === 'concurrent' || title.includes('并发') || title.includes('锁')) {
    return WEIGHT_SCHEMES.hard_deep;
  }

  // 按难度分
  if (difficulty <= 1) return WEIGHT_SCHEMES.easy_concept;
  if (difficulty === 2) return WEIGHT_SCHEMES.medium_tech;
  if (difficulty >= 3) return WEIGHT_SCHEMES.hard_deep;

  return WEIGHT_SCHEMES.medium_tech;
}

function main() {
  console.log('=== scoreWeights 差异化 ===\n');
  if (DRY_RUN) console.log('🔍 DRY RUN 模式\n');

  const allFiles = getAllTopicFiles(TOPICS_DIR);
  console.log(`扫描到 ${allFiles.length} 个 topic 文件\n`);

  let totalFixed = 0;
  let totalSkipped = 0;
  const schemeCounts = {};

  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const topic = JSON.parse(raw);

      if (!topic.rubric?.scoreWeights) { totalSkipped++; continue; }

      const current = topic.rubric.scoreWeights;
      const scheme = selectWeightScheme(topic);
      const schemeName = Object.entries(WEIGHT_SCHEMES).find(([k, v]) =>
        v.coverage === scheme.coverage && v.accuracy === scheme.accuracy &&
        v.interviewExpression === scheme.interviewExpression && v.depth === scheme.depth
      )?.[0] || 'custom';

      // 检查是否需要修改
      if (current.coverage === scheme.coverage &&
          current.accuracy === scheme.accuracy &&
          current.interviewExpression === scheme.interviewExpression &&
          current.depth === scheme.depth) {
        totalSkipped++;
        continue;
      }

      topic.rubric.scoreWeights = scheme;
      schemeCounts[schemeName] = (schemeCounts[schemeName] || 0) + 1;

      if (!DRY_RUN) {
        fs.writeFileSync(filePath, JSON.stringify(topic, null, 2) + '\n');
      }

      totalFixed++;
      if (totalFixed <= 5) {
        console.log(`✅ ${topic.id} (${topic.title})`);
        console.log(`   ${current.coverage}/${current.accuracy}/${current.interviewExpression}/${current.depth} → ${scheme.coverage}/${scheme.accuracy}/${scheme.interviewExpression}/${scheme.depth} [${schemeName}]`);
      }
    } catch (err) {
      console.error(`❌ ${filePath}: ${err.message}`);
    }
  }

  console.log('\n=== 统计 ===');
  console.log(`总计: ${allFiles.length} 个 topic`);
  console.log(`已调整: ${totalFixed} 个`);
  console.log(`跳过(已是差异化): ${totalSkipped} 个`);
  console.log('\n方案分布:');
  for (const [scheme, count] of Object.entries(schemeCounts).sort((a, b) => b[1] - a[1])) {
    const w = WEIGHT_SCHEMES[scheme];
    console.log(`  ${scheme}: ${count} 个 (${w.coverage}/${w.accuracy}/${w.interviewExpression}/${w.depth})`);
  }
}

main();
