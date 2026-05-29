#!/usr/bin/env python3
"""Enhance topics with prerequisites, interviewFrequency, fixed recallPrompts, language fields, and interviewerFocus."""
import json, glob, re

# ============================================================
# 1. Prerequisites mapping (topic-level)
# ============================================================
PREREQ_MAP = {
    # Java JVM
    '堆内存详解': ['java.jvm.runtime-data-area'],
    '方法区与元空间': ['java.jvm.runtime-data-area'],
    'GC算法': ['java.jvm.heap-memory'],
    'GC Roots与引用类型': ['java.jvm.gc-algorithms'],
    '垃圾收集器': ['java.jvm.gc-algorithms'],
    '类加载机制': ['java.jvm.runtime-data-area'],
    'JVM参数与调优': ['java.jvm.gc-algorithms', 'java.jvm.heap-memory'],
    '线上问题排查': ['java.jvm.jvm-params'],

    # Java Concurrency
    'synchronized原理': ['java.concurrency.concurrency-basics'],
    'volatile原理': ['java.concurrency.concurrency-basics'],
    'AQS原理': ['java.concurrency.synchronized'],
    'ReentrantLock': ['java.concurrency.aqs'],
    '线程池原理': ['java.concurrency.concurrency-basics'],
    'ConcurrentHashMap': ['java.concurrency.hashmap'],
    'ThreadLocal': ['java.concurrency.concurrency-basics'],
    'CompletableFuture': ['java.concurrency.thread-pool'],

    # Java Spring
    'IoC容器': ['java.concurrency.concurrency-basics'],
    'AOP原理': ['java.spring.ioc'],
    '自动装配原理': ['java.spring.ioc'],
    'Bean生命周期': ['java.spring.ioc'],
    '循环依赖': ['java.spring.bean-lifecycle'],
    'SpringMVC原理': ['java.spring.boot-config'],
    'MyBatis核心原理': ['java.spring.boot-config'],
    'Nacos': ['java.spring.boot-config'],
    'Gateway': ['java.spring.nacos'],
    'Sentinel': ['java.spring.gateway'],

    # Java Database
    '事务机制': ['java.database.index-principle'],
    '锁机制': ['java.database.transaction'],
    'SQL优化': ['java.database.index-principle'],

    # Java Middleware
    '持久化与内存': ['java.middleware.redis-data-structures'],
    '高可用架构': ['java.middleware.redis-persistence'],
    '缓存问题': ['java.middleware.redis-data-structures'],
    '可靠性与实战': ['java.middleware.rabbitmq-principle'],
    'Kafka原理': ['java.middleware.rabbitmq-principle'],

    # Agent
    'RAG进阶': ['agent.rag.rag-basics'],
    '向量数据库深度': ['agent.rag.vector-db-comparison'],
    'MCP协议深度': ['agent.agent-architecture.mcp-basics'],
    '多Agent协作模式': ['agent.agent-architecture.react-plan'],
    'Agent状态管理': ['agent.agent-architecture.multi-agent'],
    '语义缓存与成本优化': ['agent.ai-engineering.ai-engineering-practice'],
    '模型路由与降级方案': ['agent.ai-engineering.ai-engineering-practice'],
    'LLM Fine-tuning 与 LoRA': ['agent.llm.training-flow'],
    'RAG 评估与优化': ['agent.rag.rag-basics'],

    # Algorithm
    '二叉树基础高频题': ['algorithm.tree-graph.binary-tree-basics'],
    'DP进阶': ['algorithm.array-list.dp-basics'],
    '二分查找高频题': ['algorithm.string-search.binary-search'],
    '双指针技巧': ['algorithm.array-list.array-basics'],
    '二叉树进阶': ['algorithm.tree-graph.binary-tree-basics'],
    'DP基础高频题补充': ['algorithm.array-list.dp-basics'],
    '字符串高频题': ['algorithm.array-list.string-techniques'],
    '排序算法高频题': ['algorithm.array-list.sort-algorithms'],
    '回溯高频题补充': ['algorithm.backtracking.backtracking-basics'],
    '栈与队列高频题': ['algorithm.stack-queue.stack-queue-basics'],
    '背包问题': ['algorithm.dynamic-programming.dp-advanced'],

    # Network
    '跨域与 CORS': ['network.http-https.http-evolution'],
    'HTTP 状态码与头部字段': ['network.http-https.http-evolution'],
    'HTTPS 加密原理': ['network.tcp-udp.tcp-handshake'],
    'TCP 流量控制与拥塞控制': ['network.tcp-udp.tcp-reliable'],
    'TCP 粘包与拆包': ['network.tcp-udp.tcp-reliable'],
    'WebSocket 与长轮询对比': ['network.websocket.websocket-principle'],

    # OS
    '死锁的产生与避免': ['os.process-thread.process-vs-thread'],
    '内存泄漏与溢出': ['os.memory-management.virtual-memory'],
    '页面置换算法': ['os.memory-management.paging-segmentation'],
    '内存分页与分段': ['os.memory-management.virtual-memory'],
    'select/poll/epoll': ['os.io-model.io-models'],
    'Reactor 模式': ['os.io-model.select-poll-epoll'],
    '线程同步机制': ['os.process-thread.process-vs-thread'],
    '协程与纤程': ['os.process-thread.process-vs-thread'],

    # Frontend
    '手写Promise': ['frontend.js-fundamentals.closure-scope'],
    '防抖与节流': ['frontend.js-fundamentals.closure-scope'],
    'Event Loop与异步': ['frontend.js-fundamentals.promise-async-await'],
    'React Hooks原理与实战': ['frontend.react.react-core-fiber'],
    'React性能优化': ['frontend.react.react-core-fiber'],
    'React状态管理': ['frontend.react.react-core-fiber'],
    'Vue响应式原理': ['frontend.vue.vue-lifecycle-composition'],
    '前端性能优化全景': ['frontend.engineering.vite-principle'],

    # Design Pattern
    '代理模式': ['design-pattern.structural.adapter-pattern'],
    '单例模式': ['design-pattern.creational.factory-pattern'],
    '观察者模式': ['design-pattern.behavioral.strategy-pattern'],
    '模板方法模式': ['design-pattern.behavioral.strategy-pattern'],
    '责任链模式': ['design-pattern.behavioral.observer-pattern'],
    '状态模式': ['design-pattern.behavioral.strategy-pattern'],
    '设计模式在Spring中的应用': ['design-pattern.principles.solid-principles'],
}

# ============================================================
# 2. Interview frequency mapping
# ============================================================
INTERVIEW_FREQ = {
    'high': [
        # Java - 高频
        '运行时数据区概述', '堆内存详解', 'GC算法', '垃圾收集器',
        'synchronized原理', 'volatile原理', '线程池原理', 'HashMap原理',
        'ConcurrentHashMap', 'ThreadLocal', 'CompletableFuture',
        '自动装配原理', 'Bean生命周期', 'AOP原理', '循环依赖',
        'SpringBoot启动流程', 'SpringBoot配置体系',
        '索引原理', '事务机制', '锁机制', 'SQL优化',
        'Redis数据结构', '缓存问题', '高可用架构', '分布式锁(Redis/Zookeeper)',
        'RabbitMQ原理', 'Kafka原理',
        # Algorithm - 高频
        '数组基础', '链表基础', '二叉树基础', 'DP基础', '二分查找',
        '双指针技巧', '回溯基础', '栈与队列基础', '哈希表专题',
        # Frontend - 高频
        '闭包与作用域', 'Promise与async/await', 'Event Loop与异步',
        '深拷贝与浅拷贝', '防抖与节流', '原型链与继承',
        'React Hooks原理与实战', 'Vue响应式原理', '盒模型与BFC',
        # Network - 高频
        'TCP 三次握手与四次挥手', 'HTTPS 加密原理', 'DNS 解析流程',
        'HTTP 1.0/1.1/2.0/3.0 演进', 'TCP 与 UDP 的区别',
        # OS - 高频
        '进程与线程的区别', '死锁的产生与避免', '阻塞/非阻塞/同步/异步',
        'select/poll/epoll', '虚拟内存原理',
        # Agent - 高频
        'Transformer与注意力机制', 'RAG基础流程', 'Function Calling实战',
        'MCP协议基础', 'Prompt Engineering',
        # Design Pattern - 高频
        '单例模式', '代理模式', '策略模式', '工厂模式', 'SOLID原则',
        # Architecture - 高频
        '分布式锁实现方案', '分布式事务方案选型', '秒杀系统设计',
        '缓存架构设计', 'DDD领域驱动设计',
    ],
    'medium': [
        # Java - 中频
        '方法区与元空间', 'GC Roots与引用类型', '类加载机制', 'JVM参数与调优',
        'AQS原理', 'ReentrantLock', 'ArrayList与LinkedList', '泛型',
        'IoC容器', 'MyBatis核心原理', 'Nacos', 'Gateway', 'Sentinel',
        '持久化与内存', 'RocketMQ与选型',
        'Lambda 表达式与函数式接口', 'Stream API 详解', 'Optional 类使用',
        'Virtual Threads（Java 21+）',
        # Algorithm - 中频
        '二叉树基础高频题', 'DP进阶', '排序算法', '字符串技巧',
        '前缀和与差分', '贪心算法', '堆与优先队列', '栈与队列高频题',
        '图BFS/DFS', '拓扑排序', '背包问题', '并查集', 'Trie 字典树',
        # Frontend - 中频
        '手写Promise', 'JS数据类型与类型判断', 'Flex与Grid布局',
        '前端路由原理', 'React核心概念与Fiber', 'React性能优化',
        'Vue生命周期与组合式API', 'TypeScript基础类型与类型系统',
        'Webpack核心原理', 'Vite原理与对比',
        # Network - 中频
        'TCP 流量控制与拥塞控制', 'TCP 可靠传输机制', '跨域与 CORS',
        'WebSocket协议原理', 'CDN 原理与应用',
        # OS - 中频
        '内存分页与分段', '页面置换算法', '进程间通信方式',
        '线程同步机制', 'Reactor 模式', '协程与纤程',
        # Agent - 中频
        'RAG进阶', '向量数据库深度', 'MCP协议深度',
        'ReAct与Plan-and-Execute', '多Agent协作模式',
        'AI评估与观测', 'AI安全与合规',
        # Design Pattern - 中频
        '观察者模式', '建造者模式', '模板方法模式', '责任链模式',
        '适配器模式', '装饰器模式',
        # Architecture - 中频
        '微服务拆分原则', '限流降级熔断策略', '分布式ID生成方案',
        '消息队列架构设计', '读写分离与数据一致性', '服务治理全景',
    ],
}

def get_frequency(title):
    if title in INTERVIEW_FREQ['high']:
        return 'high'
    elif title in INTERVIEW_FREQ['medium']:
        return 'medium'
    else:
        return 'low'

# ============================================================
# 3. Interviewer focus mapping
# ============================================================
def get_interviewer_focus(data):
    title = data.get('title', '')
    domain = data.get('domain', '')
    category = data.get('category', '')

    if domain == 'java':
        if 'jvm' in category:
            return "考察对JVM内存管理和GC机制的理解深度，能否结合实际项目说明调优经验"
        elif 'concurrency' in category:
            return "考察并发编程能力，是否理解线程安全的本质（原子性/可见性/有序性），能否说出底层实现原理"
        elif 'spring' in category:
            return "考察对Spring框架的设计思想和核心机制的理解，不仅是使用层面，更关注源码层面的实现原理"
        elif 'database' in category:
            return "考察数据库内功，是否理解索引原理、事务机制、锁机制，能否用EXPLAIN分析和优化SQL"
        elif 'middleware' in category:
            return "考察对分布式中间件的理解深度，是否了解核心架构、一致性保证、常见坑和最佳实践"
        elif 'java-fundamentals' in category:
            return "考察Java语言基础功底，是否理解底层实现原理而不仅是API使用"
        elif 'new-features' in category:
            return "考察对Java新特性的了解程度，是否理解其设计动机和实际应用场景"
    elif domain == 'algorithm':
        return "考察算法思维和编码能力，能否分析时间空间复杂度，说出解法的变体和优化方向"
    elif domain == 'frontend':
        return "考察前端基础功底，是否理解浏览器/JS引擎的工作机制，能否手写核心实现"
    elif domain == 'agent':
        return "考察对AI/LLM技术栈的理解深度，是否了解工程化挑战和生产环境的最佳实践"
    elif domain == 'architecture':
        return "考察系统设计能力，能否结合实际项目规模选择合适的架构方案，理解核心权衡（一致性vs可用性）"
    elif domain == 'design-pattern':
        return "考察对设计模式的理解是否停留在类图层面，能否结合Spring等框架说明实际应用"
    elif domain == 'dotnet':
        return "考察.NET技术栈的深度，是否理解运行时机制和框架设计，能否和Java生态做对比"
    elif domain == 'network':
        return "考察对网络协议的理解深度，是否了解协议的设计动机和实际排查方法"
    elif domain == 'os':
        return "考察操作系统基础功底，是否理解进程/线程/内存/IO的核心机制，能否用工具排查问题"
    return "考察对" + title + "的理解深度和实际应用能力"


# ============================================================
# 4. Fix recallPrompts
# ============================================================
def fix_recall_prompts(data):
    """Replace generic recallPrompts with specific ones."""
    title = data.get('title', '')
    domain = data.get('domain', '')
    category = data.get('category', '')

    new_prompts = []
    existing = data.get('recallPrompts', [])

    for rp in existing:
        prompt = rp.get('prompt', '')
        mode = rp.get('mode', 'text')

        # Fix generic prompts
        if '请介绍一下' in prompt and prompt.count('请介绍一下') > 0:
            # Replace with specific prompt
            if domain == 'java':
                if 'jvm' in category:
                    new_prompt = f"请用自己的话解释{title}的核心机制，包括关键的数据结构和生命周期"
                elif 'concurrency' in category:
                    new_prompt = f"如果面试官问你{title}的底层实现原理，你会怎么回答？请画出关键的结构图"
                elif 'spring' in category:
                    new_prompt = f"请描述{title}在Spring源码中的实现流程，关键的类和方法是什么"
                elif 'database' in category:
                    new_prompt = f"请解释{title}的工作原理，并说明如何用EXPLAIN或其他工具验证"
                elif 'middleware' in category:
                    new_prompt = f"请描述{title}的核心架构和工作流程，以及生产环境中的最佳实践"
                else:
                    new_prompt = f"请用自己的话解释{title}的核心概念和底层实现原理"
            elif domain == 'algorithm':
                new_prompt = f"请手写{title}的核心算法实现，并分析时间复杂度和空间复杂度"
            elif domain == 'frontend':
                new_prompt = f"请解释{title}的工作原理，并手写一个简化版的实现"
            elif domain == 'agent':
                new_prompt = f"请描述{title}的核心流程和架构，以及在生产环境中的工程化挑战"
            elif domain == 'architecture':
                new_prompt = f"请描述{title}的核心设计方案和权衡取舍，结合实际项目说明"
            elif domain == 'design-pattern':
                new_prompt = f"请解释{title}的设计动机和适用场景，并举出Spring中的实际应用"
            elif domain == 'dotnet':
                new_prompt = f"请解释{title}在.NET Core中的实现原理，并和Java做对比"
            elif domain == 'network':
                new_prompt = f"请描述{title}的工作流程，并说明如何用工具排查相关问题"
            elif domain == 'os':
                new_prompt = f"请解释{title}的核心机制，并说明如何用Linux工具观察和排查"
            else:
                new_prompt = f"请用自己的话解释{title}的核心概念"

            new_prompts.append({
                **rp,
                'prompt': new_prompt
            })
        else:
            new_prompts.append(rp)

    return new_prompts


# ============================================================
# 5. Fix code card language
# ============================================================
def detect_language(code_content):
    """Detect programming language from code content."""
    content = code_content.strip()

    # Java indicators
    if any(x in content for x in ['public class', 'public static void', 'new Thread', 'import java.',
                                   'System.out.println', 'private static final', '@Override',
                                   'ThreadPoolExecutor', 'synchronized', 'volatile']):
        return 'java'

    # Python indicators
    if any(x in content for x in ['def ', 'import ', 'from ', 'print(', 'self.', '__init__',
                                   'async def', 'await ', 'class ', 'lambda ']):
        return 'python'

    # JavaScript/TypeScript indicators
    if any(x in content for x in ['const ', 'let ', 'var ', 'function(', '=> {', 'console.log',
                                   'async ', 'await ', 'export ', 'import {', 'require(',
                                   'Promise.', 'new Promise']):
        return 'javascript'

    # CSS indicators
    if any(x in content for x in ['box-sizing:', 'display:', 'margin:', 'padding:', 'border:',
                                   'overflow:', 'position:', 'z-index:', 'flex-', 'grid-']):
        return 'css'

    # SQL indicators
    if any(x in content for x in ['SELECT ', 'INSERT ', 'UPDATE ', 'DELETE ', 'CREATE TABLE',
                                   'ALTER TABLE', 'EXPLAIN ', 'SHOW ']):
        return 'sql'

    # Shell/Bash indicators
    if any(x in content for x in ['#!/bin/bash', 'echo ', 'grep ', 'awk ', 'sed ', 'curl ',
                                   'java -', 'npm ', 'docker ', 'kubectl ']):
        return 'bash'

    # JSON indicators
    if content.startswith('{') and '"type"' in content:
        return 'json'

    # Go indicators
    if any(x in content for x in ['func ', 'package ', 'import (', 'fmt.', 'go func', 'chan ']):
        return 'go'

    # C/C++ indicators
    if any(x in content for x in ['#include', 'printf(', 'malloc(', 'void *', 'int main']):
        return 'c'

    # YAML indicators
    if any(x in content for x in ['apiVersion:', 'kind:', 'metadata:', 'spec:']):
        return 'yaml'

    # Dockerfile
    if any(x in content for x in ['FROM ', 'RUN ', 'COPY ', 'EXPOSE ', 'CMD ']):
        return 'dockerfile'

    # Mermaid
    if any(x in content for x in ['flowchart', 'graph TD', 'graph LR', 'sequenceDiagram']):
        return 'mermaid'

    return None


# ============================================================
# Main processing
# ============================================================

print("Enhancing all topics...")

stats = {
    'prerequisites_added': 0,
    'frequency_added': 0,
    'recall_fixed': 0,
    'language_fixed': 0,
    'focus_added': 0,
}

for f in sorted(glob.glob('topics/*/*.json')):
    try:
        with open(f) as fh:
            data = json.load(fh)
    except:
        continue

    title = data.get('title', '')
    changed = False

    # 1. Add prerequisites
    if title in PREREQ_MAP:
        data['prerequisites'] = PREREQ_MAP[title]
        stats['prerequisites_added'] += 1
        changed = True

    # 2. Add interviewFrequency
    freq = get_frequency(title)
    data['interviewFrequency'] = freq
    stats['frequency_added'] += 1
    changed = True

    # 3. Fix recallPrompts
    new_prompts = fix_recall_prompts(data)
    if new_prompts != data.get('recallPrompts', []):
        data['recallPrompts'] = new_prompts
        stats['recall_fixed'] += 1
        changed = True

    # 4. Fix code card language
    for lc in data.get('learningCards', []):
        if lc.get('type') == 'code' and not lc.get('language'):
            content = lc.get('content', '')
            lang = detect_language(content)
            if lang:
                lc['language'] = lang
                stats['language_fixed'] += 1
                changed = True

    # 5. Add interviewerFocus
    focus = get_interviewer_focus(data)
    data['interviewerFocus'] = focus
    stats['focus_added'] += 1
    changed = True

    if changed:
        with open(f, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)

print("Done! Stats:")
for k, v in stats.items():
    print(f"  {k}: {v}")
