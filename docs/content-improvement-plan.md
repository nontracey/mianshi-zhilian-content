# 面试知识内容整改计划

> 生成日期：2026-05-29  
> 依据标准：`docs/knowledge-content-standard.md`  
> 目的：让后续 AI 或人工可以按本文件逐条整改 topic 内容，使内容库从“结构校验通过”提升到“语义质量符合标准”。

## 1. 总体评估结论

本次已对 `topics/` 下全部 287 个知识点进行结构和语义扫描。

结构层面：当前 `npm run validate` 通过，说明 schema、manifest、domain 引用、基础卡片类型、scoreWeights 合计等硬性契约目前达标。

语义层面：当前尚未完全达到《面试知识内容判断标准》。扫描发现 230 个 topic 至少命中一个整改项，主要问题是模板化追问、模板化 recall、Agent 早期内容中的“今日笔记/面试话术”残留，以及部分 rubric 不够专属。

整改不涉及 JSON 结构契约变更。后续 AI 只应修改现有字段内容，不新增必填字段、不改 schema、不改枚举、不改 topic/domain/manifest 加载协议。

## 2. 执行原则

每次整改前先阅读：

1. `docs/knowledge-content-standard.md`
2. 本整改计划
3. 待改 topic 所在领域已有 2 到 3 个高质量 topic

每次整改建议按领域或分类分批，不要一次性重写全部 230 个 topic。每批完成后必须运行：

```bash
npm run validate
```

每批还要额外扫描高风险词：

```bash
rg -n "今日笔记|面试话术|你遇到过什么问题|在实际项目中是怎么用的？有什么注意事项？|结合项目经验|能做对比|能说明取舍" topics
```

如果只是知识内容更新，且发布正式内容包，需要按发布流程更新 `manifest.json` 的 `contentVersion`。如果只是生成整改草案或暂不发布，可以先不改版本号。

## 3. 问题编号与整改动作

### P0_TODAY_NOTE

含义：topic 正文中出现“今日笔记”模板。

处理方式：

1. 删除整段“今日笔记”及填空线。
2. 如果其中有真正有价值的要点，把它们改写进 `checklist.items`。
3. 不要保留“日期”“今日重点掌握”“最深印象”等学习日志式内容。

验收标准：

1. 文件中不再出现 `今日笔记`。
2. 正文仍然能回答定义、原理、流程、场景、误区、面试回答。

### P0_INTERVIEW_TALK

含义：topic 中出现“面试话术”标签或包装式表达。

处理方式：

1. 将 `面试话术` 改为自然的知识点解释或 `interviewAnswer` 内容。
2. 删除虚构项目成绩、泛化项目包装，例如“在我们的项目中提升了 xx%”，除非它是严谨的通用示例且不伪装成真实经历。
3. 保留“面试回答模板”卡片可以，但内容必须是知识点专属回答。

验收标准：

1. 文件中不再出现 `面试话术`。
2. 面试回答第一段给结论，第二段讲原理，第三段讲场景、优缺点或坑。

### P0_GENERIC_FOLLOWUP

含义：`interviewAnswer.followUpQuestions` 中出现模板化问题，例如“在实际项目中使用 X 时，你遇到过什么问题？是怎么发现和解决的？”

处理方式：

1. 找到该 topic 的所有 `learningCards[].followUpQuestions`。
2. 删除泛项目追问。
3. 用 2 到 3 个专属追问替换，追问应落在机制、边界、对比、故障定位或方案权衡上。

改写模板：

```text
不要写：
在实际项目中使用 X 时，你遇到过什么问题？是怎么发现和解决的？

改成：
如果出现【当前知识点特有问题】，你会从哪些指标、日志或机制判断原因？
为什么【当前知识点核心机制】会导致【具体边界/坑】？
在【具体约束】下，X 和 Y 应该如何选择？为什么？
```

示例：

```text
观察者模式：
如果一个事件监听器抛异常，Spring 同步事件发布会发生什么？如何避免影响主流程？

ThreadLocal：
为什么线程池场景下 ThreadLocal 更容易发生内存泄漏？remove 应该放在哪里？

TCP 粘包拆包：
为什么 TCP 会粘包，而 UDP 通常不这么讨论？常见拆包协议怎么设计？
```

验收标准：

1. 文件中不再出现 `在实际项目中使用.*你遇到过什么问题`。
2. 每个追问都能对应正文中的具体知识点。

### P0_GENERIC_RECALL

含义：`recallPrompts` 中出现模板化问题，例如“在实际项目中是怎么用的？有什么注意事项？”

处理方式：

1. 每个 topic 至少保留 2 个 recallPrompts。
2. prompt 要模拟真实面试问题，不能只是泛泛复述“有什么注意事项”。
3. 高优先级 topic 建议有 3 个 recallPrompts：定义/流程题、机制追问题、边界/对比题。

改写模板：

```text
定义/流程：
请用 2 分钟讲清楚 X 的核心流程，并说明每一步解决什么问题。

机制追问：
为什么 X 需要 Y 这个机制？如果没有它会出现什么问题？

对比/边界：
X 和 Y 的核心区别是什么？分别适合什么场景？
```

验收标准：

1. 文件中不再出现 `在实际项目中是怎么用的？有什么注意事项？`。
2. recallPrompts 与 topic 难度一致。

### P1_GENERIC_RUBRIC

含义：rubric 中出现 `结合项目经验`、`能做对比`、`能说明取舍`、`面试表达清晰有条理，能回答追问` 等过泛条目。

处理方式：

1. `mustHave` 写当前知识点必须说出的定义、核心机制、关键流程。
2. `goodToHave` 写当前知识点的源码细节、边界条件、性能权衡或排查方法。
3. `commonMistakes` 写当前知识点特有误区。
4. 不要只写“结合项目经验”“能做对比”“能说明取舍”。

示例：

```text
不要写：
能做对比

改成：
能比较 RAG 与 Fine-tuning 在知识更新、可溯源性、延迟和成本上的差异。
```

验收标准：

1. rubric 每一项离开当前 topic 就不成立。
2. 没有泛化评价词充数。

### P1_AI_CROSS_DOMAIN_EXAMPLE

含义：Agent 领域中串入 Java/Spring/Redis 示例，例如 `Spring Boot自动装配`、`Redis缓存穿透`。

处理方式：

1. 如果只是样例数据，把它替换成 Agent/LLMOps/RAG 相关样例。
2. 如果内容已经偏离 topic，要重写该段。
3. Java 领域中的 Spring Boot 内容不一定是问题；本项重点处理 Agent 文件里的跨领域残留。

示例替换：

```text
Spring Boot自动装配的原理是什么？
改为：
RAG 检索结果与用户问题不匹配时，如何定位是召回问题还是生成问题？
```

### P2_FEW_CARDS

含义：learningCards 少于 5 张，或内容覆盖不充分。

处理方式：

1. 先判断 topic 是否应该保留为独立知识点。
2. 如果保留，补充缺失的 `compareTable`、`diagram`、`code` 或更具体的 `checklist`。
3. 如果内容过小或和其他 topic 重复，应合并或删除，而不是硬凑卡片。

### P2_TITLE_RISK

含义：标题或摘要含“综合、复习、场景题、话术、简历”等高风险词。

处理方式：

1. 判断它是否仍是稳定知识点。
2. 如果是算法领域的合法例外，标题应明确为算法模式或题型能力。
3. 如果不是稳定知识点，迁移到学习路径或补充文档，不进入 topic。

## 4. 推荐整改顺序

### 第一批：Agent 领域 P0 问题

优先修 Agent 领域，因为它同时命中 `P0_TODAY_NOTE`、`P0_INTERVIEW_TALK`、`P0_GENERIC_RECALL`、`P1_AI_CROSS_DOMAIN_EXAMPLE`，问题最集中。

处理顺序：

1. 删除所有“今日笔记”。
2. 删除或改写“面试话术”。
3. 替换 Agent 中的 Spring Boot/Redis 样例。
4. 重写 Agent 的泛 followUpQuestions 和 recallPrompts。
5. 重写 Agent 的泛 rubric。

### 第二批：Java 领域模板化 recall/rubric

Java 领域大量文件同时命中 `P0_GENERIC_FOLLOWUP`、`P0_GENERIC_RECALL`、`P1_GENERIC_RUBRIC`。建议按分类处理：

1. JVM
2. 并发
3. Java 基础
4. Spring
5. 数据库
6. 中间件

### 第三批：全领域泛 followUpQuestions

处理 architecture、design-pattern、dotnet、frontend、network、os 中的 `P0_GENERIC_FOLLOWUP`。

这批通常只需要替换 `interviewAnswer.followUpQuestions` 的第三个泛问题，不需要重写整篇 topic。

### 第四批：P2 内容充实与标题检查

处理少卡片和标题风险：

1. `topics/agent/topic-50e6a78b.json`
2. `topics/agent/topic-a2c7179e.json`
3. `topics/algorithm/topic-design-basics.json`
4. `topics/architecture/topic-41281158.json`
5. `topics/java/topic-1da2b5c3.json`

## 5. 每个 topic 的整改清单

下面列出所有命中问题的 topic。未列出的 topic 在本次自动语义扫描中未命中高风险项，但仍建议在批量发布前做人工抽样。

### agent

| 文件 | 标题 | 分类 | 问题 |
| --- | --- | --- | --- |
| `topics/agent/topic-087-81c07ef4.json` | Function Calling 与工具调用 | `tool-agent` | `P0_TODAY_NOTE`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/agent/topic-088-d8088d8c.json` | 向量数据库索引与检索 | `embedding-retrieval` | `P0_TODAY_NOTE`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/agent/topic-089-42584852.json` | RAG进阶 | `rag` | `P0_TODAY_NOTE`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/agent/topic-090-357bf78b.json` | Prompt Engineering | `llm-foundation` | `P0_TODAY_NOTE`<br>`P0_INTERVIEW_TALK`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/agent/topic-091-ee657ad3.json` | AI评估与观测 | `llmops` | `P0_TODAY_NOTE`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC`<br>`P1_AI_CROSS_DOMAIN_EXAMPLE` |
| `topics/agent/topic-093-de1a9ab0.json` | MCP协议深度 | `tool-agent` | `P0_TODAY_NOTE`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/agent/topic-094-e03e7524.json` | AI安全与合规 | `llmops` | `P0_TODAY_NOTE`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/agent/topic-104-b4f897e0.json` | 大模型训练流程：预训练、SFT、RLHF、DPO | `llm-foundation` | `P0_TODAY_NOTE`<br>`P0_INTERVIEW_TALK`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/agent/topic-106-bf5350b9.json` | RAG原理与实战 | `rag` | `P0_TODAY_NOTE`<br>`P0_INTERVIEW_TALK`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC`<br>`P1_AI_CROSS_DOMAIN_EXAMPLE` |
| `topics/agent/topic-107-9a15a561.json` | Agent架构与MCP | `tool-agent` | `P0_TODAY_NOTE`<br>`P0_INTERVIEW_TALK`<br>`P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/agent/topic-115-35c5dcec.json` | MCP协议基础 | `tool-agent` | `P0_GENERIC_FOLLOWUP` |
| `topics/agent/topic-116-13e5ca40.json` | Transformer与注意力机制 | `llm-foundation` | `P0_GENERIC_FOLLOWUP` |
| `topics/agent/topic-121-15a0b1b4.json` | 向量数据库核心能力对比 | `embedding-retrieval` | `P0_GENERIC_FOLLOWUP` |
| `topics/agent/topic-122-194b7dfa.json` | 文档分块策略 | `rag` | `P0_GENERIC_FOLLOWUP` |
| `topics/agent/topic-123-b51b29dc.json` | ReAct与Plan-and-Execute | `tool-agent` | `P0_GENERIC_FOLLOWUP` |
| `topics/agent/topic-124-6e95a1cd.json` | 多Agent协作模式 | `tool-agent` | `P0_GENERIC_FOLLOWUP` |
| `topics/agent/topic-125-30dc0c91.json` | Agent状态管理 | `tool-agent` | `P0_GENERIC_FOLLOWUP` |
| `topics/agent/topic-127-34123092.json` | 语义缓存与成本优化 | `llmops` | `P0_GENERIC_FOLLOWUP` |
| `topics/agent/topic-129-1907ae44.json` | 模型路由与降级方案 | `llmops` | `P0_GENERIC_FOLLOWUP` |
| `topics/agent/topic-50e6a78b.json` | LLM Fine-tuning 与 LoRA | `llmops` | `P0_GENERIC_FOLLOWUP`<br>`P2_FEW_CARDS` |
| `topics/agent/topic-a2c7179e.json` | RAG 评估与优化 | `rag` | `P0_GENERIC_FOLLOWUP`<br>`P2_FEW_CARDS` |
| `topics/agent/topic-inference-decoding.json` | 推理机制与解码参数 | `llm-foundation` | `P0_INTERVIEW_TALK` |

### algorithm

| 文件 | 标题 | 分类 | 问题 |
| --- | --- | --- | --- |
| `topics/algorithm/topic-design-basics.json` | 设计题基础 | `design` | `P2_FEW_CARDS`<br>`P2_TITLE_RISK` |

### architecture

| 文件 | 标题 | 分类 | 问题 |
| --- | --- | --- | --- |
| `topics/architecture/architecture.methodology.topic-cqrs.json` | CQRS架构 | `methodology` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.methodology.topic-ddd.json` | DDD领域驱动设计 | `methodology` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.methodology.topic-event-driven.json` | 事件驱动架构 | `methodology` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.methodology.topic-hexagonal.json` | 六边形架构 | `methodology` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.microservice.topic-distributed-id.json` | 分布式ID生成方案 | `microservice` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.microservice.topic-distributed-lock.json` | 分布式锁实现方案 | `microservice` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.microservice.topic-distributed-transaction.json` | 分布式事务方案选型 | `microservice` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.microservice.topic-rate-limiting.json` | 限流降级熔断策略 | `microservice` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.microservice.topic-service-governance.json` | 服务治理全景 | `microservice` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.microservice.topic-split-principles.json` | 微服务拆分原则 | `microservice` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.project-design.topic-api-gateway.json` | API网关设计 | `microservice` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.project-design.topic-low-code.json` | 低代码平台核心架构 | `project-design` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.project-design.topic-multi-tenant.json` | 多租户SaaS架构设计 | `project-design` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.system-design.topic-cache-architecture.json` | 缓存架构设计 | `system-design` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.system-design.topic-mq-architecture.json` | 消息队列架构设计 | `system-design` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.system-design.topic-read-write-split.json` | 读写分离与数据一致性 | `system-design` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.system-design.topic-seckill.json` | 秒杀系统设计 | `system-design` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/architecture.system-design.topic-sharding.json` | 大数据量分库分表方案 | `system-design` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/topic-334-cf3d865e.json` | 幂等性设计 | `microservice` | `P0_GENERIC_FOLLOWUP` |
| `topics/architecture/topic-41281158.json` | 服务网格与 Service Mesh | `microservice` | `P0_GENERIC_FOLLOWUP`<br>`P2_FEW_CARDS` |

### design-pattern

| 文件 | 标题 | 分类 | 问题 |
| --- | --- | --- | --- |
| `topics/design-pattern/topic-ce-lve-mo-shi.json` | 策略模式 | `behavioral` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-dai-li-mo-shi.json` | 代理模式 | `structural` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-dan-li-mo-shi.json` | 单例模式 | `creational` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-gong-chang-mo-shi.json` | 工厂模式 | `creational` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-guan-zhe-zhe-mo-shi.json` | 观察者模式 | `behavioral` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-jian-zao-zhe-mo-shi.json` | 建造者模式 | `creational` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-men-mian-mo-shi.json` | 门面模式 | `structural` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-mu-ban-fang-fa-mo-shi.json` | 模板方法模式 | `behavioral` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-shi-pei-qi-mo-shi.json` | 适配器模式 | `structural` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-solid-yuan-ze.json` | SOLID原则 | `principles` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-spring-she-ji-mo-shi.json` | 设计模式在Spring中的应用 | `principles` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-ze-ren-lian-mo-shi.json` | 责任链模式 | `behavioral` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-zhuang-shi-qi-mo-shi.json` | 装饰器模式 | `structural` | `P0_GENERIC_FOLLOWUP` |
| `topics/design-pattern/topic-zhuang-tai-mo-shi.json` | 状态模式 | `behavioral` | `P0_GENERIC_FOLLOWUP` |

### dotnet

| 文件 | 标题 | 分类 | 问题 |
| --- | --- | --- | --- |
| `topics/dotnet/advanced-design-patterns.json` | 设计模式在 .NET 中的应用 | `advanced` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/advanced-dotnet-vs-java.json` | .NET 与 Java 对比 | `advanced` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/advanced-performance-diagnostics.json` | 性能调优与诊断 | `advanced` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/aspnet-authentication-authorization.json` | 认证与授权 | `aspnet` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/aspnet-filters-pipeline.json` | 过滤器管道 | `aspnet` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/aspnet-performance-optimization.json` | ASP.NET 性能优化 | `aspnet` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/aspnet-signalr.json` | SignalR 实时通信 | `aspnet` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/aspnet-web-api-design.json` | Web API 设计 | `aspnet` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/client-architecture-patterns.json` | 客户端架构模式 | `client` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/client-avalonia.json` | Avalonia UI | `client` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/client-maui.json` | MAUI 跨平台 | `client` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/client-wpf-core.json` | WPF 核心原理 | `client` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/client-xaml-data-binding.json` | XAML 数据绑定 | `client` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/csharp-async-await.json` | async/await 异步编程 | `csharp` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/csharp-generics-variance.json` | 泛型与协变逆变 | `csharp` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/csharp-linq.json` | LINQ | `csharp` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/csharp-reflection-attributes.json` | 反射与特性 | `csharp` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/csharp-type-system.json` | C# 类型系统 | `csharp` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/dotnet-core-configuration-options.json` | 配置与选项模式 | `dotnet-core` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/dotnet-core-dependency-injection.json` | 依赖注入 | `dotnet-core` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/dotnet-core-logging-monitoring.json` | 日志与监控 | `dotnet-core` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/dotnet-core-middleware-pipeline.json` | 中间件管道 | `dotnet-core` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/dotnet-core-runtime-gc.json` | .NET 运行时与 GC | `dotnet-core` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/ef-core-basics.json` | EF Core 基础 | `ef-core` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/ef-core-multi-database-tenant.json` | 数据库兼容与多租户 | `ef-core` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/ef-core-performance-optimization.json` | EF Core 性能优化 | `ef-core` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/ef-core-repository-uow.json` | 仓储模式与工作单元 | `ef-core` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/microservice-communication.json` | 微服务通信 | `microservice-dotnet` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/microservice-containerization.json` | 容器化与部署 | `microservice-dotnet` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/microservice-grpc-protobuf.json` | gRPC 与 Protobuf | `microservice-dotnet` | `P0_GENERIC_FOLLOWUP` |
| `topics/dotnet/microservice-message-queue.json` | 消息队列集成 | `microservice-dotnet` | `P0_GENERIC_FOLLOWUP` |

### frontend

| 文件 | 标题 | 分类 | 问题 |
| --- | --- | --- | --- |
| `topics/frontend/topic-360-7595a4da.json` | 深拷贝与浅拷贝 | `js-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-607-5ceefc1c.json` | 手写Promise | `js-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-880-2802d4ed.json` | 防抖与节流 | `js-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-bff-fullstack.json` | BFF与全栈架构 | `frontend-architecture` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-box-model-bfc.json` | 盒模型与BFC | `css-layout` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-cicd-deploy.json` | 前端CI/CD与发布 | `engineering` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-closure-scope.json` | 闭包与作用域 | `js-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-cors-request.json` | 跨域与请求方案 | `network-security` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-cross-platform.json` | 跨平台方案对比 | `client-dev` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-data-types.json` | JS数据类型与类型判断 | `js-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-electron.json` | Electron开发 | `client-dev` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-event-loop.json` | Event Loop与异步 | `js-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-flex-grid.json` | Flex与Grid布局 | `css-layout` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-frontend-monitoring.json` | 前端监控与错误追踪 | `engineering` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-frontend-router.json` | 前端路由原理 | `frontend-architecture` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-http-https-tcp.json` | HTTP/HTTPS/TCP协议 | `network-security` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-koa-express.json` | Koa/Express框架原理 | `nodejs` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-micro-frontend.json` | 微前端架构 | `frontend-architecture` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-mobile-adapt.json` | 移动端适配与性能 | `client-dev` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-node-core.json` | Node.js核心概念 | `nodejs` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-node-engineering.json` | Node.js 进程管理与线上排查 | `nodejs` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-node-modules.json` | Node.js模块系统与包管理 | `nodejs` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-perf-optimization.json` | 前端性能优化全景 | `frontend-architecture` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-promise-async.json` | Promise与async/await | `js-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-prototype-chain.json` | 原型链与继承 | `js-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-react-core-fiber.json` | React核心概念与Fiber | `react` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-react-hooks.json` | React Hooks 原理 | `react` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-react-native.json` | React Native核心原理 | `client-dev` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-react-perf.json` | React性能优化 | `react` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-react-router.json` | React路由与数据加载 | `react` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-react-state-mgmt.json` | React状态管理 | `react` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-react18-features.json` | React 18+新特性 | `react` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-responsive-css-eng.json` | 响应式设计与CSS工程化 | `css-layout` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-security.json` | 前端安全防护 | `network-security` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-state-arch.json` | 前端状态管理架构 | `frontend-architecture` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-ts-basic-types.json` | TS基础类型与类型系统 | `typescript` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-ts-config.json` | TS与JS互操作与工程配置 | `typescript` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-ts-generics.json` | 泛型与工具类型 | `typescript` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-ts-type-gymnastics.json` | TypeScript 高级类型编程 | `typescript` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-vite-principle.json` | Vite原理与对比 | `engineering` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-vue-compiler-vdom.json` | Vue编译与虚拟DOM | `vue` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-vue-ecosystem.json` | Vue生态（Pinia/Vue Router） | `vue` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-vue-lifecycle-composition.json` | Vue生命周期与组合式API | `vue` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-vue-reactivity.json` | Vue响应式原理 | `vue` | `P0_GENERIC_FOLLOWUP` |
| `topics/frontend/topic-webpack-core.json` | Webpack核心原理 | `engineering` | `P0_GENERIC_FOLLOWUP` |

### java

| 文件 | 标题 | 分类 | 问题 |
| --- | --- | --- | --- |
| `topics/java/topic-001-ebcc71cb.json` | 运行时数据区概述 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-002-3bee1565.json` | 堆内存详解 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-003-d63af565.json` | 方法区与元空间 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-005-af0a37c3.json` | GC算法 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-006-e97a07bb.json` | GC Roots与引用类型 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-007-e93284f6.json` | 垃圾收集器 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-009-e1efbeeb.json` | 类加载机制 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-010-3574662f.json` | JVM参数与调优 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-011-c6bc7422.json` | 线上问题排查 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-013-cc70cb0e.json` | 并发理论基础 | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-014-880c2a03.json` | synchronized原理 | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-015-45bf8ebd.json` | volatile原理 | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-017-df4531b1.json` | AQS原理 | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-018-01ac6cc3.json` | ReentrantLock | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-019-a5a85fab.json` | 其他锁与并发工具 | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-021-d2222a23.json` | 线程池原理 | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-024-052a3c12.json` | ConcurrentHashMap | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-025-a8370d9d.json` | ThreadLocal | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-026-3990751f.json` | CompletableFuture | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-028-905d9b58.json` | HashMap原理 | `java-fundamentals` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-029-2b936689.json` | ArrayList与LinkedList | `java-fundamentals` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-030-e4f16979.json` | 其他集合 | `java-fundamentals` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-032-8b727f38.json` | 泛型 | `java-fundamentals` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-033-070d3ba1.json` | 反射与注解 | `jvm` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-034-f2553b47.json` | Java新特性 | `java-fundamentals` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-041-d2d1cd02.json` | 自动装配原理 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC`<br>`P1_AI_CROSS_DOMAIN_EXAMPLE` |
| `topics/java/topic-043-d09a2ea2.json` | IoC容器 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-044-d91e99aa.json` | AOP原理 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-046-75c87cc7.json` | Bean生命周期 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-047-7bfc4e55.json` | 循环依赖 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-049-4a9fa727.json` | SpringMVC原理 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-050-1ab02fab.json` | SpringBoot配置体系 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-052-976f7efa.json` | MyBatis核心原理 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-053-33741484.json` | MyBatis-Plus | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-055-e51532ee.json` | Nacos | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-058-72ff8a49.json` | OpenFeign | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-059-a4e73804.json` | Gateway | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-061-7a8c02dc.json` | Sentinel | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-062-ce26874b.json` | Seata分布式事务 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-064-e7bf33af.json` | 分布式事务补充方案 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-065-e2570d70.json` | MySQL 索引原理 | `database` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-066-d9e7b897.json` | 事务机制 | `database` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-068-fd69e227.json` | 锁机制 | `database` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-069-badbf416.json` | SQL优化 | `database` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-071-7bc711e7.json` | Redis数据结构 | `middleware` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-072-980339ce.json` | 持久化与内存 | `middleware` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-074-160f484e.json` | 高可用架构 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-075-fa1c9279.json` | 缓存问题 | `middleware` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-077-0f4a426f.json` | RabbitMQ原理 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-078-0195276a.json` | 可靠性与实战 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-080-3c934d6a.json` | Kafka原理 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-081-89b01558.json` | RocketMQ与选型 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-083-b2c3d4e5.json` | SpringBoot启动流程 | `spring` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-084-c3d4e5f6.json` | MySQL索引原理 | `database` | `P0_GENERIC_FOLLOWUP`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-085-d4e5f6a7.json` | MySQL事务与MVCC | `database` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-086-e5f6a7b8.json` | MySQL锁机制 | `database` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-087-f6a7b8c9.json` | MySQL慢SQL优化与分库分表 | `database` | `P0_GENERIC_FOLLOWUP`<br>`P1_GENERIC_RUBRIC` |
| `topics/java/topic-089-b8c9d0e1.json` | Redis集群与高可用 | `middleware` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-090-c9d0e1f2.json` | 分布式锁(Redis/Zookeeper) | `middleware` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-093-f2a3b4c5.json` | 设计模式在并发中的应用 | `middleware` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-1da2b5c3.json` | Spring AOP 深入 | `spring` | `P0_GENERIC_FOLLOWUP`<br>`P2_FEW_CARDS` |
| `topics/java/topic-lambda.json` | Lambda 表达式与函数式接口 | `java-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-new-datetime.json` | 新日期时间 API | `java-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-optional.json` | Optional 类使用 | `java-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-pattern-matching.json` | Pattern Matching（Java 17+） | `java-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-record.json` | Record 类（Java 14+） | `java-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-sealed-classes.json` | Sealed Classes（Java 17+） | `java-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-stream-api.json` | Stream API 详解 | `java-fundamentals` | `P0_GENERIC_FOLLOWUP` |
| `topics/java/topic-virtual-threads.json` | Virtual Threads（Java 21+） | `concurrency` | `P0_GENERIC_FOLLOWUP`<br>`P0_GENERIC_RECALL` |

### network

| 文件 | 标题 | 分类 | 问题 |
| --- | --- | --- | --- |
| `topics/network/topic-cdn.json` | CDN 原理与应用 | `dns-cdn` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-cors.json` | 跨域与 CORS | `http-https` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-dns.json` | DNS 解析流程 | `dns-cdn` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-http-evolution.json` | HTTP 1.0/1.1/2.0/3.0 演进 | `http-https` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-http-status-headers.json` | HTTP 状态码与头部字段 | `http-https` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-https.json` | HTTPS 加密原理 | `http-https` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-tcp-flow-congestion.json` | TCP 流量控制与拥塞控制 | `tcp-udp` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-tcp-handshake.json` | TCP 三次握手与四次挥手 | `tcp-udp` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-tcp-reliable.json` | TCP 可靠传输机制 | `tcp-udp` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-tcp-sticky-packet.json` | TCP 粘包与拆包 | `tcp-udp` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-tcp-vs-udp.json` | TCP 与 UDP 的区别 | `tcp-udp` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-websocket-vs-polling.json` | WebSocket 与长轮询对比 | `websocket` | `P0_GENERIC_FOLLOWUP` |
| `topics/network/topic-websocket.json` | WebSocket 协议原理 | `websocket` | `P0_GENERIC_FOLLOWUP` |

### os

| 文件 | 标题 | 分类 | 问题 |
| --- | --- | --- | --- |
| `topics/os/topic-coroutine.json` | 协程与纤程 | `process-thread` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-deadlock.json` | 死锁的产生与避免 | `process-thread` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-file-permissions.json` | 文件权限与用户管理 | `linux-basics` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-io-models.json` | 阻塞/非阻塞/同步/异步 | `io-model` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-ipc.json` | 进程间通信方式 | `process-thread` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-linux-commands.json` | 常用命令 | `linux-basics` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-memory-leak.json` | 内存泄漏与溢出 | `memory-management` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-page-replacement.json` | 页面置换算法 | `memory-management` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-paging-segmentation.json` | 内存分页与分段 | `memory-management` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-process-management.json` | 进程管理与监控 | `linux-basics` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-process-vs-thread.json` | 进程与线程的区别 | `process-thread` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-reactor.json` | Reactor 模式 | `io-model` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-select-poll-epoll.json` | select/poll/epoll | `io-model` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-thread-sync.json` | 线程同步机制 | `process-thread` | `P0_GENERIC_FOLLOWUP` |
| `topics/os/topic-virtual-memory.json` | 虚拟内存原理 | `memory-management` | `P0_GENERIC_FOLLOWUP` |

## 6. 自动化校验补强建议

当前 `scripts/validate_content.mjs` 能保证结构正确，但不能阻止模板化语义问题再次进入。建议在完成第一轮整改后，把以下规则加入校验脚本：

1. `今日笔记`：直接失败。
2. `面试话术`：直接失败。
3. `在实际项目中使用.*你遇到过什么问题`：直接失败。
4. `在实际项目中是怎么用的？有什么注意事项？`：直接失败。
5. `结合项目经验|能做对比|能说明取舍`：先警告，整改完成后改为失败。

加入校验后运行：

```bash
npm run validate
rg -n "今日笔记|面试话术|你遇到过什么问题|在实际项目中是怎么用的？有什么注意事项？" topics
```

最终验收时，以上 `rg` 不应再命中 topic 文件。

## 7. 单个 topic 整改模板

后续 AI 可以按这个模板逐个处理：

```text
任务：整改 <topic 文件路径>

1. 阅读 docs/knowledge-content-standard.md 和 docs/content-improvement-plan.md。
2. 打开 topic 文件，确认标题、domain、category、difficulty、interviewFrequency、recommendWeight 是否合理。
3. 按清单处理该文件命中的问题编号。
4. 不改 JSON 结构，不新增 schema 字段，不改 id/domain/category。
5. 对 followUpQuestions：
   - 删除泛项目问题。
   - 改为 2 到 3 个当前 topic 专属追问。
   - answer 必须具体，不能写“看情况”“结合项目”。
6. 对 recallPrompts：
   - 改成真实面试问题。
   - 至少覆盖定义/流程、机制追问、对比或边界中的两个。
7. 对 rubric：
   - mustHave 写定义、机制、流程。
   - goodToHave 写源码、边界、性能、排查。
   - commonMistakes 写当前 topic 特有误区。
8. 运行 npm run validate。
9. 运行高风险词 rg。
10. 汇报改了哪些 topic、还剩哪些问题。
```
