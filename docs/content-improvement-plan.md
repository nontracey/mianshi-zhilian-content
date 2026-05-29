# 面试知识内容更新计划

> 更新日期：2026-05-29  
> 依据标准：`docs/knowledge-content-standard.md`  
> 当前结论：现有内容已达到可发布基线，但仍建议开展一轮“小范围统一增强”，提升面试者从 0 到 1 备考的完整性和学习顺序体验。  

## 1. 总体判断

当前 `topics/` 下 283 个知识点已经通过结构校验：

```text
npm run validate
Validated 283 topics across 9 domains.
```

从标准角度看，现有内容满足以下基线：

1. 领域、分类、知识点结构完整，App 可按 `manifest -> domain -> category -> topic` 正常展示。
2. 大部分高频基础知识已经覆盖，且没有明显的阶段计划、面试话术、简历包装、项目合集等不合格 topic。
3. Agent、OS、Network、算法等领域的主线顺序已经基本符合“先基础，再机制，再扩展”。
4. 上一轮发现的 Spring/MQ 串题、泛标题、RAG 工具清单化、Agent/OS/Network 顺序问题已经修复。

但从真实面试者使用体验看，仍有必要制定下一阶段内容更新计划。原因不是“当前不达标”，而是：

1. 部分领域的分类内顺序仍可以更贴近备考路径。
2. 少数 topic 的 recallPrompts、summary、rubric 仍有模板化或不够专属的问题。
3. 若目标是覆盖中高级后端、前端、算法面试，少量高频知识点仍有补充空间。
4. 现在的知识目录适合总览，但还可以进一步优化成“优先学什么、哪些是扩展”的学习体验。

因此本计划定位为“内容增强计划”，不是“阻塞发布的整改计划”。

## 2. 是否满足面试者需要

### 2.1 已满足的部分

对准备 Java 后端、前端、Agent、算法、OS、网络、架构、.NET 的用户，当前内容已经能提供：

1. 基础八股主线：Java 集合、JVM、并发、Spring、MySQL、Redis/MQ、网络、OS、算法。
2. 框架原理主线：Spring、React、Vue、Node.js、ASP.NET Core、EF Core。
3. 工程与架构主线：微服务、缓存、消息队列、分布式事务、限流熔断、系统设计。
4. Agent 新方向主线：大模型基础、Embedding/RAG、工具调用、Agent 架构、LLMOps。
5. App 总览：`docs/knowledge-directory.md` 已按展示顺序列出领域、分类和知识点。

### 2.2 仍需增强的部分

当前内容更像“合格的知识库 v1”，还不是“非常顺手的面试备考路线 v2”。主要差距在：

1. Java 部分分类内部还有少数顺序不够自然，例如 MyBatis-Plus 在 MyBatis 核心前、Redis 集群在 Redis 数据结构前。
2. 算法覆盖了主流题型，但队列、堆/优先队列、并查集、BFS/DFS 模板等面试高频点还可以补齐。
3. Agent 覆盖了主线，但 Token/上下文窗口、Embedding 基础、向量相似度、RAG 召回策略等可以拆得更适合新手。
4. 前端低频扩展内容不少，但核心路线还可以微调，例如 React Hooks 应更靠前，工程化可先 Webpack 再 Vite。
5. 少数 topic 的问题设计还不够专属，会影响 App 中 recall/训练的质量。

## 3. 下一阶段更新计划

### P1. App 学习顺序微调

目标：不新增大量内容，先把现有知识点排成更自然的面试学习路径。

建议调整：

1. Java `Spring 生态`：
   - 建议顺序：`IoC容器 -> Bean生命周期 -> 循环依赖 -> AOP原理 -> 自动装配原理 -> SpringBoot启动流程 -> SpringBoot配置体系 -> SpringMVC原理 -> MyBatis核心原理 -> MyBatis-Plus -> Spring AOP 深入`。
   - 理由：先学 Spring 核心机制，再学 MVC、MyBatis 和扩展。

2. Java `微服务治理`：
   - 建议顺序：`Nacos -> OpenFeign -> Gateway -> Sentinel -> Seata分布式事务 -> 分布式事务补充方案`。
   - 理由：先注册发现和服务调用，再进入网关、熔断限流、事务治理。

3. Java `数据库`：
   - 建议顺序：`MySQL 索引原理 -> 事务机制 -> 锁机制 -> SQL优化 -> 慢SQL排查与容量拆分`。
   - 理由：先单点机制和 SQL 优化，再进入线上排查和容量拆分。

4. Java `中间件`：
   - 建议顺序：`Redis数据结构 -> 持久化与内存 -> 缓存问题 -> Redis集群与高可用 -> 分布式锁 -> RabbitMQ原理 -> RabbitMQ消息可靠性 -> Kafka原理 -> RocketMQ与选型 -> 设计模式在并发中的应用`。
   - 理由：Redis 基础应先于集群高可用；MQ 原理应先于可靠性专题。

5. 前端 `React深入`：
   - 建议顺序：`React核心概念与Fiber -> React Hooks 原理 -> React状态管理 -> React路由与数据加载 -> React性能优化 -> React并发渲染与自动批处理`。

6. 前端 `前端工程化`：
   - 建议顺序：`Webpack核心原理 -> Vite原理与对比 -> 前端CI/CD与发布 -> 前端监控与错误追踪`。

验收标准：

1. `npm run validate` 通过。
2. 全领域顺序/权重扫描无 warning。
3. `docs/knowledge-directory.md` 重新生成。

### P2. 高频缺口补充

目标：补齐对面试者收益最高、且符合知识点标准的少量 topic。

建议新增或拆分：

1. 算法：
   - `堆与优先队列基础`
   - `LeetCode 347: 前 K 个高频元素`
   - `BFS 与 DFS 模板`
   - `并查集基础`
   - `LeetCode 200: 岛屿数量` 可确认是否补充并查集/BFS/DFS多解法边界。

2. Agent：
   - `Token、上下文窗口与成本`
   - `Embedding 模型与相似度计算`
   - `RAG 召回策略`
   - `Prompt 注入与越权防护` 如当前 AI 安全内容过宽，可拆出安全高频专题。

3. Java 后端：
   - `MySQL MVCC` 如 `事务机制` 中已经讲得很完整，可不拆；否则建议拆成独立高频 topic。
   - `Redis 过期删除与内存淘汰` 如当前 `持久化与内存` 覆盖不充分，建议拆出。
   - `消息队列重复消费与幂等设计` 如 RabbitMQ 可靠性中已经覆盖，可保留不拆。

4. 前端：
   - `浏览器渲染流程`
   - `HTTP 缓存`
   - `Cookie、Session、Token 与 JWT`
   - `Tree Shaking 与代码分割`

验收标准：

1. 新增 topic 必须是稳定可面试知识点，不新增学习计划、问题合集或项目包装内容。
2. 每个新增 topic 至少包含 explain、interviewAnswer、checklist，以及 compareTable/diagram/code 中至少一种深度卡片。
3. 同步更新 domain、manifest topicCount、知识目录和 contentVersion。

### P3. 训练问题质量提升

目标：提升 App 中召回训练、追问和评分的专属感。

当前扫描发现的优先项：

1. `topics/agent/topic-a2c7179e.json`：`RAG 评估与优化` recallPrompts 只有 1 条。
2. `topics/agent/topic-50e6a78b.json`：`LLM Fine-tuning 与 LoRA` recallPrompts 只有 1 条。
3. `topics/architecture/topic-41281158.json`：`服务网格与 Service Mesh` recallPrompts 只有 1 条。
4. `topics/java/topic-046-75c87cc7.json`：`Bean生命周期` summary 以冒号结尾，适合作为正文句子修正。
5. `topics/java/topic-078-0195276a.json`：`RabbitMQ消息可靠性` summary 以冒号结尾，适合作为正文句子修正。
6. `topics/java/topic-066-d9e7b897.json`、`topics/java/topic-068-fd69e227.json`、`topics/java/topic-069-badbf416.json`：仍存在偏泛的 `EXPLAIN或其他工具验证` 召回句式，需要改成 MySQL 专属问题。

建议统一标准：

1. 每个 topic 至少 2-3 条 recallPrompts。
2. recallPrompts 必须是该 topic 专属问题，避免“请解释 X 工作原理”这类泛化句式。
3. summary 应是一句完整摘要，不以冒号结尾。
4. rubric 中应包含本 topic 的关键机制、边界和误区，不只评价表达清晰。

验收标准：

1. recallPrompts 少于 2 条的 topic 清零。
2. summary 冒号结尾清零。
3. 泛化 recall 句式清零。

### P4. 学习路线体验增强

目标：让 App 不只是展示知识点，还能更明确地区分“必学”和“扩展”。

建议：

1. 在不改 JSON 契约的前提下，优先通过 `interviewFrequency`、`recommendWeight` 和排序表达优先级。
2. 每个领域首屏尽量只出现 high/medium 基础项；低频扩展分类可以保留，但应靠后。
3. 对 .NET 客户端、前端客户端开发、Service Mesh、低代码平台等扩展方向，保持低频和后置。
4. 若后续 App 需要显式展示“必学/进阶/扩展”，再单独评估是否需要结构契约变更；当前不建议改 schema。

## 4. 不建议做的事

下一阶段不建议进行大规模重写，原因是当前内容已经可用，重写容易引入新的不一致。

不建议：

1. 不按标准新增“面试题合集”“冲刺计划”“简历包装”“项目实战大全”。
2. 不为了覆盖更多内容而新增低频工具或产品介绍。
3. 不改 JSON schema、字段类型、枚举或加载协议。
4. 不把所有 medium/low topic 都删掉；扩展内容可以保留，但要后置并降权。

## 5. 推荐执行顺序

1. 先做 P1：调整现有 topic 顺序，收益高、风险低。
2. 再做 P3：修 recallPrompts、summary、rubric 的小质量问题。
3. 再做 P2：少量新增高频缺口 topic。
4. 最后做 P4：复查 App 首屏、知识目录和学习路径。

每批修改后执行：

```bash
npm run validate
```

并重新生成：

```text
docs/knowledge-directory.md
```
