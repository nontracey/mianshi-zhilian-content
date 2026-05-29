# 面试知识内容剩余整改计划

> 更新日期：2026-05-29  
> 依据标准：`docs/knowledge-content-standard.md`  
> 当前状态：根据本轮代码调整后的仓库重新复检，仅保留当前仍需要处理的问题。  

## 1. 当前结论

已重新检查 `topics/` 下 283 个知识点。

结构层面：`npm run validate` 通过，schema、manifest、domain 引用、基础卡片类型、scoreWeights 等硬性契约达标。校验脚本已包含同分类重复 `order`、列表顺序与 `order` 冲突、low 频高权重、high 频低权重等顺序/权重 warning 检查；本轮未输出顺序与权重警告。

语义层面：上一版计划中的多项整改已经完成，包括 Java 基础排序、`Java新特性` 合集移除、`其他集合` 改名与串题修复、算法 order 规范化、前端和 .NET 多个低频扩展降权、设计模式 Spring 应用降权、标准与校验脚本补强。当前剩余问题集中在：

1. Agent 领域部分分类内学习顺序仍不符合从基础到高级。
2. OS 与 Network 领域仍有若干基础 topic 排在机制细节之后。
3. 少数标题仍偏泛或偏“实战/全景”，需要聚焦成稳定知识点。
4. Java `可靠性与实战` 明显混入 Spring 模板追问和 rubric，标题也不清晰。
5. Java Spring 分类仍混入高可用、Gateway、Nacos、OpenFeign、Sentinel、Seata、MQ 等中间件/微服务内容，分类边界不清。
6. Java 数据库分类中 `SQL优化` 与 `MySQL慢SQL优化与分库分表` 边界重叠。
7. 多个 Java/Spring/MQ topic 仍存在泛化的 Spring Boot 排查模板，虽然不违反 schema，但不符合“专属面试内容”标准。
8. RAG 内容过于偏工具堆叠和实战框架示例，需要收敛为更稳定的原理 topic。

本轮整改仍属于知识内容更新，不涉及 JSON 结构契约变更。不要改 schema、字段类型、枚举或加载协议。

## 2. 本轮确认已修复项

以下上一版计划中的问题在当前仓库已完成或未再命中，后续只需防止回流：

1. `npm run validate` 通过，当前为 283 个 topic。
2. `Java新特性` 合集 topic 已不在 `topics/java/` 和 `domains/java.json` 中。
3. Java 基础与集合已调整为 `HashMap原理 -> ArrayList与LinkedList -> Set、TreeMap 与 Queue 集合 -> 泛型 -> Lambda/Stream/Optional/...`。
4. `其他集合` 已改为 `Set、TreeMap 与 Queue 集合`，并发类 recallPrompts 未再作为首要问题命中。
5. 算法各分类已基本调整为基础 topic 在前，LeetCode 题随后，未再出现 `order=0` 挤占基础内容。
6. 前端低频扩展权重已明显下降，`HTTP/HTTPS/TCP协议` 降到 low/65，`React Native核心原理` 降到 low/60，`微前端架构` 降到 low/65。
7. .NET 客户端内容已降权并后置，`.NET 与 Java 对比` 已降为 low/60。
8. `设计模式在Spring中的应用` 已降为 low/70，并放在 SOLID 之后。
9. `docs/knowledge-content-standard.md` 已补充 App 展示顺序验收和全域顺序/权重扫描要求。
10. `scripts/validate_content.mjs` 已加入顺序与权重 warning 检查。
11. 高风险模板词扫描未再命中 `今日笔记`、`面试话术`、`你遇到过什么问题`、`结合项目经验`、`能做对比`、`能说明取舍` 等旧问题。

## 3. 剩余整改清单

### A. Agent 领域分类内顺序仍需重排

涉及文件：

1. `domains/agent.json`
2. `topics/agent/topic-121-15a0b1b4.json`：向量数据库核心能力对比
3. `topics/agent/topic-088-d8088d8c.json`：向量数据库索引与检索
4. `topics/agent/topic-087-81c07ef4.json`：Function Calling 与工具调用
5. `topics/agent/topic-115-35c5dcec.json`：MCP协议基础
6. `topics/agent/topic-093-de1a9ab0.json`：MCP协议深度
7. `topics/agent/topic-107-9a15a561.json`：Agent架构与MCP
8. `topics/agent/topic-125-30dc0c91.json`：Agent状态管理
9. `topics/agent/topic-124-6e95a1cd.json`：多Agent协作模式

当前问题：

1. `Embedding 与向量检索` 分类中，`向量数据库核心能力对比(order=40)` 排在 `向量数据库索引与检索(order=50)` 前面。但从学习路径看，应先掌握索引与检索机制，再看数据库能力对比。
2. `工具调用与 Agent 架构` 分类中，`Function Calling 与工具调用` 是 high/90 的基础 topic，却排在 MCP、ReAct、Agent 状态、多 Agent 之后。
3. `MCP协议基础`、`MCP协议深度` 可以保留，但不应先于 Function Calling 成为工具调用分类的入口。

整改方式：

1. 将 `Function Calling 与工具调用` 放到工具调用分类首位，`order` 建议调整为 10。
2. 建议顺序：`Function Calling 与工具调用 -> ReAct与Plan-and-Execute -> MCP协议基础 -> MCP协议深度 -> Agent架构与MCP -> Agent状态管理 -> 多Agent协作模式`。
3. 将 `向量数据库索引与检索` 放在 `向量数据库核心能力对比` 前。
4. 同步调整 `domains/agent.json` topic 列表顺序与各 topic `order`。

验收标准：

1. Agent 用户首屏先看到工具调用基础，而不是 MCP/多 Agent 扩展。
2. 同分类列表顺序与 `order` 一致。
3. `npm run validate` 不输出顺序 warning。

### B. OS 与 Network 基础顺序仍不符合学习路径

涉及文件：

1. `domains/os.json`
2. `domains/network.json`
3. `topics/os/topic-process-vs-thread.json`
4. `topics/os/topic-io-models.json`
5. `topics/network/topic-tcp-vs-udp.json`
6. `topics/network/topic-http-evolution.json`
7. `topics/network/topic-dns.json`
8. `topics/network/topic-websocket.json`

当前问题：

1. OS `进程与线程` 分类中，`进程与线程的区别` 是 high/99，但排在 IPC、线程同步、死锁、协程之后。
2. OS `IO 模型` 分类中，`阻塞/非阻塞/同步/异步` 是 high/96 的基础概念，却排在 `select/poll/epoll` 和 `Reactor` 之后。
3. Network `TCP 与 UDP 的区别` 是 TCP/UDP 分类的入门高频题，却排在分类最后。
4. Network `HTTP 1.0/1.1/2.0/3.0 演进` 是 high/88，当前排在 HTTPS、状态码、CORS 之后；对新手更适合作为 HTTP 分类入口。
5. `DNS解析流程` 应在 `CDN原理` 前，`WebSocket协议原理` 应在 `WebSocket与长轮询对比` 前。

整改方式：

1. OS 建议顺序：
   - 进程线程：`进程与线程的区别 -> 线程同步机制 -> 死锁的产生与避免 -> 进程间通信方式 -> 协程与纤程`
   - IO 模型：`阻塞/非阻塞/同步/异步 -> select/poll/epoll -> Reactor 模式`
2. Network 建议顺序：
   - TCP/UDP：`TCP 与 UDP 的区别 -> TCP 三次握手与四次挥手 -> TCP 可靠传输机制 -> TCP 流量控制与拥塞控制 -> TCP 粘包与拆包`
   - HTTP/HTTPS：`HTTP 版本演进 -> HTTP 状态码与头部字段 -> HTTPS 加密原理 -> 跨域与 CORS`
   - DNS/CDN：`DNS 解析流程 -> CDN 原理与应用`
   - WebSocket：`WebSocket 协议原理 -> WebSocket 与长轮询对比`
3. 同步更新 topic `order`，保持 domain 列表顺序一致。

验收标准：

1. OS/Network 首屏符合“先基础概念、再机制细节”的备考路径。
2. 高频基础 topic 不再排在低频或进阶 topic 之后。

### C. Java `可靠性与实战` 标题和内容定位错误

涉及文件：

1. `topics/java/topic-078-0195276a.json`
2. `domains/java.json`

当前问题：

1. 标题 `可靠性与实战` 过泛，无法看出知识点边界。
2. 内容实际主要讲 RabbitMQ 消息可靠性、幂等性、顺序性和死信队列，更适合命名为 `RabbitMQ 消息可靠性` 或 `消息队列可靠性投递`。
3. `followUpQuestions`、`recallPrompts`、`rubric` 明显混入 Spring 模板，例如“Spring源码”“AbstractApplicationContext.refresh()”“Bean 创建失败、注入失败”等，与 RabbitMQ 可靠性无关。
4. `interviewerFocus` 仍写成 Spring 框架源码理解，与当前内容不匹配。

整改方式：

1. 将标题改为 `RabbitMQ 消息可靠性` 或 `消息队列可靠性投递`。
2. 如保留在 Java 领域，应移入中间件/MQ 分类，不应留在 `spring` 分类。
3. 删除所有 Spring 源码、Bean、AOP、IoC 模板追问。
4. recallPrompts 改为消息队列专属问题：
   - `RabbitMQ 如何从生产端、Broker、消费端三个环节保证消息不丢？`
   - `消息重复消费的原因是什么？如何设计幂等消费？`
   - `RabbitMQ 如何处理顺序消息、死信队列和消息积压？`
5. rubric 改为消息可靠性专属评分标准。

验收标准：

1. 标题、category、summary、recallPrompts、rubric 均指向同一知识点。
2. `rg -n "可靠性与|AbstractApplicationContext|Bean 创建失败|Spring源码" topics/java/topic-078-0195276a.json` 不再命中无关内容。

### D. Java Spring 分类仍混入微服务与中间件内容

涉及文件：

1. `domains/java.json`
2. `topics/java/topic-074-160f484e.json`：高可用架构
3. `topics/java/topic-059-a4e73804.json`：Gateway
4. `topics/java/topic-055-e51532ee.json`：Nacos
5. `topics/java/topic-058-72ff8a49.json`：OpenFeign
6. `topics/java/topic-061-7a8c02dc.json`：Sentinel
7. `topics/java/topic-062-ce26874b.json`：Seata分布式事务
8. `topics/java/topic-077-0f4a426f.json`：RabbitMQ原理
9. `topics/java/topic-080-3c934d6a.json`：Kafka原理
10. `topics/java/topic-081-89b01558.json`：RocketMQ与选型

当前问题：

`Spring 生态` 分类当前首屏包含 `高可用架构`、`Gateway`、`Nacos`、`OpenFeign`、`Sentinel`、`Seata`、`RabbitMQ/Kafka/RocketMQ` 等微服务治理和 MQ 内容。它们并非 Spring 核心机制，会让用户在学完 IoC/Bean 生命周期之前跳到 Spring Cloud 和消息队列。

整改方式：

1. `Spring 生态` 收敛为 Spring / Spring Boot / Spring MVC / MyBatis 核心：
   - IoC容器
   - Bean生命周期
   - 循环依赖
   - AOP原理
   - 自动装配原理
   - SpringBoot启动流程
   - SpringBoot配置体系
   - SpringMVC原理
   - MyBatis核心原理
   - MyBatis-Plus（如保留，放在 MyBatis 之后）
2. 将 Gateway、Nacos、OpenFeign、Sentinel、Seata 移入微服务治理或 Spring Cloud 分类。
3. 将 RabbitMQ、Kafka、RocketMQ 及消息可靠性内容移入中间件或 MQ 分类。
4. `高可用架构` 如果是通用架构题，应迁移到 architecture 领域或改成明确的 Java 中间件知识点。

验收标准：

1. `Spring 生态` 首屏不再出现 MQ、注册中心、网关、熔断限流、分布式事务。
2. 每个分类的标题与 topic 内容一致。
3. 用户学习 Spring 分类时路径稳定为框架核心机制，而不是微服务组件清单。

### E. Java 数据库分类仍有边界重叠

涉及文件：

1. `domains/java.json`
2. `topics/java/topic-087-f6a7b8c9.json`：MySQL慢SQL优化与分库分表
3. `topics/java/topic-069-badbf416.json`：SQL优化

当前问题：

粗略重复扫描仍命中 `MySQL慢SQL优化与分库分表` 与 `SQL优化`。二者都涉及 EXPLAIN、慢查询、索引、分页优化等内容，当前边界容易重叠。

整改方式：

1. 对两份内容做语义对比。
2. 如果高度重复，保留更完整的一个，另一个合并或删除。
3. 如果都保留，必须明确边界：
   - `SQL优化` 聚焦单条 SQL、执行计划、索引失效、分页优化。
   - `MySQL慢SQL优化与分库分表` 改为 `慢 SQL 排查与容量拆分`，聚焦线上排查链路、容量阈值、分库分表方案和副作用。
4. 调整 summary、recallPrompts、rubric，避免同一问题在两个 topic 中重复训练。

验收标准：

1. 同一分类下没有标题近似、内容重复的 topic。
2. 每个保留 topic 都能说清独立边界和至少 3 个专属面试问题。

### F. 仍有泛化 Spring Boot 排查模板残留

涉及文件：

1. `topics/java/topic-044-d91e99aa.json`
2. `topics/java/topic-046-75c87cc7.json`
3. `topics/java/topic-049-4a9fa727.json`
4. `topics/java/topic-052-976f7efa.json`
5. `topics/java/topic-053-33741484.json`
6. `topics/java/topic-055-e51532ee.json`
7. `topics/java/topic-058-72ff8a49.json`
8. `topics/java/topic-059-a4e73804.json`
9. `topics/java/topic-061-7a8c02dc.json`
10. `topics/java/topic-062-ce26874b.json`
11. `topics/java/topic-064-e7bf33af.json`
12. `topics/java/topic-074-160f484e.json`
13. `topics/java/topic-077-0f4a426f.json`
14. `topics/java/topic-080-3c934d6a.json`
15. `topics/java/topic-081-89b01558.json`
16. `topics/java/topic-083-b2c3d4e5.json`
17. `topics/java/topic-1da2b5c3.json`
18. `topics/java/topic-041-d2d1cd02.json`
19. `topics/java/topic-043-d09a2ea2.json`
20. `topics/java/topic-047-7bfc4e55.json`
21. `topics/java/topic-050-1ab02fab.json`
22. `topics/java/topic-065-e2570d70.json`
23. `topics/java/topic-071-7bc711e7.json`
24. `topics/java/topic-075-fa1c9279.json`

当前问题：

扫描 `Spring Boot 的 debug 日志和 Actuator 端点能提供很大帮助`、`AbstractApplicationContext`、`Spring源码` 等表达，命中多个 Java/Spring/MQ/微服务/数据库/缓存 topic。部分 Spring 核心 topic 可以提及 Spring Boot 或源码入口，但当前句式高度模板化，且在 Kafka、RabbitMQ、Redis、MySQL、缓存问题、Nacos、Sentinel、Seata 等 topic 中会造成“所有知识点都要回答 Spring 源码、Bean 定义、循环依赖、Profile”的错觉。

整改方式：

1. 对 Spring 核心 topic：保留排查思路，但改成当前 topic 专属表达。例如 AOP 应讲代理对象、切点表达式、自调用、final 方法、事务失效。
2. 对 MQ topic：改成 broker、producer/consumer、ack、offset、重试、死信、积压等专属排查。
3. 对微服务治理 topic：改成注册发现、配置推送、路由规则、熔断限流规则、链路超时等专属排查。
4. 将该模板加入校验脚本 warning，待修完后升级为 fail 或保持高风险扫描项。

验收标准：

1. `rg -n "Spring Boot 的 debug 日志和 Actuator 端点能提供很大帮助|先看异常堆栈定位失败点，再检查 Bean 定义" topics/java` 不再大面积命中。
2. 每个 topic 的 followUpQuestions、recallPrompts、rubric 都与当前知识点强相关。

### G. RAG topic 内容需要从“实战大全”收敛为稳定原理

涉及文件：

1. `topics/agent/topic-106-bf5350b9.json`
2. `domains/agent.json`

当前问题：

`RAG原理与实战` 仍命中泛标题扫描。内容中包含大量 LangChain、Semantic Kernel、LangChain4j、Milvus、BGE、RAGAS 等框架/产品示例和“生产实践中提升 xx%”表述。作为高频基础 topic，当前更像 RAG 工具实践大全，容易偏离标准第 2、5、8 节要求的稳定机制原理。

整改方式：

1. 标题建议改为 `RAG 基本链路` 或 `RAG 检索增强生成原理`。
2. 正文主线收敛为：文档加载与清洗、分块、Embedding、向量索引、检索召回、重排序、上下文构建、生成、引用溯源、评估。
3. 框架代码只保留一段最小伪代码或抽象流程，不要把多个生态框架都铺开。
4. 删除无法验证的固定提升数字，改为解释指标和评估方法。
5. 将 Agentic RAG、Semantic Kernel、LangChain4j 等内容迁移到进阶 topic 或作为简短扩展，不放在基础主线里。

验收标准：

1. 该 topic 看完后能回答“RAG 是什么、为什么需要、完整链路、关键参数、常见问题、如何评估”。
2. 内容不再像工具清单或实践合集。
3. 与 `RAG进阶`、`文档分块策略`、`RAG 评估与优化` 的边界清晰。

### H. 过泛标题仍需聚焦

涉及文件：

1. `topics/java/topic-019-a5a85fab.json`：其他锁与并发工具
2. `topics/java/topic-078-0195276a.json`：可靠性与实战
3. `topics/agent/topic-106-bf5350b9.json`：RAG原理与实战
4. `topics/frontend/topic-react18-features.json`：React 18+新特性
5. `topics/frontend/topic-perf-optimization.json`：前端性能优化全景
6. `topics/architecture/architecture.microservice.topic-service-governance.json`：服务治理全景

当前问题：

这些标题被泛化标题扫描命中。并非全部必须删除，但都需要人工确认是否违反标准第 5、6、8 节：

1. `其他锁与并发工具` 可能是多个并发工具合集，应确认是否可拆分或改名为 `CountDownLatch、CyclicBarrier 与 Semaphore`。
2. `可靠性与实战` 已确认应改名并重写边界。
3. `RAG原理与实战` 已确认应收敛为基础链路。
4. `React 18+新特性` 作为低频扩展可保留，但应确保内容不是版本特性清单；可改为 `React 并发渲染与自动批处理`。
5. `前端性能优化全景` 虽已降权，但仍是标准中明确举例的过大标题，建议拆分或改为 `前端加载性能优化`。
6. `服务治理全景` 需要确认是否只是组件清单；如保留，建议改为 `服务治理核心链路` 并突出注册发现、配置、负载均衡、熔断限流、可观测的协作关系。

验收标准：

1. 泛标题扫描只保留有明确说明的例外。
2. 保留 topic 必须能独立复述核心机制，而不是覆盖过宽的清单合集。

## 4. 推荐执行顺序

1. 先修 `C. Java 可靠性与实战`，这是当前最明显的内容定位和模板串题问题。
2. 修 `F. 泛化 Spring Boot 排查模板残留`，防止 Spring/MQ/微服务 topic 继续出现同质化回答。
3. 修 `A. Agent 顺序` 和 `B. OS/Network 顺序`，这是改动清晰、收益高的 App 学习路径问题。
4. 修 `D. Java Spring 分类混杂`，把 Spring 核心、微服务治理、MQ 中间件边界理顺。
5. 修 `G. RAG 基础 topic 收敛`，再检查它与 RAG 进阶、分块、评估 topic 的边界。
6. 修 `E. Java 数据库重叠`。
7. 修 `H. 过泛标题` 中剩余项，并决定是否拆分、改名、迁移或保留例外说明。
8. 最后再次运行结构校验、全域顺序/权重扫描、泛标题扫描和 App 首屏人工验收。

## 5. 验收命令

每批修改后运行：

```bash
npm run validate
```

高风险词扫描：

```bash
rg -n "今日笔记|面试话术|你遇到过什么问题|在实际项目中是怎么用的？有什么注意事项？|结合项目经验|能做对比|能说明取舍|回答不够深入|不了解原理|理论和实践脱节|建议通过实际项目验证理论" topics
```

泛化 Spring 排查模板扫描：

```bash
rg -n "Spring Boot 的 debug 日志和 Actuator 端点能提供很大帮助|先看异常堆栈定位失败点，再检查 Bean 定义|AbstractApplicationContext|Spring源码" topics/java
```

泛标题扫描：

```bash
node - <<'NODE'
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
for (const de of manifest.domains) {
  const d = JSON.parse(fs.readFileSync(de.entry, 'utf8'));
  for (const c of d.categories) {
    for (const ref of c.topics) {
      const t = JSON.parse(fs.readFileSync(ref, 'utf8'));
      if (/全景|综合|其他|新特性|实战|最佳实践/.test(t.title)) {
        console.log(`${d.id}/${c.id}: ${t.title} ${ref}`);
      }
    }
  }
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

每次最终验收还必须人工抽查每个领域首屏，确认新用户看到的是基础高频主线，而不是低频扩展、合集标题或工具实践清单。
