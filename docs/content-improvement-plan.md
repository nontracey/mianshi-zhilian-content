# 面试知识内容更新计划

> 更新日期：2026-05-29  
> 依据标准：`docs/knowledge-content-standard.md`  
> 当前结论：本轮“小范围统一增强”已完成。现有内容已达到可发布基线，后续优化以定期抽查和少量高频缺口补充为主，不建议再做大规模重写。  

## 1. 总体判断

当前 `topics/` 下 298 个知识点已经通过结构校验：

```text
npm run validate
Validated 298 topics across 9 domains.
```

从标准角度看，现有内容满足以下基线：

1. 领域、分类、知识点结构完整，App 可按 `manifest -> domain -> category -> topic` 正常展示。
2. 大部分高频基础知识已经覆盖，且没有明显的阶段计划、面试话术、简历包装、项目合集等不合格 topic。
3. Agent、OS、Network、算法等领域的主线顺序已经基本符合“先基础，再机制，再扩展”。
4. 上一轮发现的 Spring/MQ 串题、泛标题、RAG 工具清单化、Agent/OS/Network 顺序问题已经修复。

从真实面试者使用体验看，本轮已经完成一次增强收口。增强方向不是因为“当前不达标”，而是为了让知识库更接近从 0 到 1 备考的自然路径：

1. 已微调 Java、前端等分类内顺序，使基础概念和核心机制更靠前。
2. 已清理 recallPrompts、summary 等小质量问题，减少模板化训练题。
3. 已补充算法、Agent、Java 后端、前端的少量高频知识点。
4. 已通过 `interviewFrequency`、`recommendWeight` 和排序表达“优先学什么、哪些是扩展”。

因此本文档现在定位为“内容增强复盘和后续维护参考”，不是“阻塞发布的整改计划”。

## 2. 是否满足面试者需要

### 2.1 已满足的部分

对准备 Java 后端、前端、Agent、算法、OS、网络、架构、.NET 的用户，当前内容已经能提供：

1. 基础八股主线：Java 集合、JVM、并发、Spring、MySQL、Redis/MQ、网络、OS、算法。
2. 框架原理主线：Spring、React、Vue、Node.js、ASP.NET Core、EF Core。
3. 工程与架构主线：微服务、缓存、消息队列、分布式事务、限流熔断、系统设计。
4. Agent 新方向主线：大模型基础、Embedding/RAG、工具调用、Agent 架构、LLMOps。
5. App 总览：`docs/knowledge-directory.md` 已按展示顺序列出领域、分类和知识点。

### 2.2 本轮已增强的部分

本轮已经处理的增强点：

1. Java 分类内部顺序已调整，例如 MyBatis 核心排在 MyBatis-Plus 前，Redis 数据结构排在 Redis 集群前。
2. 算法已补充堆/优先队列、并查集、BFS/DFS 模板和 LeetCode 347。
3. Agent 已补充 Token/上下文窗口、Embedding 相似度、RAG 召回策略、Prompt 注入防护。
4. 前端已补充浏览器渲染、HTTP 缓存、认证机制、Tree Shaking，并微调 React/工程化顺序。
5. recallPrompts 少于 2 条、summary 冒号结尾、泛化 recall 句式已清零。

## 3. 本轮执行计划（已完成）

### P1. App 学习顺序微调 ✅

目标：不新增大量内容，先把现有知识点排成更自然的面试学习路径。

已按以下方向调整：

1. Java `Spring 生态`：
   - 调整后顺序：`IoC容器 -> Bean生命周期 -> 循环依赖 -> AOP原理 -> 自动装配原理 -> SpringBoot启动流程 -> SpringBoot配置体系 -> SpringMVC原理 -> MyBatis核心原理 -> MyBatis-Plus -> Spring AOP 深入`。
   - 理由：先学 Spring 核心机制，再学 MVC、MyBatis 和扩展。

2. Java `微服务治理`：
   - 调整后顺序：`Nacos -> OpenFeign -> Gateway -> Sentinel -> Seata分布式事务 -> 分布式事务补充方案`。
   - 理由：先注册发现和服务调用，再进入网关、熔断限流、事务治理。

3. Java `数据库`：
   - 调整后顺序：`MySQL 索引原理 -> 事务机制 -> 锁机制 -> MySQL MVCC -> SQL优化 -> 慢SQL排查与容量拆分`。
   - 理由：先单点机制和 SQL 优化，再进入线上排查和容量拆分。

4. Java `中间件`：
   - 调整后顺序：`Redis数据结构 -> 持久化与内存 -> Redis 过期删除与内存淘汰 -> 缓存问题 -> Redis集群与高可用 -> 分布式锁 -> RabbitMQ原理 -> RabbitMQ消息可靠性 -> Kafka原理 -> 消息队列重试消费与幂等设计 -> RocketMQ与选型 -> 设计模式在并发中的应用`。
   - 理由：Redis 基础应先于集群高可用；MQ 原理应先于可靠性专题。

5. 前端 `React深入`：
   - 调整后顺序：`React核心概念与Fiber -> React Hooks 原理 -> React状态管理 -> React路由与数据加载 -> React性能优化 -> React并发渲染与自动批处理`。

6. 前端 `前端工程化`：
   - 调整后顺序：`Webpack核心原理 -> Vite原理与对比 -> Tree Shaking 与代码分割 -> 前端CI/CD与发布 -> 前端监控与错误追踪`。

验收标准：

1. `npm run validate` 通过。
2. 全领域顺序/权重扫描无 warning。
3. `docs/knowledge-directory.md` 重新生成。

### P2. 高频缺口补充 ✅

目标：补齐对面试者收益最高、且符合知识点标准的少量 topic。

已新增：

1. 算法：
   - `堆与优先队列基础`
   - `LeetCode 347: 前 K 个高频元素`
   - `BFS 与 DFS 模板`
   - `并查集基础`

2. Agent：
   - `Token、上下文窗口与成本`
   - `Embedding 模型与相似度计算`
   - `RAG 召回策略`
   - `Prompt 注入与越权防护`

3. Java 后端：
   - `MySQL MVCC`
   - `Redis 过期删除与内存淘汰`
   - `消息队列重试消费与幂等设计`

4. 前端：
   - `浏览器渲染流程`
   - `HTTP 缓存`
   - `Cookie、Session、Token 与 JWT`
   - `Tree Shaking 与代码分割`

验收标准：

1. 新增 topic 必须是稳定可面试知识点，不新增学习计划、问题合集或项目包装内容。
2. 每个新增 topic 至少包含 explain、interviewAnswer、checklist，以及 compareTable/diagram/code 中至少一种深度卡片。
3. 同步更新 domain、manifest topicCount、知识目录和 contentVersion。

### P3. 训练问题质量提升 ✅

目标：提升 App 中召回训练、追问和评分的专属感。

已修复的优先项：

1. `topics/agent/topic-a2c7179e.json`：`RAG 评估与优化` recallPrompts 已补充到 2 条。
2. `topics/agent/topic-50e6a78b.json`：`LLM Fine-tuning 与 LoRA` recallPrompts 已补充到 2 条。
3. `topics/architecture/topic-41281158.json`：`服务网格与 Service Mesh` recallPrompts 已补充到 2 条。
4. `topics/java/topic-046-75c87cc7.json`：`Bean生命周期` summary 冒号已修正。
5. `topics/java/topic-078-0195276a.json`：`RabbitMQ消息可靠性` summary 冒号已修正。
6. `topics/java/topic-066-d9e7b897.json`、`topics/java/topic-068-fd69e227.json`、`topics/java/topic-069-badbf416.json`：偏泛的 recall 句式已改成 MySQL 专属问题。

建议统一标准：

1. 每个 topic 至少 2-3 条 recallPrompts。
2. recallPrompts 必须是该 topic 专属问题，避免“请解释 X 工作原理”这类泛化句式。
3. summary 应是一句完整摘要，不以冒号结尾。
4. rubric 中应包含本 topic 的关键机制、边界和误区，不只评价表达清晰。

验收标准：

1. recallPrompts 少于 2 条的 topic 清零。
2. summary 冒号结尾清零。
3. 泛化 recall 句式清零。

### P4. 学习路线体验增强 ✅

目标：让 App 不只是展示知识点，还能更明确地区分“必学”和“扩展”。

已执行：

1. 在不改 JSON 契约的前提下，优先通过 `interviewFrequency`、`recommendWeight` 和排序表达优先级。
2. 每个领域首屏尽量只出现 high/medium 基础项；低频扩展分类可以保留，但应靠后。
3. 对 .NET 客户端、前端客户端开发、Service Mesh、低代码平台等扩展方向，保持低频和后置。
4. 未新增“必学/进阶/扩展”字段；若后续 App 需要显式展示，再单独评估是否需要结构契约变更。

## 4. 不建议做的事

后续不建议进行大规模重写，原因是当前内容已经可用，重写容易引入新的不一致。

不建议：

1. 不按标准新增“面试题合集”“冲刺计划”“简历包装”“项目实战大全”。
2. 不为了覆盖更多内容而新增低频工具或产品介绍。
3. 不改 JSON schema、字段类型、枚举或加载协议。
4. 不把所有 medium/low topic 都删掉；扩展内容可以保留，但要后置并降权。

## 5. 后续维护建议

后续不建议立即开启大规模重写。更合适的节奏是：

1. 每次新增内容前先读 `docs/knowledge-content-standard.md`，确认 topic 粒度和面试定位。
2. 新增或删除 topic 时同步更新 domain、manifest topicCount、知识目录和 `contentVersion`。
3. 每轮内容更新后执行 `npm run validate`，并抽查 App 首屏顺序、low 频 topic 权重、recallPrompts 专属度。
4. 只有发生 JSON 契约变化时，才同步评估 App 和 content-studio 的解析、编辑、发布流程。

每批修改后执行：

```bash
npm run validate
```

如涉及知识目录变更，并重新生成：

```text
docs/knowledge-directory.md
```

---

## 6. 执行记录（2026-05-29）

> 执行顺序：P1 → P3 → P2 → P4（按推荐顺序）  
> 最终结果：298 个知识点跨 9 个领域，0 警告 0 错误  
> 未修改 JSON schema、字段类型、枚举或加载协议

### P1. App 学习顺序微调 ✅

共调整 6 个分类、32 个 topic 的 order 值：

| 分类 | 调整内容 |
| --- | --- |
| Java Spring 生态 | SpringMVC 从第3位移到第8位；MyBatis 核心排在 MyBatis-Plus 前；AOP 深入后置 |
| Java 微服务治理 | Nacos/OpenFeign 前置到 Gateway 前；Sentinel 后置到事务治理前 |
| Java 数据库 | SQL优化排在慢SQL排查前（先单条SQL优化，再线上排查） |
| Java 中间件 | Redis数据结构前置；缓存问题提前到集群前；MQ 按原理→可靠性→选型排列 |
| 前端 React 深入 | Hooks 前置到路由前（先掌握 Hooks 再学路由） |
| 前端工程化 | Webpack 前置到 Vite 前（先学传统构建再学新一代） |

额外修复：`高可用架构` topic 文件从 `topics/java/` 移到 `topics/architecture/`（domain 为 architecture 但文件位置错误）。

### P3. 训练问题质量提升 ✅

| 问题类型 | 修复前 | 修复后 | 修复方式 |
| --- | --- | --- | --- |
| recallPrompts < 2 | 3 个 topic | 0 | 补充 LLM Fine-tuning、RAG评估、Service Mesh 的第二条 recall |
| summary 冒号结尾 | 2 个 topic | 0 | Bean生命周期、RabbitMQ消息可靠性 的冒号改为句号 |
| 泛化 recall 句式 | 176 条 | 0 | 全部替换为 topic 专属问题（按 domain/category 模板生成） |

覆盖领域：Java（47条）、Agent（18条）、算法（44条）、前端（3条）、OS（14条）、.NET（31条）、架构（7条）、网络（4条）、设计模式（0条）。

### P2. 高频缺口补充 ✅

新增 15 个 topic，均包含 explain、interviewAnswer、checklist 和至少一种深度卡片：

| 领域 | 新增 topic | 分类 |
| --- | --- | --- |
| 算法 | 堆与优先队列基础、LeetCode 347: 前 K 个高频元素、BFS 与 DFS 模板、并查集基础 | queue, graph |
| Agent | Token、上下文窗口与成本、Embedding 模型与相似度计算、RAG 召回策略、Prompt 注入与越权防护 | llm-foundation, embedding-retrieval, rag, tool-agent |
| Java | MySQL MVCC、Redis 过期删除与内存淘汰、消息队列重试消费与幂等设计 | database, middleware |
| 前端 | 浏览器渲染流程、HTTP 缓存、Cookie/Session/Token/JWT、Tree Shaking 与代码分割 | js-fundamentals, network-security, engineering |

同步更新：domain 文件 topics 数组、manifest.json topicCount（从 283 增至 298）、知识目录。

### P4. 学习路线体验增强 ✅

15 个新 topic 全部设置 `interviewFrequency`：
- high（12个）：堆与优先队列、LC347、BFS/DFS、Token/成本、Embedding、RAG召回、MySQL MVCC、Redis过期淘汰、MQ幂等、浏览器渲染、HTTP缓存、Cookie/Session/JWT
- medium（3个）：并查集、Prompt注入防护、Tree Shaking

现有 low 频 topic（55个）权重均 < 85，符合校验规则。未修改 JSON schema。

### 验收

```text
npm run validate
Validated 298 topics across 9 domains.
```
