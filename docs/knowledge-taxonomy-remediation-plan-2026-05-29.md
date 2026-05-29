# 知识体系整改执行方案

> 日期：2026-05-29  
> 目标：把内容库调整为“面试准备知识库”，而不是简历辅导、面试策略、项目包装或泛经验文档集合。本文档供后续 AI 或人工编辑直接执行。

## 1. 定位与判定规则

### 1.1 什么可以成为知识点

知识点必须满足以下条件之一：

1. 八股文核心概念：例如 JVM 内存区域、HashMap、TCP 握手、闭包、BFC、AQS。
2. 可独立复述的机制原理：例如 Spring Bean 生命周期、ReAct、RAG 检索链路、epoll、React Fiber。
3. 可比较的技术方案：例如 分布式事务方案、向量索引 HNSW/IVF、HTTP 版本演进。
4. 可考察的算法模式或算法题：算法领域是唯一例外，可以把经典题目作为知识点。
5. 可稳定用于面试考察的工程机制：例如 限流熔断、幂等设计、日志与监控、Prompt 注入防护。

### 1.2 什么不能成为知识点

以下内容不能作为 `topics/*/*.json` 中的独立 topic：

1. 简历优化、项目包装、个人经历组织、面试话术。
2. 综合复习、冲刺计划、知识总览、学习计划。
3. 场景题集合、模拟面试题集合、答题套路集合。
4. 单一厂商/单一模型新闻式内容，例如“DeepSeek 与开源模型”。如果其中有稳定原理，只能拆成“MoE 架构”“推理优化”“开源模型部署约束”等知识点。
5. 过宽泛的实践合集，例如“AI 工程化实践”“Node.js 工程实践”。必须拆成稳定机制，或者改为分类/学习路径描述。
6. 只描述项目、产品、平台或业务案例的内容，例如“个人项目”“低代码项目复盘”。架构领域可以保留典型系统设计题，但必须考察通用架构能力。

### 1.3 题目、分类、排序和权重规则

1. 领域结构固定为：领域 -> 分类 -> 知识点。
2. 分类只按知识体系划分，不按学习阶段、面试轮次、简历模块划分。
3. `difficulty` 表示理解深度：
   - 1：入门，能直接背诵或简单编码。
   - 2：基础，常规校招/初级面试。
   - 3：中频核心，要求能解释机制和适用场景。
   - 4：高阶，要求理解源码、链路、权衡。
   - 5：综合设计或疑难排查。
4. `interviewFrequency` 表示真实面试出现频率，不表示内容重要性：
   - `high`：大部分对应岗位都会问。
   - `medium`：常见追问或特定方向高频。
   - `low`：方向相关、加分项或高级岗位。
5. `recommendWeight` 应与频率和基础性匹配：
   - high：85-100。
   - medium：70-88。
   - low：50-75。
6. 每个 topic 的 `id` 必须满足 `domain.category.slug`，其中 category 必须等于 JSON 内 `category`，并且与 `domains/*.json` 挂载分类一致。
7. 标题避免“实战”“综合复习”“冲刺”“场景题”“优化简历”“选型指南”等任务型表达。可保留“方案选型”，但标题必须指向稳定知识，例如“分布式事务方案选型”。

## 2. 全局整改任务

### 2.1 修正入口统计

修改 `manifest.json`：

1. `agent.topicCount` 从 `29` 改为整改后的实际 topic 数。
2. `algorithm.topicCount` 从 `30` 改为 `58`，除非后续删除算法题。
3. 其余领域 `topicCount` 必须等于对应 `topics/{domain}` 文件数，也等于领域文件中所有分类 `topics` 数量之和。

验收命令：

```bash
node - <<'NODE'
const fs=require('fs');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
for (const d of manifest.domains) {
  const files=fs.readdirSync(`topics/${d.id}`).filter(f=>f.endsWith('.json')).length;
  const domain=JSON.parse(fs.readFileSync(d.entry,'utf8'));
  const listed=domain.categories.reduce((n,c)=>n+(c.topics||[]).length,0);
  console.log(d.id, {manifest:d.topicCount, files, listed});
}
NODE
```

### 2.2 修正 topic id 与分类不一致

必须修正以下 topic 的 `id` 前两段，保证 `id = domain.category.slug`：

| 文件 | 当前问题 | 修改要求 |
| --- | --- | --- |
| `topics/agent/topic-088-d8088d8c.json` | `id` 为 `agent.llm.*`，实际 `category` 为 `rag` | 改为 `agent.rag.topic-088-d8088d8c` |
| `topics/agent/topic-089-42584852.json` | `agent.llm.*` 挂在 `rag` | 改为 `agent.rag.topic-089-42584852` |
| `topics/agent/topic-091-ee657ad3.json` | `agent.llm.*` 挂在 `ai-engineering` | 改为 `agent.ai-engineering.topic-091-ee657ad3` |
| `topics/agent/topic-092-f26667a7.json` | `agent.llm.*` 挂在 `ai-engineering` | 若删除该 topic 则无需修；若保留，改为 `agent.ai-engineering.topic-092-f26667a7` |
| `topics/agent/topic-093-de1a9ab0.json` | `agent.llm.*` 挂在 `agent-architecture` | 改为 `agent.agent-architecture.topic-093-de1a9ab0` |
| `topics/agent/topic-094-e03e7524.json` | `agent.llm.*` 挂在 `ai-engineering` | 改为 `agent.ai-engineering.topic-094-e03e7524` |
| `topics/agent/topic-106-bf5350b9.json` | `agent.llm.*` 挂在 `rag` | 改为 `agent.rag.topic-106-bf5350b9` |
| `topics/agent/topic-115-35c5dcec.json` | `agent.llm.*` 挂在 `agent-architecture` | 改为 `agent.agent-architecture.topic-115-35c5dcec` |
| `topics/java/topic-032-8b727f38.json` | `java.collections.*` 挂在 `java-fundamentals` | 改为 `java.java-fundamentals.topic-032-8b727f38`，除非新增 `collections` 分类 |
| `topics/java/topic-034-f2553b47.json` | 同上 | 改为 `java.java-fundamentals.topic-034-f2553b47`，或删除/拆分 |
| `topics/java/topic-041-d2d1cd02.json` | `java.collections.*` 挂在 `spring` | 改为 `java.spring.topic-041-d2d1cd02` |
| `topics/java/topic-046-75c87cc7.json` | `java.collections.*`，且内容是 Spring Bean 生命周期 | 迁移到 `spring`，改为 `java.spring.topic-046-75c87cc7` |
| `topics/java/topic-047-7bfc4e55.json` | `java.collections.*`，且内容是 Spring 循环依赖 | 迁移到 `spring`，改为 `java.spring.topic-047-7bfc4e55` |
| `topics/java/topic-058-72ff8a49.json` | `java.collections.*` 挂在 `spring` | 改为 `java.spring.topic-058-72ff8a49` |
| `topics/java/topic-061-7a8c02dc.json` | `java.concurrency.*` 挂在 `spring` | 改为 `java.spring.topic-061-7a8c02dc`，或迁移到 middleware 后改为 `java.middleware.*` |
| `topics/java/topic-066-d9e7b897.json` | `java.concurrency.*` 挂在 `database` | 改为 `java.database.topic-066-d9e7b897` |
| `topics/java/topic-068-fd69e227.json` | 同上 | 改为 `java.database.topic-068-fd69e227` |
| `topics/java/topic-069-badbf416.json` | 同上 | 改为 `java.database.topic-069-badbf416` |
| `topics/java/topic-072-980339ce.json` | `java.concurrency.*` 挂在 `middleware` | 改为 `java.middleware.topic-072-980339ce` |

验收脚本：

```bash
node - <<'NODE'
const fs=require('fs');
for (const dir of fs.readdirSync('topics')) {
  for (const f of fs.readdirSync(`topics/${dir}`).filter(x=>x.endsWith('.json'))) {
    const p=`topics/${dir}/${f}`;
    const t=JSON.parse(fs.readFileSync(p,'utf8'));
    const parts=t.id.split('.');
    if (parts[0]!==t.domain || parts[1]!==t.category) {
      console.log('ID_MISMATCH', p, t.id, t.domain, t.category, t.title);
    }
  }
}
NODE
```

### 2.3 替换模板化、空泛和错误内容

全库搜索并重写以下模板化内容：

1. `最常见的坑是理论和实践脱节。建议通过实际项目验证理论。`
2. `理解X的1. ...，掌握其在面试中的高频考点和实际应用场景`
3. `掌握X中...等核心概念，理解其原理和实际应用`
4. 不相关串入内容，例如 `topics/agent/topic-091-ee657ad3.json` 的 summary 出现 `@EnableAutoConfiguration扫描spring.factories`。
5. “今日笔记”“参考资料”如果出现在 `learningCards.content` 中，应删除或改为 `checklist` 卡片；知识正文不放学习日志模板。

执行要求：

1. 每个 topic 的 `summary` 改成 1 句自然中文，说明该知识点的核心机制、面试考察点和边界。
2. 每个 `interviewAnswer` 卡片必须回答该 topic 的真实面试问题，不得使用通用占位答案。
3. `rubric.commonMistakes` 必须是该知识点特有错误，不得出现“理论和实践脱节”这类泛化句。
4. 保留必要英文术语，但中英文之间加空格，例如 `AI 工程化`、`Function Calling`、`Service Mesh`。

## 3. Agent 开发领域整改

Agent 是当前最需要整改的领域。核心问题是把简历、综合复习、面试场景题、厂商模型介绍当成了知识点，导致不能作为从 0 到 1 的 AI 面试知识准备素材。

### 3.1 目标分类

将 `domains/agent.json` 调整为以下分类和顺序：

1. `llm-foundation`：大模型基础。替代当前 `llm`，聚焦 Transformer、Token、训练/推理、Prompt 基础。
2. `embedding-retrieval`：Embedding 与向量检索。聚焦 Embedding、相似度、ANN 索引、向量数据库。
3. `rag`：RAG。聚焦分块、检索、重排、上下文构建、RAG 评估。
4. `tool-agent`：工具调用与 Agent 架构。聚焦 Function Calling、ReAct、Plan-and-Execute、状态管理、多 Agent、MCP。
5. `llmops`：AI 工程化与 LLMOps。聚焦评估、观测、安全、缓存、成本、路由、微调。

如果不希望大量改动分类 ID，也可以保留旧分类 ID，但必须至少完成 3.2 的 topic 删除/迁移。推荐执行完整分类重排，因为当前 `llm` 分类塞入了太多非 LLM 基础内容。

### 3.2 必删、必改、必迁移 topic

| 文件 | 当前标题 | 处理动作 | 处理原因 |
| --- | --- | --- | --- |
| `topics/agent/topic-101-0ae1463e.json` | 简历AI部分优化 | 删除 topic 文件，并从 `domains/agent.json` 移除引用 | 简历优化不是知识点 |
| `topics/agent/topic-100-81a67d07.json` | AI综合复习与面试冲刺 | 删除 topic 文件，并从 `domains/agent.json` 移除引用 | 复习/冲刺是学习路径或文档，不是知识点 |
| `topics/agent/topic-097-3c6947d6.json` | AI面试场景题 | 删除 topic 文件，并从 `domains/agent.json` 移除引用 | 场景题集合不是知识点；可把优质问题拆入对应 topic 的 `recallPrompts` |
| `topics/agent/topic-118-19d74d97.json` | DeepSeek与开源模型 | 删除或重写为 `MoE 架构与推理优化` | 单一模型/厂商介绍不是稳定知识；如保留，必须去掉 DeepSeek 标题和新闻式内容 |
| `topics/agent/topic-092-f26667a7.json` | AI工程化实践 | 删除或重写为 `LLM 应用生产化链路` | 当前标题过宽，且与分类同名；不能作为泛实践合集 |
| `topics/agent/topic-087-81c07ef4.json` | Function Calling实战 | 标题改为 `Function Calling 与工具调用`，迁移到 `tool-agent` | 工具调用属于 Agent 能力，不属于 LLM 基础 |
| `topics/agent/topic-088-d8088d8c.json` | 向量数据库深度 | 标题改为 `向量数据库索引与检索`，迁移到 `embedding-retrieval` | 当前 summary 残缺，内容过偏 Milvus 实操 |
| `topics/agent/topic-121-15a0b1b4.json` | 向量数据库对比与选型 | 合并进 `向量数据库索引与检索`，或改为 `向量数据库核心能力对比` | “选型”可作为一节，避免单独成为产品清单 |
| `topics/agent/topic-091-ee657ad3.json` | AI评估与观测 | 修复 summary 和正文串入 Spring 内容 | 存在明显内容污染 |
| `topics/agent/topic-093-de1a9ab0.json` | MCP协议深度 | 与 `MCP协议基础` 合并或改成进阶 topic | 避免基础/深度重复但边界不清 |
| `topics/agent/topic-115-35c5dcec.json` | MCP协议基础 | 保留，迁移到 `tool-agent` | MCP 是 Agent 工具生态知识 |

### 3.3 Agent 推荐最终 topic 清单

整改后 Agent 领域建议控制在 18-22 个 topic。推荐清单如下：

| 分类 | 顺序 | topic 标题 | 来源/动作 |
| --- | ---: | --- | --- |
| 大模型基础 | 10 | Transformer 与注意力机制 | 保留 `topic-116-13e5ca40` |
| 大模型基础 | 20 | Tokenization 与上下文窗口 | 新增或从训练推理中拆分 |
| 大模型基础 | 30 | 大模型训练流程：预训练、SFT、RLHF、DPO | 从 `topic-104-b4f897e0` 拆分/重写 |
| 大模型基础 | 40 | 推理机制与解码参数 | 从 `topic-104-b4f897e0` 拆分/重写 |
| 大模型基础 | 50 | Prompt Engineering 基础 | 保留并精简 `topic-090-357bf78b` |
| Embedding 与向量检索 | 10 | Embedding 原理与相似度计算 | 从 `topic-106-bf5350b9` 拆分 |
| Embedding 与向量检索 | 20 | ANN 索引：Flat、IVF、HNSW、PQ | 重写 `topic-088-d8088d8c` |
| Embedding 与向量检索 | 30 | 向量数据库核心能力 | 合并 `topic-121-15a0b1b4` |
| RAG | 10 | RAG 基本链路 | 保留并重写 `topic-106-bf5350b9` |
| RAG | 20 | 文档分块策略 | 保留 `topic-122-194b7dfa` |
| RAG | 30 | 检索增强与重排 | 从 `topic-089-42584852` 拆分 |
| RAG | 40 | RAG 评估与优化 | 保留 `topic-a2c7179e` |
| 工具调用与 Agent 架构 | 10 | Function Calling 与工具调用 | 改写 `topic-087-81c07ef4` |
| 工具调用与 Agent 架构 | 20 | ReAct 与 Plan-and-Execute | 保留 `topic-123-b51b29dc` |
| 工具调用与 Agent 架构 | 30 | Agent 状态管理 | 保留 `topic-125-30dc0c91` |
| 工具调用与 Agent 架构 | 40 | 多 Agent 协作模式 | 保留 `topic-124-6e95a1cd` |
| 工具调用与 Agent 架构 | 50 | MCP 协议基础 | 合并/保留 `topic-115-35c5dcec` |
| LLMOps | 10 | LLM 应用评估与观测 | 修复 `topic-091-ee657ad3` |
| LLMOps | 20 | AI 安全与 Prompt 注入防护 | 保留 `topic-094-e03e7524` |
| LLMOps | 30 | 语义缓存与成本优化 | 保留 `topic-127-34123092` |
| LLMOps | 40 | 模型路由与降级 | 保留 `topic-129-1907ae44` |
| LLMOps | 50 | LoRA 与参数高效微调 | 保留 `topic-50e6a78b` |

### 3.4 Agent 权重与难度建议

1. `Transformer 与注意力机制`：difficulty 4，frequency high，weight 90。
2. `Prompt Engineering 基础`：difficulty 2，frequency high，weight 90。
3. `RAG 基本链路`：difficulty 3，frequency high，weight 92。
4. `Embedding 原理与相似度计算`：difficulty 3，frequency high，weight 88。
5. `Function Calling 与工具调用`：difficulty 3，frequency high，weight 90。
6. `ReAct 与 Plan-and-Execute`：difficulty 4，frequency medium，weight 82。
7. `MCP 协议基础`：difficulty 3，frequency medium，weight 78。不要设为 high，除非目标岗位明确是 Agent 平台开发。
8. `多 Agent 协作模式`：difficulty 5，frequency low/medium，weight 70-78。
9. `LoRA 与参数高效微调`：difficulty 4，frequency low/medium，weight 70-78。

## 4. Java 领域整改

### 4.1 分类调整

当前 Java 的主要问题不是“非知识点”，而是分类错位、重复和顺序混乱。推荐分类顺序：

1. `java-fundamentals`：Java 语言基础。
2. `collections`：集合与泛型。推荐新增分类；如果不新增，则放入 `java-fundamentals`。
3. `jvm`：JVM。
4. `concurrency`：并发编程。
5. `spring`：Spring 生态。
6. `database`：数据库。
7. `middleware`：中间件。

### 4.2 必迁移和必修正

1. `topics/java/topic-046-75c87cc7.json` Bean 生命周期：从 `java-fundamentals` 移到 `spring`。
2. `topics/java/topic-047-7bfc4e55.json` 循环依赖：从 `java-fundamentals` 移到 `spring`。
3. `topics/java/topic-071-7bc711e7.json` Redis 数据结构：从 `spring` 移到 `middleware`。
4. `topics/java/topic-075-fa1c9279.json` 缓存问题：从 `spring` 移到 `middleware`。
5. `topics/java/topic-065-e2570d70.json` 索引原理：从 `spring` 移到 `database`，并改名为 `MySQL 索引原理` 或与 `topic-084-c3d4e5f6` 合并。
6. `topics/java/topic-028-905d9b58.json` HashMap 原理、`topic-029-2b936689.json` ArrayList 与 LinkedList、`topic-030-e4f16979.json` 其他集合：从 `concurrency` 移到 `collections` 或 `java-fundamentals`。
7. `topics/java/topic-026-3990751f.json` 与 `topics/java/topic-a78d7708.json` 都是 CompletableFuture：合并为一个 topic，保留内容质量更高的文件，删除另一个并从 domain 移除引用。
8. `topics/java/topic-034-f2553b47.json` Java 新特性：过宽。若保留，改为低频总览；优先删除，因为已有 Lambda、Stream、Optional、Record、Sealed、Pattern Matching、新日期时间 API。
9. `topics/java/topic-093-f2a3b4c5.json` 设计模式在并发中的应用：更适合设计模式或并发扩展。若保留在 Java，frequency 设 low。

### 4.3 Java 频率校准

1. HashMap、ArrayList、泛型、反射、JVM 内存、GC、类加载、线程池、synchronized、volatile、ThreadLocal、ConcurrentHashMap、Spring IoC/AOP/Bean 生命周期/循环依赖、MySQL 索引/MVCC/锁/SQL 优化、Redis 数据结构/缓存问题/Kafka/RabbitMQ：high。
2. Java 17+ 新特性、CompletableFuture、AQS、ReentrantLock、MyBatis、Nacos、OpenFeign、Gateway、Seata、RocketMQ：medium。
3. Sentinel、高可用架构、分布式事务补充方案、设计模式在并发中的应用、线上问题排查：low 或 medium，按岗位定位决定。

## 5. 算法领域整改

算法领域允许把题目作为知识点，这是唯一例外。当前主要问题是统计错误和一个分类挂载错误。

### 5.1 必修正

1. `manifest.json` 中 `algorithm.topicCount` 改为 `58`。
2. `topics/algorithm/topic-leetcode-239.json` 的 JSON `category` 是 `sliding-window`，但在 `domains/algorithm.json` 中挂在 `queue` 下。推荐把该文件从 `queue.topics` 移到 `sliding-window.topics`，顺序放在 `LeetCode 76` 后面。
3. 如果希望保留单调队列分类，则新增 `monotonic-queue` 分类，并把 `topic-leetcode-239` 改为该分类；不要继续挂在普通 `queue`。

### 5.2 顺序建议

推荐顺序：数组 -> 链表 -> 哈希表 -> 双指针 -> 滑动窗口 -> 栈 -> 队列/单调队列 -> 二叉树 -> 图 -> 二分 -> 排序 -> 贪心 -> 回溯 -> 动态规划 -> 设计题。

### 5.3 频率和难度建议

1. 高频题保持 high，但 `LeetCode 8`、`LeetCode 70`、`LeetCode 208` 可以是 medium。
2. `设计题基础` difficulty 4 可以保留，但如果内容只是方法论，应改成 `数据结构设计题解题框架`，并补充 LRU、Trie、MinStack 等题型。
3. 每个算法题必须有：题意、核心思路、复杂度、边界条件、可运行代码、常见追问。

## 6. 前端领域整改

前端领域整体分类可用，问题集中在频率偏低、标题中“实战”偏任务化、网络内容与 `network` 领域重复。

### 6.1 标题和定位

1. `topics/frontend/topic-react-hooks.json` 标题从 `React Hooks原理与实战` 改为 `React Hooks 原理`。
2. `topics/frontend/topic-ts-type-gymnastics.json` 标题从 `类型体操实战` 改为 `TypeScript 高级类型编程`，frequency 设 medium 或 low。
3. `topics/frontend/topic-node-engineering.json` 标题从 `Node.js工程实践` 改为 `Node.js 进程管理与线上排查`，否则删除或拆分。
4. `topics/frontend/topic-cross-platform.json` 可以保留为低频对比知识，但不要写成产品选型清单。
5. `topics/frontend/topic-http-https-tcp.json` 与 `network` 领域重复，前端内只保留浏览器请求链路、缓存、跨域、HTTPS 对前端影响，不重复 TCP 细节。

### 6.2 频率校准

1. high：JS 数据类型、原型链、闭包、Event Loop、Promise、手写 Promise、防抖节流、盒模型与 BFC、React Hooks、Vue 响应式、跨域与 CORS、前端安全。
2. medium：TypeScript 泛型、Vite/Webpack、React Fiber、React 性能、Vue 生命周期、Vue 编译、前端路由、Node.js 核心概念。
3. low：Electron、React Native、跨平台方案、BFF、微前端、CI/CD、监控、Node.js 工程排查。

## 7. 架构设计领域整改

架构领域允许保留系统设计题，但必须是通用架构能力，不是“个人项目包装”。

### 7.1 分类调整

当前分类基本可用，建议把 `project-design` 改名为 `business-system-design`，标题改为 `业务系统架构设计`。保留 topic，但正文必须强调通用架构模型、边界、权衡，不写个人项目经历。

### 7.2 必修正

1. `architecture.system-design.topic-sharding` 当前 frequency 为 low，应改为 high，weight 90。
2. `architecture.microservice.topic-idempotent-design` 当前 frequency 为 low，应改为 high，weight 90-95。
3. `architecture.project-design.topic-api-gateway` 建议移动到 `microservice`，frequency medium。
4. `architecture.project-design.topic-low-code` 保留为 low，标题改为 `低代码平台核心架构`。
5. `architecture.project-design.topic-multi-tenant` 保留，frequency medium 或 high，适合 SaaS 岗位。
6. `Service Mesh` 保持 low，不要高估。

### 7.3 内容要求

每个架构 topic 必须包含：

1. 适用场景。
2. 核心组件。
3. 关键权衡。
4. 常见故障或反模式。
5. 面试回答结构。

## 8. .NET 领域整改

.NET 领域没有明显非知识点，但所有 `interviewFrequency` 都是 low，不符合面试准备要求。

### 8.1 频率校准

1. high：C# 类型系统、async/await、LINQ、.NET GC、依赖注入、中间件管道、认证授权、Web API 设计、EF Core 基础、EF Core 性能优化。
2. medium：泛型与协变逆变、反射与特性、配置与选项模式、过滤器管道、仓储模式与工作单元、gRPC、消息队列集成、性能调优与诊断。
3. low：WPF、MAUI、Avalonia、客户端架构模式、XAML 数据绑定、.NET 与 Java 对比、设计模式在 .NET 中的应用、容器化与部署、SignalR。

### 8.2 标题和分类建议

1. `dotnet.client.*` 保留为低频方向性知识，不要放在通用 .NET 后端面试主线前面。
2. `.NET 与 Java 对比` 可以保留为跨语言对比低频 topic；如果目标是纯 .NET 面试，可删除。
3. `设计模式在 .NET 中的应用` 与设计模式领域有重叠，保留时必须强调 DI、中间件、事件机制中的本地化应用。

## 9. 操作系统与 Linux 领域整改

OS 领域结构合理，主要问题是部分 Linux 工具类 topic 频率过高、模板化追问较多。

### 9.1 频率校准

1. high：进程与线程区别、死锁、虚拟内存、阻塞/非阻塞/同步/异步、select/poll/epoll。
2. medium：IPC、线程同步、分页与分段、页面置换、Reactor、协程。
3. low：Linux 常用命令、文件权限、进程管理与监控、内存泄漏与溢出。若目标是后端排障岗位，可把进程管理与内存泄漏升为 medium。

### 9.2 内容整改

1. 删除所有“在实际项目中使用 X 时，你遇到过什么问题”模板题，替换为该 topic 的真实追问。
2. Linux 命令类 topic 必须聚焦面试常问命令和排查链路，不要变成命令大全。
3. `协程与纤程` 保持 medium，不要与 Java Virtual Threads 重复。

## 10. 计算机网络领域整改

网络领域结构合理，但 WebSocket、CDN、HTTP 状态码频率略有高估或低估需统一。

### 10.1 频率校准

1. high：TCP 与 UDP 区别、TCP 三次握手与四次挥手、TCP 可靠传输、HTTP 演进、HTTPS、DNS。
2. medium：TCP 流量控制与拥塞控制、CORS、CDN、WebSocket。
3. low：TCP 粘包与拆包、HTTP 状态码与头部字段、WebSocket 与长轮询对比。若目标是 Java 后端，可把粘包拆包升为 medium。

### 10.2 内容整改

1. `HTTP 状态码与头部字段` 不应过低到可忽略，建议 frequency medium 或 weight 80。
2. `CORS` 与前端领域重复时，网络领域讲协议和浏览器安全模型，前端领域讲开发配置和请求链路。
3. 删除模板化“理论和实践脱节”答案。

## 11. 设计模式领域整改

设计模式领域整体合理，但 “设计原则与实战” 分类名称偏任务化。

### 11.1 分类和标题

1. `principles` 标题从 `设计原则与实战` 改为 `设计原则与框架应用`。
2. `设计模式在Spring中的应用` 可以保留，但必须是 `Spring 中的设计模式应用`，作为 low/medium 扩展 topic。
3. `门面模式` low 合理；`适配器模式` medium；`代理模式` high；`单例模式` high；`策略模式` high。

### 11.2 内容整改

1. 所有模式 topic 的追问应替换为具体问题，例如“策略模式如何避免 if-else 过度膨胀”“代理模式和装饰器模式的区别”。
2. 删除通用答案“最常见的坑是理论和实践脱节”。
3. 每个模式 topic 必须包含：意图、结构、适用场景、优缺点、与相近模式区别、Java/Spring 示例。

## 12. 执行顺序

后续 AI 必须按以下顺序执行，不要一次性全库乱改：

1. 修正 `manifest.json` topicCount。
2. 修正所有 topic `id` 与 `category` 不一致问题。
3. 先整改 Agent 领域，删除不应作为知识点的 topic，重排分类。
4. 整改 Java 分类错位和重复 topic。
5. 修正算法 `topic-leetcode-239` 挂载位置。
6. 批量替换全库模板化答案和污染 summary。
7. 校准各领域 `difficulty`、`interviewFrequency`、`recommendWeight`。
8. 运行校验脚本和人工抽样审查。

## 13. 验收标准

### 13.1 自动校验

必须通过：

```bash
npm run validate
```

并且以下自定义检查输出为空：

```bash
node - <<'NODE'
const fs=require('fs');
for (const dir of fs.readdirSync('topics')) {
  for (const f of fs.readdirSync(`topics/${dir}`).filter(x=>x.endsWith('.json'))) {
    const p=`topics/${dir}/${f}`;
    const t=JSON.parse(fs.readFileSync(p,'utf8'));
    const parts=t.id.split('.');
    if (parts[0]!==t.domain || parts[1]!==t.category) {
      console.log('ID_MISMATCH', p, t.id, t.domain, t.category, t.title);
    }
    const text=JSON.stringify(t);
    for (const bad of [
      '最常见的坑是理论和实践脱节',
      '综合复习与面试冲刺',
      '简历AI部分优化',
      'AI面试场景题',
      '@EnableAutoConfiguration扫描spring.factories'
    ]) {
      if (text.includes(bad)) console.log('BAD_TEXT', p, bad);
    }
  }
}
NODE
```

### 13.2 人工抽样

每个领域至少抽查 3 个 high topic、2 个 medium topic、1 个 low topic，确认：

1. 标题是知识点，不是任务。
2. 分类归属正确。
3. summary 没有错别字、无残缺、无其他领域串入。
4. learningCards 能支撑从 0 到 1 学会该知识点。
5. recallPrompts 是可面试复述的问题。
6. rubric 是该知识点专属评分标准。

### 13.3 最终交付要求

1. 不保留个人简历、项目包装、面试冲刺、综合复习类 topic。
2. Agent 领域能够覆盖从 LLM 基础、RAG、Agent 到 LLMOps 的完整面试准备链路。
3. 所有领域分类顺序符合“基础 -> 原理 -> 框架/工程 -> 架构/高级”的学习顺序。
4. `difficulty`、`interviewFrequency`、`recommendWeight` 三者匹配，不出现全领域低频或明显高估。
5. 运行 `npm run validate` 通过，且自定义一致性检查无输出。
