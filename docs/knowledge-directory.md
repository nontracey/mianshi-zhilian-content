# 知识目录

> 自动生成自 manifest.json，共 16 个领域、429 个知识点。标 ★ 为高频面试题。

## 学习路线总览

- Java 核心与中间件面试路线：Java 基础与集合 -> JVM -> 并发编程 -> Spring 生态 -> 微服务治理 -> 中间件
- Go 语言面试路线：基础语法与类型 -> 并发模型 -> 运行时机制 -> 工程实践
- .NET 开发面试路线：C# 语言基础 -> .NET 8/9/10 -> ASP.NET Core -> EF Core -> 客户端开发 -> .NET 微服务 -> 高级主题
- Python 开发面试路线：Python 基础入门 -> Python 进阶特性 -> Python 面向对象 -> 并发与异步编程 -> Python 工程实践 -> Python Web 开发 -> Python 编码面试
- 前端八股面试路线：JavaScript基础 -> 网络与安全 -> CSS与布局 -> TypeScript -> React深入 -> Vue框架 -> 前端工程化 -> Node.js -> 前端架构 -> 客户端开发
- 数据库面试路线：MySQL 核心机制 -> Redis 与缓存 -> 分布式与 NoSQL
- DevOps 与云原生面试路线：交付流水线 -> 容器与 Kubernetes -> 可观测性与 SRE -> 平台工程与云原生扩展
- 数据工程面试路线：数仓与治理基础 -> 离线计算 -> 实时计算 -> 数据平台
- 网络安全面试路线：Web 安全 -> 认证授权与密码学 -> 防御体系与合规
- Agent 开发面试路线：大模型基础 -> Embedding 与向量检索 -> RAG 与向量检索 -> 工具调用与 Agent 架构 -> AI 工程化与 LLMOps
- 算法与数据结构面试路线：数组 -> 链表 -> 双指针 -> 滑动窗口 -> 栈 -> 队列 -> 哈希表 -> 二叉树 -> 图 -> 动态规划 -> 回溯 -> 贪心 -> 二分查找 -> 字符串 -> 排序 -> 设计题
- 设计模式面试路线：设计原则与框架应用 -> 创建型模式 -> 结构型模式 -> 行为型模式
- 架构设计面试路线：架构方法论 -> 微服务设计 -> 系统设计 -> 业务系统架构设计
- 操作系统与 Linux 面试路线：进程与线程 -> 内存管理 -> IO 模型 -> Linux 基础
- 计算机网络面试路线：TCP/UDP 协议 -> HTTP/HTTPS -> DNS 与 CDN -> WebSocket
- 自媒体运营面试路线：定位与选题 -> 内容生产 -> 分发与数据 -> 增长与商业化

## Java 核心与中间件

### Java 基础与集合

- HashMap 原理 ★
- ArrayList 与 LinkedList ★
- Set、TreeMap 与 Queue 集合
- 泛型 ★
- Lambda 表达式与函数式接口
- Stream API 详解
- Optional 类使用
- 新日期时间 API
- Record 类（Java 16+ 正式）
- Sealed Classes（Java 17+）
- Pattern Matching（instanceof 与 switch）
- Java IO/NIO 体系与 Netty ★

### JVM

- 运行时数据区概述 ★
- 堆内存详解 ★
- 方法区与元空间
- GC Roots 与引用类型
- GC 算法 ★
- 类加载机制
- JVM 参数与调优
- 反射与注解 ★
- 垃圾收集器 ★
- ZGC/Shenandoah 与现代低延迟 GC 选型
- 线上问题排查 ★

### 并发编程

- 并发理论基础 ★
- synchronized 原理 ★
- ConcurrentHashMap ★
- AQS 原理 ★
- ReentrantLock
- 线程池原理 ★
- CompletableFuture ★
- CountDownLatch、CyclicBarrier 与 Semaphore
- ThreadLocal ★
- volatile 原理 ★
- 设计模式在并发中的应用
- Virtual Threads（Java 21+）

### Spring 生态

- IoC 容器
- Bean 生命周期
- 循环依赖
- AOP 原理 ★
- Spring 事务传播与失效场景 ★
- 自动装配原理 ★
- SpringBoot 启动流程 ★
- SpringBoot 配置体系 ★
- SpringMVC 原理 ★
- MyBatis 核心原理
- MyBatis-Plus ★
- Spring AOP 深入
- Java SPI 与 Spring 扩展机制

### 微服务治理

- Nacos
- OpenFeign
- Gateway
- Sentinel
- Seata 分布式事务
- 本地消息表与事务消息

### 中间件

- RabbitMQ 原理 ★
- RabbitMQ 消息可靠性 ★
- Kafka 原理 ★
- 消息队列重试消费与幂等设计 ★
- RocketMQ 与选型

## Go 语言

### 基础语法与类型

- Go 类型、零值与值语义 ★
- Slice 与 Map 底层机制 ★
- Interface 与类型断言 ★

### 并发模型

- Goroutine 与 GMP 调度模型 ★
- Channel、select 与并发通信 ★
- Context 超时、取消与链路传递 ★

### 运行时机制

- Go 内存分配与 GC
- defer、panic 与 recover
- Error 处理与错误链 ★

### 工程实践

- Go Web 服务与中间件
- Go Module 与依赖管理
- pprof 性能剖析

## .NET 开发

### C# 语言基础

- C# 类型系统 ★
- LINQ ★
- async/await 异步编程 ★
- 泛型与协变逆变
- 反射与特性
- C# 12/13/14 现代语言特性 ★

### .NET 8/9/10

- 依赖注入 ★
- 中间件管道 ★
- 配置与选项模式
- 日志与监控
- .NET 运行时与 GC ★
- Native AOT 与启动性能
- .NET Aspire 云原生编排

### ASP.NET Core

- Web API 设计 ★
- 过滤器管道
- 认证与授权 ★
- SignalR 实时通信
- ASP.NET 性能优化
- Blazor 组件模型与渲染模式

### EF Core

- EF Core 基础 ★
- EF Core 性能优化 ★
- 仓储模式与工作单元
- EF Core 多租户与 Provider 兼容

### 客户端开发

- WPF 核心原理
- MAUI 跨平台
- Avalonia UI
- XAML 数据绑定
- 客户端架构模式

### .NET 微服务

- .NET gRPC 服务与 Protobuf
- 消息队列集成
- 微服务通信
- .NET 容器化与部署

### 高级主题

- ASP.NET Core 内置设计模式
- 从 Java 迁移到 .NET
- 性能调优与诊断

## Python 开发

### Python 基础入门

- 数据类型与变量 ★
- 控制流与函数 ★
- 容器类型详解 ★
- 字符串与正则表达式

### Python 进阶特性

- 装饰器 ★
- 生成器与迭代器 ★
- 上下文管理器
- Python 闭包与 LEGB 作用域
- 异常处理与 ExceptionGroup ★

### Python 面向对象

- 类与继承机制 ★
- 魔术方法
- MRO 与描述符协议

### 并发与异步编程

- GIL 与多线程 ★
- 多进程编程
- asyncio 异步编程 ★

### Python 工程实践

- Python 内存管理与 GC ★
- 模块与包管理
- 现代 Python 工具链：uv / ruff / pyproject ★
- 类型注解系统
- 测试策略与 pytest
- 性能分析与优化

### Python Web 开发

- Flask 与 FastAPI ★
- ORM 与数据库交互

### Python 编码面试

- Pythonic 编程范式 ★
- 内置函数与标准库

## 前端八股

### JavaScript基础

- JS 数据类型与类型判断 ★
- 原型链与继承 ★
- JavaScript 闭包与作用域链 ★
- 浏览器渲染流程 ★
- Event Loop 与异步 ★
- Promise 与 async/await ★
- 手写 Promise
- 深拷贝与浅拷贝 ★
- 防抖与节流 ★

### 网络与安全

- HTTP/HTTPS/TCP 协议 ★
- HTTP 缓存 ★
- 跨域与请求方案 ★
- Cookie、Session、Token 与 JWT ★
- 前端安全防护 ★

### CSS与布局

- 盒模型与 BFC ★
- Flex 与 Grid 布局
- 响应式设计与 CSS 工程化
- 现代 CSS：容器查询 /:has / View Transitions

### TypeScript

- TS 基础类型与类型系统
- 泛型与工具类型
- TS 与 JS 互操作与工程配置
- TypeScript 高级类型编程

### React深入

- React 核心概念与 Fiber
- React Hooks 原理 ★
- React 状态管理
- React 路由与数据加载
- React 性能优化
- React 18/19 并发渲染、Actions 与 RSC

### Vue框架

- Vue 响应式原理 ★
- Vue 生命周期与组合式 API
- Vue 编译与虚拟 DOM
- Vue 生态（Pinia/Vue Router）

### 前端工程化

- Webpack 核心原理
- Vite 原理与对比
- Tree Shaking 与代码分割
- 前端 CI/CD 与发布
- 前端监控与错误追踪
- 新一代构建工具：Rspack / Turbopack / Rolldown

### Node.js

- Node.js 核心概念
- Node.js 模块系统与包管理
- Koa/Express 框架原理
- Node.js 进程管理与线上排查

### 前端架构

- 前端状态管理架构
- 前端路由原理
- 前端加载性能优化
- 微前端架构
- BFF 与全栈架构
- SSR 与 Next.js App Router ★

### 客户端开发

- Electron 开发
- 跨平台方案对比
- React Native 核心原理
- 移动端适配与性能

## 数据库

### MySQL 核心机制

- MySQL 索引原理 ★
- 事务 ACID 与隔离级别 ★
- MySQL 锁机制 ★
- MySQL MVCC 与 ReadView ★
- EXPLAIN 与 SQL 优化 ★
- 慢 SQL 排查与容量拆分 ★

### Redis 与缓存

- Redis 数据结构 ★
- Redis 持久化与内存管理 ★
- Redis 过期删除与内存淘汰 ★
- 缓存穿透、击穿与雪崩 ★
- Redis 主从、哨兵与 Cluster ★
- Redis 分布式锁与一致性边界 ★

### 分布式与 NoSQL

- 分库分表方案
- 读写分离与主从延迟
- MongoDB 文档模型与索引
- NoSQL 类型与选型边界
- 数据建模、范式与反范式

## DevOps 与云原生

### 交付流水线

- CI/CD 流水线 ★
- GitOps 发布模型
- 蓝绿、金丝雀与灰度发布 ★

### 容器与 Kubernetes

- Docker 镜像分层与体积优化 ★
- Kubernetes 核心对象与 Pod 生命周期 ★
- Kubernetes 网络：CNI、Service 与 Ingress ★
- K8s 调度与资源管理 ★

### 可观测性与 SRE

- 指标、日志与链路追踪
- 告警设计与降噪
- SLO、SLI 与错误预算
- 故障响应与复盘

### 平台工程与云原生扩展

- Terraform 与基础设施即代码
- Helm 与 Kustomize 配置管理
- Service Mesh 基本原理

## 数据工程

### 数仓与治理基础

- 数据仓库分层 ★
- 维度建模与事实表 ★
- ETL 与 ELT 数据加工 ★
- 数据质量与数据治理 ★

### 离线计算

- Hive Metastore
- Spark Shuffle 原理与 AQE 优化
- Spark SQL 优化

### 实时计算

- Kafka 数据管道语义 ★
- Flink 状态与 Checkpoint ★
- Watermark、窗口与乱序数据 ★
- 实时计算 Exactly-Once 语义 ★

### 数据平台

- Airflow 调度与任务编排
- 湖仓表格式 Iceberg/Hudi/Delta
- 元数据、血缘与数据目录

## 网络安全

### Web 安全

- XSS 与 CSRF 防护 ★
- SQL 注入与参数化查询 ★
- SSRF 与文件上传安全 ★
- CORS、Cookie 与浏览器安全边界 ★

### 认证授权与密码学

- 认证、授权与访问控制
- OAuth2、OIDC 与 JWT
- 密码存储与加盐哈希
- 哈希、加密与数字签名
- TLS 与 PKI

### 防御体系与合规

- 威胁建模与攻击面分析
- 依赖安全与密钥管理
- 安全日志、审计与合规
- 安全事件响应

## Agent 开发

### 大模型基础

- Transformer 与注意力机制 ★
- 大模型训练流程：预训练、SFT、RLHF、DPO ★
- 推理机制与解码参数 ★
- Prompt Engineering ★
- Token、上下文窗口与成本 ★
- 推理模型与 test-time compute ★

### Embedding 与向量检索

- Embedding 模型与相似度计算 ★
- 向量数据库索引与检索 ★
- 向量数据库核心能力对比

### RAG 与向量检索

- RAG 基本链路 ★
- RAG 进阶
- RAG 召回策略 ★
- 文档分块策略
- RAG 评估与优化
- 高级 RAG：Rerank / GraphRAG / Self-RAG

### 工具调用与 Agent 架构

- Function Calling 与工具调用 ★
- 结构化输出与约束解码 ★
- ReAct 与 Plan-and-Execute
- MCP 协议基础
- MCP 协议深度
- Agent 架构与 MCP
- Agent 状态管理
- 多 Agent 协作模式 ★
- Prompt 注入与越权防护 ★

### AI 工程化与 LLMOps

- AI 评估与观测 ★
- 语义缓存与成本优化
- AI 安全与合规 ★
- 模型路由与降级方案
- LLM Fine-tuning 与 LoRA
- 推理服务化：vLLM / PagedAttention / Continuous Batching

## 算法与数据结构

### 数组

- 数组基础 ★
- LeetCode 1: 两数之和 ★
- LeetCode 15: 三数之和
- LeetCode 11: 盛最多水的容器
- LeetCode 53: 最大子数组和 ★
- LeetCode 56: 合并区间 ★

### 链表

- 链表基础 ★
- LeetCode 206: 反转链表 ★
- LeetCode 21: 合并两个有序链表
- LeetCode 25: K 个一组翻转链表 ★
- LeetCode 141: 环形链表
- LeetCode 142: 环形链表 II ★
- LeetCode 160: 相交链表 ★
- LeetCode 19: 删除链表的倒数第 N 个结点 ★
- LeetCode 23: 合并 K 个升序链表 ★

### 双指针

- 双指针技巧 ★
- LeetCode 27: 移除元素
- LeetCode 125: 验证回文串
- LeetCode 42: 接雨水 ★

### 滑动窗口

- 滑动窗口技巧 ★
- LeetCode 3: 无重复字符的最长子串 ★
- LeetCode 76: 最小覆盖子串 ★
- LeetCode 239: 滑动窗口最大值 ★

### 栈

- 栈基础 ★
- LeetCode 20: 有效的括号
- LeetCode 155: 最小栈
- LeetCode 739: 每日温度 ★

### 队列

- 队列基础 ★
- 堆与优先队列基础 ★
- LeetCode 347: 前 K 个高频元素 ★

### 哈希表

- 哈希表基础 ★
- LeetCode 128: 最长连续序列
- LeetCode 49: 字母异位词分组

### 二叉树

- 二叉树基础 ★
- LeetCode 104: 二叉树的最大深度
- LeetCode 101: 对称二叉树
- LeetCode 102: 二叉树的层序遍历
- LeetCode 98: 验证二叉搜索树
- LeetCode 236: 二叉树的最近公共祖先

### 图

- 图基础 ★
- LeetCode 200: 岛屿数量 ★
- LeetCode 207: 课程表 ★
- BFS 与 DFS 模板 ★
- 并查集基础

### 动态规划

- 动态规划基础 ★
- LeetCode 70: 爬楼梯
- LeetCode 300: 最长递增子序列 ★
- LeetCode 322: 零钱兑换 ★
- LeetCode 198: 打家劫舍 ★
- LeetCode 72: 编辑距离 ★

### 回溯

- 回溯基础 ★
- LeetCode 46: 全排列
- LeetCode 78: 子集
- LeetCode 39: 组合总和
- LeetCode 51: N 皇后

### 贪心

- 贪心算法基础 ★
- LeetCode 55: 跳跃游戏
- LeetCode 121: 买卖股票的最佳时机

### 二分查找

- 二分查找基础 ★
- LeetCode 33: 搜索旋转排序数组 ★
- LeetCode 162: 寻找峰值
- LeetCode 34: 在排序数组中查找元素的第一个和最后一个位置 ★

### 字符串

- 字符串基础 ★
- LeetCode 5: 最长回文子串 ★
- LeetCode 8: 字符串转换整数 (atoi)

### 排序

- 排序算法基础 ★
- LeetCode 215: 数组中的第 K 个最大元素

### 设计题

- 设计题基础 ★
- LeetCode 146: LRU 缓存 ★
- LeetCode 208: 实现 Trie (前缀树)

## 设计模式

### 设计原则与框架应用

- SOLID 原则 ★
- 设计模式在 Spring 中的应用

### 创建型模式

- 单例模式 ★
- 工厂模式 ★
- 建造者模式
- 原型模式

### 结构型模式

- 代理模式 ★
- 适配器模式
- 装饰器模式
- 门面模式

### 行为型模式

- 策略模式 ★
- 模板方法模式
- 观察者模式
- 责任链模式
- 状态模式
- 命令模式

## 架构设计

### 架构方法论

- DDD 领域驱动设计 ★
- CQRS 架构
- 事件驱动架构
- 六边形架构
- 整洁架构（Clean Architecture）
- 事件溯源（Event Sourcing）

### 微服务设计

- 微服务拆分原则
- 分布式事务方案选型 ★
- 分布式锁实现方案 ★
- 限流降级熔断策略 ★
- 服务治理核心链路
- 分布式 ID 生成方案 ★
- 幂等性设计 ★
- API 网关设计

### 系统设计

- 秒杀系统设计 ★
- 消息队列架构设计
- 缓存架构设计 ★
- 一致性哈希 ★
- 短链系统设计 ★
- 长连接推送系统设计 ★
- Feed 流系统设计 ★

### 业务系统架构设计

- 多租户 SaaS 架构设计 ★
- 低代码平台核心架构

## 操作系统与 Linux

### 进程与线程

- 进程与线程的区别 ★
- 线程同步机制
- 死锁的产生与避免 ★
- 进程间通信方式
- 协程与纤程
- 系统调用与用户态/内核态切换 ★
- CPU 调度算法与 CFS

### 内存管理

- 虚拟内存原理 ★
- 内存分页与分段
- 页面置换算法
- 内存泄漏与溢出

### IO 模型

- 阻塞/非阻塞/同步/异步 ★
- select/poll/epoll ★
- Reactor 模式
- 零拷贝技术 ★
- io_uring 异步 IO

### Linux 基础

- 常用命令
- 文件权限与用户管理
- 进程管理与监控

## 计算机网络

### TCP/UDP 协议

- TCP 与 UDP 的区别 ★
- TCP 三次握手与四次挥手 ★
- TCP 可靠传输机制 ★
- TCP 流量控制与拥塞控制 ★
- TCP 粘包与拆包
- gRPC 协议与 Protobuf 编码

### HTTP/HTTPS

- HTTP 1.0/1.1/2.0/3.0 演进 ★
- HTTP/3 与 QUIC
- HTTP 状态码与头部字段 ★
- HTTPS 加密原理 ★
- 跨域与 CORS ★
- 从输入 URL 到页面展示发生了什么 ★

### DNS 与 CDN

- DNS 解析流程 ★
- CDN 原理与应用

### WebSocket

- WebSocket 协议原理
- WebSocket 与长轮询对比

## 自媒体运营

### 定位与选题

- 账号定位与用户画像 ★
- 内容价值主张与差异化 ★
- 选题体系与内容规划 ★

### 内容生产

- 标题、封面与开头钩子 ★
- 图文内容结构
- 短视频脚本结构 ★

### 分发与数据

- 推荐机制与流量池 ★
- 完播率、互动率与转化指标 ★
- 内容数据复盘与迭代 ★

### 增长与商业化

- 粉丝运营与用户分层
- 账号矩阵与内容 IP
- 商业化路径与转化链路
- 广告合作与报价模型
- 内容合规与版权风险 ★
