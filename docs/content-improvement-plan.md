# 面试知识内容剩余整改计划

> 更新日期：2026-05-29  
> 依据标准：`docs/knowledge-content-standard.md`  
> 当前状态：上一轮模板化问题已大面积修复，本文件只保留当前复检仍需要处理的内容。  

## 1. 当前结论

已重新检查 `topics/` 下 287 个知识点。

结构层面：`npm run validate` 通过，schema、manifest、domain 引用、基础卡片类型、scoreWeights 等硬性契约达标。

语义层面：上一版计划中的大批模板化问题已修复，不再保留旧的 230 个 topic 整改清单。当前复检从“准备面试的用户能否按合理路径从易到难学习”的角度出发，发现剩余问题集中在：

1. Java 基础分类排序不符合“基础概念 -> 核心原理 -> 高级扩展”的标准。
2. `Java新特性` 作为独立 topic 粒度过大，且与多个已拆分 topic 重复。
3. `其他集合` topic 定位、group/tags、recallPrompts 和 followUpQuestions 有串题。
4. Agent 领域仍有少量 Java/Spring 示例残留。
5. 多个领域存在 `domain.categories[].topics` 列表顺序、topic `order`、`interviewFrequency`、`recommendWeight` 互相打架的问题。
6. 部分低频/扩展 topic 权重过高，会在 App 首屏挤掉基础高频内容。
7. 部分标题过泛、归类不清或疑似重复，会增加学习路径噪音。
8. 当前标准对“App 展示顺序验收”的要求还不够硬，需要补强。

本轮整改属于知识内容更新，不涉及 JSON 结构契约变更。不要改 schema、字段类型、枚举或加载协议。

## 2. 已修复项

以下问题在当前 `topics/` 中未再命中，暂不需要继续处理：

1. `今日笔记`
2. `面试话术`
3. `你遇到过什么问题`
4. `在实际项目中是怎么用的？有什么注意事项？`
5. `结合项目经验`
6. `能做对比`
7. `能说明取舍`
8. 重复 `followUpQuestions`
9. 重复 `recallPrompts.id`
10. `RAG原理与` 截断残句

后续只需防止这些问题回流。

## 3. 剩余整改清单

### A. Java 基础与集合排序不合理

涉及文件：

1. `domains/java.json`
2. `topics/java/topic-028-905d9b58.json`：HashMap原理
3. `topics/java/topic-029-2b936689.json`：ArrayList与LinkedList
4. `topics/java/topic-030-e4f16979.json`：其他集合
5. `topics/java/topic-032-8b727f38.json`：泛型
6. `topics/java/topic-033-070d3ba1.json`：反射与注解
7. `topics/java/topic-lambda.json`：Lambda 表达式与函数式接口
8. `topics/java/topic-stream-api.json`：Stream API 详解
9. `topics/java/topic-optional.json`：Optional 类使用
10. `topics/java/topic-new-datetime.json`：新日期时间 API
11. `topics/java/topic-record.json`：Record 类（Java 14+）
12. `topics/java/topic-sealed-classes.json`：Sealed Classes（Java 17+）
13. `topics/java/topic-pattern-matching.json`：Pattern Matching（Java 17+）

当前问题：

`domains/java.json` 中 `java-fundamentals.topics` 把 `泛型`、`Java新特性`、`Lambda/Stream/Optional/Record/Sealed/Pattern Matching/日期 API` 放在 `HashMap`、`ArrayList与LinkedList`、`其他集合` 前面。App 截图显示这些现代语法特性排在列表顶部，这不符合标准第 7 节“基础概念 -> 核心原理 -> 框架机制 -> 工程问题 -> 高级扩展”的排序要求。

建议顺序：

```text
HashMap原理
ArrayList与LinkedList
其他集合（整改后改名，见 B）
泛型
反射与注解
Lambda 表达式与函数式接口
Stream API 详解
Optional 类使用
新日期时间 API
Record 类（Java 14+）
Sealed Classes（Java 17+）
Pattern Matching（Java 17+）
```

推荐权重建议：

1. `HashMap原理`：high，recommendWeight 95-100。
2. `ArrayList与LinkedList`：high 或 medium-high，recommendWeight 88-94。
3. `其他集合`：medium，recommendWeight 78-86。
4. `泛型`：high 或 medium-high，recommendWeight 86-92。
5. `反射与注解`：medium-high，recommendWeight 82-90。
6. `Lambda`、`Stream`：medium，recommendWeight 75-85。
7. `Optional`、`新日期时间 API`：medium 或 low-medium，recommendWeight 65-78。
8. `Record`、`Sealed Classes`、`Pattern Matching`：low 或 medium，recommendWeight 55-72，放在扩展位置。

验收标准：

1. App 中 Java 基础与集合的首屏优先展示集合核心，而不是 Java 8+ 新特性。
2. `domain.categories[].topics` 顺序与 topic `order` 一致。
3. `recommendWeight` 不再让低频现代语法特性压过 `HashMap`、`ArrayList`。

### B. `Java新特性` 不应继续作为独立 topic

涉及文件：

1. `topics/java/topic-034-f2553b47.json`
2. `domains/java.json`

当前问题：

`Java新特性` 是过大的合集型 topic。标准第 5 节明确把 `Java 新特性` 列为“过大，需要拆分”的例子。仓库中已经有独立 topic 覆盖：

1. `Lambda 表达式与函数式接口`
2. `Stream API 详解`
3. `Optional 类使用`
4. `新日期时间 API`
5. `Record 类（Java 14+）`
6. `Sealed Classes（Java 17+）`
7. `Pattern Matching（Java 17+）`

整改方式：

1. 从 `domains/java.json` 的 `java-fundamentals.topics` 中移除 `topics/java/topic-034-f2553b47.json`。
2. 判断是否删除该 topic 文件：
   - 如果内容完全被现有 topic 覆盖，删除文件。
   - 如果仍有少量独有内容，把独有内容合并到对应 topic 后再删除。
3. 如果删除文件，要检查 manifest 的 `topicCount` 是否需要调整。
4. 不要把它改名为另一个合集 topic。

验收标准：

1. App 不再展示 `Java新特性` 这个合集知识点。
2. 对应知识由细粒度 topic 承担。
3. `npm run validate` 通过。

### C. `其他集合` topic 定位和内容串题

涉及文件：

1. `topics/java/topic-030-e4f16979.json`
2. `domains/java.json`

当前问题：

1. 标题 `其他集合` 太泛，不像稳定知识点标题。
2. `group` 是 `concurrency`，tags 里有 `并发编程`，但实际内容是集合框架。
3. recallPrompts 混入线程安全单例、生产者消费者、自定义线程池，明显串题。
4. followUpQuestions 仍有泛化表达，例如“线上出现与其他集合相关的问题”。
5. 内容里有空标题或未展开小节，例如“核心接口说明”“集合选型指南”。

整改方式：

1. 将标题改为更明确的知识点名，例如 `Set、TreeMap 与 Queue 集合`，或拆成两个 topic：
   - `Set 与有序集合`
   - `Queue 与 PriorityQueue`
2. 如果不拆分，至少修正：
   - `group` 改为 `java-fundamentals`。
   - tags 去掉 `并发编程`。
   - summary 改成覆盖 Set、TreeMap、LinkedHashMap、PriorityQueue 的中性描述。
3. 删除所有并发题 recallPrompts：
   - `请手写一个线程安全的单例模式（DCL）`
   - `请手写一个生产者-消费者模型`
   - `请手写一个自定义线程池的核心逻辑`
4. recallPrompts 改为集合专属问题，例如：
   - `HashSet 为什么依赖 hashCode 和 equals？如果只重写 equals 会怎样？`
   - `TreeSet 与 HashSet 的底层结构、复杂度和适用场景有什么区别？`
   - `LinkedHashMap 如何基于访问顺序实现 LRU？`
   - `PriorityQueue 的堆结构如何保证 offer/poll 的复杂度？`
5. followUpQuestions 改为集合专属追问，不要写泛化线上排查。
6. 补齐或删除空标题。

验收标准：

1. topic 标题、summary、group、tags 与集合内容一致。
2. recallPrompts 和 followUpQuestions 不再出现并发题。
3. 该 topic 能独立回答 Set、TreeMap、LinkedHashMap、PriorityQueue 的面试问题。

### D. Agent 领域仍有 Java/Spring 示例残留

涉及文件：

1. `topics/agent/topic-093-de1a9ab0.json`：MCP协议深度
2. `topics/agent/topic-106-bf5350b9.json`：RAG原理与实战

当前问题：

`topic-093` 中有 Java/Spring Boot MCP Server 示例。若该 topic 目标是 MCP 协议本身，建议优先使用协议级、Python 或 TypeScript 示例，避免把 Agent 领域内容带成 Java/Spring 实战。

`topic-106` 中仍有 `什么是自动装配`、`Spring Boot` 相关表述。RAG topic 应使用 RAG 自身问题作为样例，例如企业知识库问答、检索召回、引用溯源、幻觉定位。

整改方式：

1. `topic-093`：
   - 如果保留 Java 示例，必须明确它只是“非官方生态实现思路”，不能成为主示例。
   - 更推荐替换为 Python/TypeScript MCP Server 或 JSON-RPC 协议交互示例。
2. `topic-106`：
   - 将 `什么是自动装配` 替换为 `如何定位 RAG 检索召回不准` 或 `某个知识库问题如何检索并回答`。
   - 将 `Spring Boot` 相关描述替换为 RAG/Agent 领域中性描述。

验收标准：

1. `rg -n "Spring Boot|Redis缓存穿透|什么是自动装配" topics/agent` 不再命中，除非人工确认该处确实必要且有明确说明。
2. Agent topic 的示例不再让读者误以为该 topic 属于 Java/Spring。

### E. Java 分类中仍可能有重复/错误归类

涉及文件：

1. `domains/java.json`
2. `topics/java/topic-065-e2570d70.json`：MySQL 索引原理
3. `topics/java/topic-084-c3d4e5f6.json`：MySQL索引原理
4. `topics/java/topic-066-d9e7b897.json`：事务机制
5. `topics/java/topic-085-d4e5f6a7.json`：MySQL事务与MVCC
6. `topics/java/topic-068-fd69e227.json`：锁机制
7. `topics/java/topic-086-e5f6a7b8.json`：MySQL锁机制

当前问题：

数据库分类里存在疑似重复 topic：

1. `MySQL 索引原理` 与 `MySQL索引原理`
2. `事务机制` 与 `MySQL事务与MVCC`
3. `锁机制` 与 `MySQL锁机制`

这不是截图里的首要问题，但会影响标准第 17 节“是否和已有 topic 重复”。

整改方式：

1. 对每组重复 topic 做内容对比。
2. 如果内容高度重复，保留更完整、更高频、更符合面试表达的一个，另一个删除或合并。
3. 如果一个是总论、一个是细分，标题和 summary 必须明确边界，例如：
   - `MySQL B+ 树索引与索引失效`
   - `事务隔离级别与 MVCC`
   - `MySQL 行锁、间隙锁与 Next-Key Lock`
4. 更新 `domains/java.json` 引用和 manifest topicCount。

验收标准：

1. 同一分类下没有标题近似、内容重复的 topic。
2. 每个保留 topic 都有清晰独立边界。

### F. Java Spring/中间件分类混杂

涉及文件：

1. `domains/java.json`
2. `topics/java/topic-059-a4e73804.json`：Gateway
3. `topics/java/topic-062-ce26874b.json`：Seata分布式事务
4. `topics/java/topic-080-3c934d6a.json`：Kafka原理
5. `topics/java/topic-055-e51532ee.json`：Nacos
6. `topics/java/topic-058-72ff8a49.json`：OpenFeign
7. `topics/java/topic-077-0f4a426f.json`：RabbitMQ原理
8. `topics/java/topic-081-89b01558.json`：RocketMQ与选型
9. `topics/java/topic-061-7a8c02dc.json`：Sentinel
10. `topics/java/topic-078-0195276a.json`：可靠性与实战

当前问题：

`Spring 生态` 分类里混入了消息队列、注册配置、网关、熔断、分布式事务等中间件/微服务治理内容。对用户来说，这会造成“Spring 基础还没学完就进入 Spring Cloud / MQ / Seata”的跳跃。

整改方式：

1. 将 `Spring 生态` 收敛为 Spring / Spring Boot / Spring MVC / MyBatis 核心：
   - IoC容器
   - Bean生命周期
   - 循环依赖
   - AOP原理
   - 自动装配原理
   - SpringBoot启动流程
   - SpringBoot配置体系
   - SpringMVC原理
   - MyBatis核心原理
   - MyBatis-Plus（如保留，放在 MyBatis 之后，权重低于 MyBatis核心原理）
2. 将 Gateway、Nacos、OpenFeign、Sentinel、Seata 移到一个更合适的分类，例如 `microservice` 或 `spring-cloud`。
3. 将 Kafka、RabbitMQ、RocketMQ 移到 `middleware` 或新增 `message-queue` 分类。
4. `可靠性与实战` 标题过泛，需要改为明确知识点，例如 `消息队列可靠性投递`；如果内容无法聚焦，应合并进 MQ topic。

验收标准：

1. `Spring 生态` 首屏不再出现 Kafka/RabbitMQ/RocketMQ/Nacos/OpenFeign/Sentinel/Seata。
2. 中间件和微服务治理按依赖顺序出现在 Spring 基础之后。
3. 每个分类标题与其 topic 内容一致。

### G. Agent 领域顺序与分类需要按学习路径重排

涉及文件：

1. `domains/agent.json`
2. `topics/agent/topic-090-357bf78b.json`：Prompt Engineering
3. `topics/agent/topic-inference-decoding.json`：推理机制与解码参数
4. `topics/agent/topic-088-d8088d8c.json`：向量数据库索引与检索
5. `topics/agent/topic-121-15a0b1b4.json`：向量数据库核心能力对比
6. `topics/agent/topic-087-81c07ef4.json`：Function Calling 与工具调用
7. `topics/agent/topic-115-35c5dcec.json`：MCP协议基础
8. `topics/agent/topic-093-de1a9ab0.json`：MCP协议深度
9. `topics/agent/topic-107-9a15a561.json`：Agent架构与MCP
10. `topics/agent/topic-125-30dc0c91.json`：Agent状态管理
11. `topics/agent/topic-124-6e95a1cd.json`：多Agent协作模式
12. `topics/agent/topic-091-ee657ad3.json`：AI评估与观测
13. `topics/agent/topic-094-e03e7524.json`：AI安全与合规

当前问题：

1. 大模型基础中 `推理机制与解码参数` 的 `order=40`，但列表放在 `Prompt Engineering(order=50)` 后面。
2. Embedding 分类中 `向量数据库核心能力对比(order=40)` 放在 `向量数据库索引与检索(order=50)` 后面。
3. 工具调用与 Agent 架构中 Function Calling 是高频基础，但被放到后面；Agent状态、多Agent等更高级内容排在前面。
4. LLMOps 中 AI评估/安全是高频，但被放在语义缓存、模型路由、Fine-tuning 后面。

建议顺序：

```text
大模型基础：
Transformer与注意力机制 -> 大模型训练流程 -> 推理机制与解码参数 -> Prompt Engineering

Embedding 与向量检索：
向量数据库索引与检索 -> 向量数据库核心能力对比

RAG：
RAG原理与实战 -> 文档分块策略 -> RAG进阶 -> RAG评估与优化

工具调用与 Agent 架构：
Function Calling 与工具调用 -> MCP协议基础 -> MCP协议深度 -> ReAct与Plan-and-Execute -> Agent架构与MCP -> Agent状态管理 -> 多Agent协作模式

LLMOps：
AI评估与观测 -> AI安全与合规 -> 语义缓存与成本优化 -> 模型路由与降级方案 -> LLM Fine-tuning 与 LoRA
```

验收标准：

1. 高频基础内容出现在高级 Agent 架构之前。
2. 同一分类中的列表顺序与 topic `order` 一致。
3. `Function Calling` 不应排在 MCP/多 Agent 后面。

### H. 算法领域 order 值不规范，可能影响 App 排序

涉及文件：

1. `domains/algorithm.json`
2. `topics/algorithm/` 下多个算法 topic

当前问题：

多个算法分类下，基础 topic 放在第一位，但 LeetCode 题的 `order=0`，导致如果 App 按 `order` 排序，题目可能跑到“基础”前面。命中分类包括：

1. 滑动窗口
2. 栈
3. 哈希表
4. 二叉树
5. 图
6. 动态规划
7. 回溯
8. 贪心
9. 二分查找
10. 字符串

整改方式：

1. 统一算法领域排序规则：每个分类先基础 topic，再经典题。
2. 将基础 topic 的 `order` 设为 10。
3. 经典题按推荐学习顺序设为 20、30、40...
4. `domains/algorithm.json` 中列表顺序和 topic `order` 保持一致。
5. 算法基础 topic 的 `recommendWeight=70` 可以保留为“知识基础”，但如果 App 按权重排序，需要确保基础 topic 不被题目全部压到后面。必要时提高基础 topic 权重到 85 左右，或明确 App 使用 domain 列表顺序。

验收标准：

1. App 每个算法分类首项是该题型基础，而不是 LeetCode 题。
2. 同一分类没有多个 topic 使用 `order=0`。

### I. 前端领域低频内容权重过高，可能挤压基础主线

涉及文件：

1. `domains/frontend.json`
2. `topics/frontend/topic-perf-optimization.json`：前端性能优化全景
3. `topics/frontend/topic-http-https-tcp.json`：HTTP/HTTPS/TCP协议
4. `topics/frontend/topic-state-arch.json`：前端状态管理架构
5. `topics/frontend/topic-micro-frontend.json`：微前端架构
6. `topics/frontend/topic-react-native.json`：React Native核心原理
7. `topics/frontend/topic-koa-express.json`：Koa/Express框架原理
8. `topics/frontend/topic-react18-features.json`：React 18+新特性
9. `topics/frontend/topic-ts-config.json`：TS与JS互操作与工程配置
10. `topics/frontend/topic-vue-ecosystem.json`：Vue生态（Pinia/Vue Router）

当前问题：

1. 多个 `low` 频 topic 权重达到 85-95，容易在 App 推荐顺序里压过基础内容。
2. `前端性能优化全景` 标题过大，标准第 5 节明确把“前端性能优化全景”列为过大示例。
3. `HTTP/HTTPS/TCP协议` 在前端领域是低频但 `recommendWeight=95`，应避免压过 JS、CSS、React/Vue 基础；网络系统性内容应主要由 `network` 领域承担。

整改方式：

1. 重新校准 frontend 中 `low` 频 topic 的 recommendWeight，建议降到 50-75。
2. `前端性能优化全景` 应拆分或改名聚焦，例如：
   - `前端加载性能优化`
   - `运行时性能优化与长任务`
   - `Core Web Vitals 指标优化`
   若暂不拆分，至少降低权重并放在架构扩展后段。
3. `HTTP/HTTPS/TCP协议` 与 network 领域重复度高，建议：
   - 前端领域保留为 `浏览器网络请求链路` 或 `前端视角的 HTTP 缓存与请求`。
   - TCP/HTTPS 原理回到 network 领域。
4. `React 18+新特性`、`React Native核心原理`、`微前端架构`、`Koa/Express框架原理` 保留为低频扩展，不应高权重。

验收标准：

1. 前端首屏和推荐主线优先 JS 基础、异步、原型链、闭包、CSS、React/Vue 核心。
2. 低频架构/跨端/生态 topic 不抢主线位置。
3. `前端性能优化全景` 不再作为过大的高权重主线 topic。

### J. 架构领域 API 网关分类位置错误，方法论顺序偏难

涉及文件：

1. `domains/architecture.json`
2. `topics/architecture/architecture.project-design.topic-api-gateway.json`：API网关设计
3. `topics/architecture/architecture.methodology.topic-ddd.json`：DDD领域驱动设计
4. `topics/architecture/architecture.methodology.topic-cqrs.json`：CQRS架构
5. `topics/architecture/architecture.methodology.topic-event-driven.json`：事件驱动架构
6. `topics/architecture/architecture.methodology.topic-hexagonal.json`：六边形架构
7. `topics/architecture/architecture.microservice.topic-service-governance.json`：服务治理全景

当前问题：

1. `API网关设计` 文件名属于 `project-design`，但当前放在 `microservice` 分类里，且与 `分布式锁实现方案` 共用 `order=30`。
2. 方法论分类把 `DDD` 放在第一个且标 high，容易让初学者一上来进入高抽象内容。架构领域可以高级，但仍应先从系统设计/微服务核心问题建立直觉。
3. `服务治理全景` 标题偏大，容易成为组件清单合集，需要检查是否能独立复述核心机制。

整改方式：

1. 明确 `API网关设计` 归属：
   - 如果作为微服务基础组件，文件名、category、domain 引用都统一到 `microservice`。
   - 如果作为项目设计题，移回 `project-design`。
2. 调整架构领域学习路径：先系统设计与微服务基础，再 DDD/CQRS/六边形等方法论扩展。
3. 检查 `服务治理全景` 是否过大；如果只是注册发现、配置中心、负载均衡、熔断等清单，建议拆分或改名为 `服务治理核心组件与链路` 并补充主线。

验收标准：

1. 同一分类中无重复 order。
2. API 网关的 category 与所在分类一致。
3. 架构领域的默认顺序从常见系统设计能力开始，而不是先进入高抽象方法论。

### K. OS 与 Network 领域低频高权重和顺序问题

涉及文件：

1. `domains/os.json`
2. `domains/network.json`
3. `topics/os/topic-linux-commands.json`
4. `topics/os/topic-file-permissions.json`
5. `topics/os/topic-process-management.json`
6. `topics/os/topic-memory-leak.json`
7. `topics/network/topic-tcp-vs-udp.json`
8. `topics/network/topic-dns.json`
9. `topics/network/topic-cdn.json`
10. `topics/network/topic-websocket-vs-polling.json`

当前问题：

1. OS 的 Linux 基础内容 `常用命令`、`文件权限`、`进程管理` 都是 low，但权重 93-97，可能挤压进程线程、虚拟内存、IO 模型这些更核心面试内容。
2. OS 进程线程分类中 `进程与线程的区别` 是 high 且权重最高，但 order=50，排在 IPC/同步/死锁/协程之后；从备考角度应放在最前。
3. IO 模型中 `阻塞/非阻塞/同步/异步` 是基础概念，但排在 select/poll/epoll 和 Reactor 后面。
4. Network 中 `TCP 与 UDP 的区别` 是基础高频，但排在 TCP 分类最后。
5. DNS/CDN 中 `DNS解析流程` 应在 `CDN原理` 前。
6. WebSocket 中 `WebSocket协议原理` 应在 `WebSocket与长轮询对比` 前。

整改方式：

1. OS 调整顺序：
   - 进程与线程区别 -> 线程同步 -> 死锁 -> IPC -> 协程
   - 虚拟内存 -> 分页分段 -> 页面置换 -> 内存泄漏与溢出
   - 阻塞/非阻塞/同步/异步 -> select/poll/epoll -> Reactor
   - Linux 基础作为后置补充，并降低低频权重。
2. Network 调整顺序：
   - TCP/UDP 区别 -> TCP 三次握手与四次挥手 -> TCP可靠传输 -> 流控拥塞 -> 粘包拆包
   - HTTP演进 -> 状态码与头部 -> HTTPS -> CORS（或按 App 目标岗位调整）
   - DNS -> CDN
   - WebSocket协议 -> WebSocket与长轮询对比
3. 校准 low 频高权重，除非有明确前置依赖，不应超过 75。

验收标准：

1. OS/Network 首屏符合从基础概念到机制细节的备考路径。
2. low 频扩展内容不抢 high 频核心内容。

### L. .NET 领域客户端低频内容权重偏高

涉及文件：

1. `domains/dotnet.json`
2. `topics/dotnet/client-maui.json`
3. `topics/dotnet/client-xaml-data-binding.json`
4. `topics/dotnet/client-avalonia.json`
5. `topics/dotnet/client-architecture-patterns.json`
6. `topics/dotnet/advanced-dotnet-vs-java.json`

当前问题：

.NET 客户端相关 topic 多数是 low，但权重达到 80-85。若 App 统一按权重推荐，会让客户端/跨平台内容压过 C#、ASP.NET Core、EF Core 等后端面试主线。

整改方式：

1. 如果本领域定位是“.NET 后端面试”，客户端分类整体应后置且降权。
2. 如果本领域定位包含客户端，则 learningPath 需要拆成 `.NET 后端路线` 与 `.NET 客户端路线`，避免同一主线混排。
3. `.NET 与 Java 对比` 保留为高级扩展，不应进入基础路径。

验收标准：

1. 默认路线优先 C#、.NET Core、ASP.NET Core、EF Core。
2. 客户端内容作为独立路线或后置扩展。

### M. 设计模式领域低频高权重与 Spring 应用位置

涉及文件：

1. `domains/design-pattern.json`
2. `topics/design-pattern/topic-spring-she-ji-mo-shi.json`

当前问题：

`设计模式在Spring中的应用` 是 low，但权重 85，且属于框架应用型内容。它适合作为学完核心模式后的综合应用，不应压过基础设计原则或常见模式。

整改方式：

1. 保留为扩展 topic，但权重建议降到 65-75。
2. 放在 SOLID、单例、工厂、代理、策略、观察者、责任链等核心模式之后。
3. 检查它是否与 Java/Spring 领域中的 AOP、IoC、模板方法等内容重复；若重复严重，可迁移到 Java Spring 领域或改为交叉引用。

验收标准：

1. 设计模式主线先学原则和常见模式，再学 Spring 应用。
2. low 频扩展不抢核心模式位置。

### N. 标准本身需要补强：App 展示顺序验收

涉及文件：

1. `docs/knowledge-content-standard.md`
2. `scripts/validate_content.mjs`

当前问题：

现有标准对 topic 是否成立、内容是否模板化写得很清楚，但对 App 实际展示顺序的约束不够可执行。结果是：schema 通过、单 topic 看起来合格，但 App 中低频扩展内容会排到核心内容前面，影响真实备考路径。

建议补充到标准：

1. 每个领域必须提供“默认学习顺序”的人工验收标准。
2. 同一分类内 `domain.categories[].topics` 顺序必须与 topic `order` 一致；如果 App 不按 `order`，必须在标准中明确 App 排序使用哪个字段。
3. `interviewFrequency` 与 `recommendWeight` 必须大体一致：
   - high 通常 85-100
   - medium 通常 70-88
   - low 通常 50-75
   - 例外必须在 topic 或整改说明中写明原因。
4. high 频核心 topic 不应低于 75 权重，除非该 topic 是低优先级补充。
5. low 频扩展 topic 不应高于 85 权重，除非是大量内容的必要前置依赖。
6. 禁止同一分类内出现重复 `order`。
7. 每次验收必须站在“新用户从 0 到 1 准备面试”的视角检查 App 首屏，不只跑 JSON schema。

建议补充到校验脚本：

1. 检查同一分类内 `order` 是否重复。
2. 检查 `domain.categories[].topics` 是否按 `order` 升序。
3. 检查 low 频高权重、high 频低权重。
4. 输出 warning，不一定立刻 fail；整改完成后再将关键规则改为 fail。

## 4. 推荐执行顺序

1. 先修 `N. 标准本身需要补强`，否则后面仍会反复出现“schema 通过但 App 顺序不合理”。
2. 修 `D. Agent 领域残留`，这是最小且明确的问题。
3. 修 `C. 其他集合`，因为它当前在截图首屏，且串题明显。
4. 修 `B. Java新特性`，删除或迁移合集 topic。
5. 修 `A. Java 基础与集合排序`，同步调整 `domains/java.json` topic 顺序、topic `order`、`recommendWeight`。
6. 修 `F. Java Spring/中间件分类混杂` 和 `E. Java 数据库重复 topic`。
7. 修 `G. Agent 顺序`、`H. 算法 order`、`I. 前端权重`、`J. 架构分类`、`K. OS/Network 顺序`、`L. .NET 路线`、`M. 设计模式权重`。
8. 最后打开 App 做每个领域首屏人工验收。

## 5. 验收命令

每批修改后运行：

```bash
npm run validate
```

高风险词扫描：

```bash
rg -n "今日笔记|面试话术|你遇到过什么问题|在实际项目中是怎么用的？有什么注意事项？|结合项目经验|能做对比|能说明取舍|回答不够深入|不了解原理" topics
```

Agent 跨领域残留扫描：

```bash
rg -n "Spring Boot|Redis缓存穿透|什么是自动装配" topics/agent
```

Java 基础排序检查：

```bash
node - <<'NODE'
const fs = require('fs');
const domain = JSON.parse(fs.readFileSync('domains/java.json', 'utf8'));
const cat = domain.categories.find(c => c.id === 'java-fundamentals');
for (const ref of cat.topics) {
  const t = JSON.parse(fs.readFileSync(ref, 'utf8'));
  console.log(`${String(t.order).padStart(4)} | ${t.interviewFrequency}/${t.recommendWeight} | ${t.title} | ${ref}`);
}
NODE
```

全领域顺序/权重异常扫描：

```bash
node - <<'NODE'
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
for (const de of manifest.domains) {
  const d = JSON.parse(fs.readFileSync(de.entry, 'utf8'));
  for (const c of d.categories) {
    const topics = c.topics.map(ref => ({ ref, t: JSON.parse(fs.readFileSync(ref, 'utf8')) }));
    const seen = new Map();
    for (let i = 0; i < topics.length; i++) {
      const { ref, t } = topics[i];
      if (i > 0 && topics[i - 1].t.order > t.order) {
        console.log(`ORDER_DESC ${d.id}/${c.id}: ${topics[i - 1].t.title}(${topics[i - 1].t.order}) -> ${t.title}(${t.order})`);
      }
      if (seen.has(t.order)) {
        console.log(`DUP_ORDER ${d.id}/${c.id}: ${t.order} ${seen.get(t.order)} / ${t.title}`);
      }
      seen.set(t.order, t.title);
      if (t.interviewFrequency === 'low' && t.recommendWeight >= 85) {
        console.log(`LOW_HIGH_WEIGHT ${d.id}/${c.id}: ${t.title} w=${t.recommendWeight} ${ref}`);
      }
      if (t.interviewFrequency === 'high' && t.recommendWeight < 75) {
        console.log(`HIGH_LOW_WEIGHT ${d.id}/${c.id}: ${t.title} w=${t.recommendWeight} ${ref}`);
      }
    }
  }
}
NODE
```

最终人工验收：

1. 每个领域首屏都应从最基础、最高频、最能建立面试主线的内容开始。
2. Java 基础与集合首屏应先看到核心集合和语言基础，而不是 Java 8+ 现代语法扩展。
3. `Java新特性` 不再作为独立正式 topic。
4. `其他集合` 不再出现并发题。
5. Agent topic 不再串入 Java/Spring 示例。
6. 全领域没有明显 low 频高权重、high 频低权重、重复 order、列表顺序与 order 冲突的问题。
7. `npm run validate` 通过。
