#!/usr/bin/env python3
"""Calibrate difficulty ratings for all topics."""
import json, glob

# Difficulty calibration based on topic title and content analysis
# D1 (入门): 单一概念，无前置知识要求
# D2 (基础): 需要理解 1-2 个关联概念
# D3 (进阶): 需要综合多个知识点
# D4 (高级): 需要项目经验或深入源码
# D5 (专家): 需要系统设计能力

DIFFICULTY_MAP = {
    # === Java ===
    # JVM
    '运行时数据区概述': 2, '堆内存详解': 3, '方法区与元空间': 3,
    'GC算法': 3, 'GC Roots与引用类型': 4, '垃圾收集器': 4,
    '类加载机制': 3, 'JVM参数与调优': 4, '线上问题排查': 5,
    # 并发
    '并发理论基础': 3, 'synchronized原理': 4, 'volatile原理': 4,
    'AQS原理': 5, 'ReentrantLock': 4, '其他锁与并发工具': 4,
    '线程池原理': 4, 'ConcurrentHashMap': 4, 'ThreadLocal': 3,
    'CompletableFuture': 3, 'HashMap原理': 3, 'ArrayList与LinkedList': 2,
    '其他集合': 2,
    # 基础
    '泛型': 3, '反射与注解': 3, 'Java新特性': 3,
    # Spring
    '自动装配原理': 4, 'IoC容器': 3, 'AOP原理': 4,
    'Bean生命周期': 4, '循环依赖': 4, 'SpringMVC原理': 4,
    'SpringBoot配置体系': 3, 'MyBatis核心原理': 3, 'MyBatis-Plus': 2,
    'Nacos': 3, 'OpenFeign': 3, 'Gateway': 3,
    'Sentinel': 4, 'Seata分布式事务': 4, '分布式事务补充方案': 4,
    'SpringBoot启动流程': 4, 'Spring AOP 深入': 4,
    # 数据库
    '索引原理': 3, '事务机制': 4, '锁机制': 4, 'SQL优化': 3,
    'MySQL索引原理': 3, 'MySQL事务与MVCC': 4, 'MySQL锁机制': 4,
    'MySQL慢SQL优化与分库分表': 4,
    # 中间件
    'Redis数据结构': 3, '持久化与内存': 3, '高可用架构': 4,
    '缓存问题': 3, 'RabbitMQ原理': 3, '可靠性与实战': 3,
    'Kafka原理': 4, 'RocketMQ与选型': 3,
    'Redis集群与高可用': 4, '分布式锁(Redis/Zookeeper)': 4,
    '设计模式在并发中的应用': 4,
    # 新特性
    'Lambda 表达式与函数式接口': 2, 'Stream API 详解': 3,
    'Optional 类使用': 2, 'Record 类（Java 14+）': 2,
    'Sealed Classes（Java 17+）': 2, 'Pattern Matching（Java 17+）': 3,
    'Virtual Threads（Java 21+）': 4, '新日期时间 API': 2,

    # === Agent ===
    'Function Calling实战': 3, '向量数据库深度': 3, 'RAG进阶': 4,
    'Prompt Engineering': 2, 'AI评估与观测': 3, 'AI工程化实践': 3,
    'MCP协议深度': 4, 'AI安全与合规': 3, 'AI面试场景题': 3,
    'AI综合复习': 3, '简历AI部分优化': 2, '大模型训练与推理': 4,
    'RAG原理与实战': 3, 'Agent架构与MCP': 4, 'AI综合复习与面试冲刺': 3,
    'MCP协议基础': 3, 'Transformer与注意力机制': 4, '大模型训练流程': 4,
    'DeepSeek与开源模型': 3, 'RAG基础流程': 2, '向量数据库对比与选型': 3,
    '文档分块策略': 3, 'ReAct与Plan-and-Execute': 4, '多Agent协作模式': 5,
    'Agent状态管理': 4, '语义缓存与成本优化': 4, '模型路由与降级方案': 4,
    'LLM Fine-tuning 与 LoRA': 4, 'RAG 评估与优化': 3,

    # === Algorithm ===
    '数组基础': 2, '链表基础': 2, '二叉树基础': 2,
    '二叉树基础高频题': 3, 'DP基础': 3, 'DP进阶': 4,
    '字符串技巧': 3, '排序算法': 3, '二分查找': 2,
    '二分查找高频题': 3, '回溯基础': 3, '设计题': 4,
    '双指针技巧': 3, '前缀和与差分': 3, '二叉树进阶': 3,
    '图BFS/DFS': 3, 'DP基础高频题补充': 3, '字符串高频题': 3,
    '排序算法高频题': 3, '栈与队列基础': 2, '堆与优先队列': 3,
    '哈希表专题': 3, '贪心算法': 3, '回溯高频题补充': 3,
    '栈与队列高频题': 3, '拓扑排序': 3, '图的 BFS 与 DFS': 3,
    'Trie 字典树': 3, '并查集': 3, '背包问题': 4,

    # === Architecture ===
    'CQRS架构': 4, 'DDD领域驱动设计': 4, '事件驱动架构': 3,
    '六边形架构': 3, '分布式ID生成方案': 3, '分布式锁实现方案': 4,
    '分布式事务方案选型': 4, '限流降级熔断策略': 4, '服务治理全景': 4,
    '微服务拆分原则': 3, 'API网关设计': 3, '低代码平台架构设计': 3,
    '多租户SaaS架构设计': 4, '缓存架构设计': 4, '消息队列架构设计': 4,
    '读写分离与数据一致性': 4, '秒杀系统设计': 5, '大数据量分库分表方案': 4,
    '幂等性设计': 3, '服务网格与 Service Mesh': 4,

    # === Design Pattern ===
    '策略模式': 2, '代理模式': 3, '单例模式': 3,
    '工厂模式': 2, '观察者模式': 2, '建造者模式': 2,
    '门面模式': 2, '模板方法模式': 3, '适配器模式': 2,
    'SOLID原则': 2, '设计模式在Spring中的应用': 3, '责任链模式': 3,
    '装饰器模式': 2, '状态模式': 3,

    # === Frontend ===
    '深拷贝与浅拷贝': 2, '手写Promise': 4, '防抖与节流': 2,
    'BFF与全栈架构': 3, '盒模型与BFC': 2, '前端CI/CD与发布': 3,
    '闭包与作用域': 3, '跨域与请求方案': 3, '跨平台方案对比': 3,
    'JS数据类型与类型判断': 2, 'Electron开发': 4, 'Event Loop与异步': 3,
    'Flex与Grid布局': 2, '前端监控与错误追踪': 3, '前端路由原理': 3,
    'HTTP/HTTPS/TCP协议': 3, 'Koa/Express框架原理': 3, '微前端架构': 4,
    '移动端适配与性能': 3, 'Node.js核心概念': 3, 'Node.js工程实践': 3,
    'Node.js模块系统与包管理': 2, '前端性能优化全景': 4, 'Promise与async/await': 3,
    '原型链与继承': 2, 'React核心概念与Fiber': 4, 'React Hooks原理与实战': 4,
    'React Native核心原理': 4, 'React性能优化': 3, 'React路由与数据加载': 3,
    'React状态管理': 4, 'React 18+新特性': 3, '响应式设计与CSS工程化': 3,
    '前端安全防护': 3, '前端状态管理架构': 4, 'TS基础类型与类型系统': 2,
    'TS与JS互操作与工程配置': 2, '泛型与工具类型': 4, '类型体操实战': 4,
    'Vite原理与对比': 4, 'Vue编译与虚拟DOM': 3, 'Vue生态（Pinia/Vue Router）': 3,
    'Vue生命周期与组合式API': 3, 'Vue响应式原理': 4, 'Webpack核心原理': 4,

    # === .NET ===
    '设计模式在 .NET 中的应用': 3, '.NET 与 Java 对比': 3,
    '性能调优与诊断': 4, '认证与授权': 3, '过滤器管道': 3,
    'ASP.NET 性能优化': 4, 'SignalR 实时通信': 3, 'Web API 设计': 3,
    '客户端架构模式': 3, 'Avalonia UI': 3, 'MAUI 跨平台': 3,
    'WPF 核心原理': 3, 'XAML 数据绑定': 3, 'async/await 异步编程': 3,
    '泛型与协变逆变': 3, 'LINQ': 3, '反射与特性': 3,
    'C# 类型系统': 2, '配置与选项模式': 2, '依赖注入': 3,
    '日志与监控': 3, '中间件管道': 3, '.NET 运行时与 GC': 4,
    'EF Core 基础': 3, '数据库兼容与多租户': 4, 'EF Core 性能优化': 4,
    '仓储模式与工作单元': 3, '微服务通信': 3, '容器化与部署': 3,
    'gRPC 与 Protobuf': 3, '消息队列集成': 3,

    # === Network ===
    'CDN 原理与应用': 3, '跨域与 CORS': 3, 'DNS 解析流程': 2,
    'HTTP 1.0/1.1/2.0/3.0 演进': 3, 'HTTP 状态码与头部字段': 2,
    'HTTPS 加密原理': 3, 'TCP 流量控制与拥塞控制': 4, 'TCP 三次握手与四次挥手': 3,
    'TCP 可靠传输机制': 3, 'TCP 粘包与拆包': 3, 'TCP 与 UDP 的区别': 2,
    'WebSocket 与长轮询对比': 3, 'WebSocket 协议原理': 3,

    # === OS ===
    '协程与纤程': 4, '死锁的产生与避免': 3, '文件权限与用户管理': 2,
    '阻塞/非阻塞/同步/异步': 3, '进程间通信方式': 3, '常用命令': 2,
    '内存泄漏与溢出': 3, '页面置换算法': 3, '内存分页与分段': 3,
    '进程管理与监控': 2, '进程与线程的区别': 2, 'Reactor 模式': 4,
    'select/poll/epoll': 4, '线程同步机制': 3, '虚拟内存原理': 3,
}

print("Calibrating difficulty for all topics...")
count = 0
for f in sorted(glob.glob('topics/*/*.json')):
    try:
        with open(f) as fh:
            data = json.load(fh)
    except:
        continue

    title = data.get('title', '')
    old_diff = data.get('difficulty', 0)
    new_diff = DIFFICULTY_MAP.get(title, old_diff)

    if new_diff != old_diff:
        data['difficulty'] = new_diff
        with open(f, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        count += 1

print(f"Done! Updated {count} topics' difficulty")

# Print distribution
from collections import Counter
dist = Counter()
for f in glob.glob('topics/*/*.json'):
    with open(f) as fh:
        try:
            data = json.load(fh)
            dist[data.get('difficulty', 0)] += 1
        except:
            pass

print(f"\nNew difficulty distribution:")
for d in sorted(dist.keys()):
    print(f"  D{d}: {dist[d]} ({dist[d]/sum(dist.values())*100:.1f}%)")
