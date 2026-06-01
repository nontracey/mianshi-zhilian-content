# 知识目录

## 学习路线总览

- Java 后端面试路线：Java 基础与集合 -> JVM 基础 -> 并发编程 -> Spring 生态 -> 数据库 -> 中间件 -> 微服务治理
- Agent 开发面试路线：大模型基础 -> Embedding 与向量检索 -> RAG -> 工具调用与 Agent 架构 -> AI 工程化与 LLMOps
- 算法面试路线：数组 -> 链表 -> 双指针 -> 滑动窗口 -> 栈 -> 队列 -> 哈希表 -> 二叉树 -> 图 -> 动态规划 -> 回溯 -> 贪心 -> 二分查找 -> 字符串 -> 排序 -> 设计题
- 设计模式面试路线：设计原则 -> 创建型模式 -> 结构型模式 -> 行为型模式
- 前端面试路线：JavaScript 基础 -> 网络与安全 -> CSS 与布局 -> TypeScript -> React 深入 -> Vue 框架 -> 前端工程化 -> Node.js -> 前端架构 -> 客户端开发
- 架构设计面试路线：架构方法论 -> 微服务设计 -> 系统设计 -> 项目架构设计
- .NET 开发面试路线：C# 语言基础 -> .NET Core / .NET 8+ -> ASP.NET Core -> EF Core 与数据库 -> 客户端开发 -> .NET 微服务 -> 高级主题
- 操作系统面试路线：进程与线程 -> 内存管理 -> IO 模型 -> Linux 基础
- 计算机网络面试路线：TCP/UDP 协议 -> HTTP/HTTPS -> DNS 与 CDN -> WebSocket

## Java 核心与中间件

### Java 基础与集合

- HashMap原理
- ArrayList与LinkedList
- Set、TreeMap 与 Queue 集合
- 泛型
- Lambda 表达式与函数式接口
- Stream API 详解
- Optional 类使用
- 新日期时间 API
- Record 类（Java 14+）
- Sealed Classes（Java 17+）
- Pattern Matching（Java 17+）

### JVM

- 运行时数据区概述
- 堆内存详解
- 方法区与元空间
- GC Roots与引用类型
- GC算法
- 类加载机制
- JVM参数与调优
- 反射与注解
- 垃圾收集器
- 线上问题排查

### 并发编程

- 并发理论基础
- synchronized原理
- ConcurrentHashMap
- AQS原理
- ReentrantLock
- 线程池原理
- CompletableFuture
- CountDownLatch、CyclicBarrier与Semaphore
- ThreadLocal
- volatile原理
- Virtual Threads（Java 21+）

### Spring 生态

- IoC容器
- Bean生命周期
- 循环依赖
- AOP原理
- 自动装配原理
- SpringBoot启动流程
- SpringBoot配置体系
- SpringMVC原理
- MyBatis核心原理
- MyBatis-Plus
- Spring AOP 深入

### 微服务治理

- Nacos
- OpenFeign
- Gateway
- Sentinel
- Seata分布式事务
- 分布式事务补充方案

### 数据库

- MySQL 索引原理
- 事务机制
- 锁机制
- MySQL MVCC
- SQL优化
- 慢SQL排查与容量拆分

### 中间件

- Redis数据结构
- 持久化与内存
- Redis 过期删除与内存淘汰
- 缓存问题
- Redis集群与高可用
- 分布式锁(Redis/Zookeeper)
- RabbitMQ原理
- RabbitMQ消息可靠性
- Kafka原理
- 消息队列重试消费与幂等设计
- RocketMQ与选型
- 设计模式在并发中的应用

## Agent 开发

### 大模型基础

- Transformer与注意力机制
- 大模型训练流程：预训练、SFT、RLHF、DPO
- 推理机制与解码参数
- Prompt Engineering
- Token、上下文窗口与成本

### Embedding 与向量检索

- Embedding 模型与相似度计算
- 向量数据库索引与检索
- 向量数据库核心能力对比

### RAG 与向量检索

- RAG基本链路
- RAG进阶
- RAG 召回策略
- 文档分块策略
- RAG 评估与优化

### 工具调用与 Agent 架构

- Function Calling 与工具调用
- ReAct与Plan-and-Execute
- MCP协议基础
- MCP协议深度
- Agent架构与MCP
- Agent状态管理
- 多Agent协作模式
- Prompt 注入与越权防护

### AI 工程化与 LLMOps

- AI评估与观测
- 语义缓存与成本优化
- AI安全与合规
- 模型路由与降级方案
- LLM Fine-tuning 与 LoRA

## 算法与数据结构

### 数组

- 数组基础
- LeetCode 1: 两数之和
- LeetCode 15: 三数之和
- LeetCode 11: 盛最多水的容器
- LeetCode 53: 最大子数组和

### 链表

- 链表基础
- LeetCode 206: 反转链表
- LeetCode 21: 合并两个有序链表
- LeetCode 141: 环形链表

### 双指针

- 双指针技巧
- LeetCode 27: 移除元素
- LeetCode 125: 验证回文串

### 滑动窗口

- 滑动窗口技巧
- LeetCode 3: 无重复字符的最长子串
- LeetCode 76: 最小覆盖子串
- LeetCode 239: 滑动窗口最大值

### 栈

- 栈基础
- LeetCode 20: 有效的括号
- LeetCode 155: 最小栈
- LeetCode 739: 每日温度

### 队列

- 队列基础
- 堆与优先队列基础
- LeetCode 347: 前 K 个高频元素

### 哈希表

- 哈希表基础
- LeetCode 128: 最长连续序列
- LeetCode 49: 字母异位词分组

### 二叉树

- 二叉树基础
- LeetCode 104: 二叉树的最大深度
- LeetCode 101: 对称二叉树
- LeetCode 102: 二叉树的层序遍历
- LeetCode 98: 验证二叉搜索树
- LeetCode 236: 二叉树的最近公共祖先

### 图

- 图基础
- LeetCode 200: 岛屿数量
- LeetCode 207: 课程表
- BFS 与 DFS 模板
- 并查集基础

### 动态规划

- 动态规划基础
- LeetCode 70: 爬楼梯
- LeetCode 300: 最长递增子序列
- LeetCode 322: 零钱兑换
- LeetCode 198: 打家劫舍

### 回溯

- 回溯基础
- LeetCode 46: 全排列
- LeetCode 78: 子集
- LeetCode 39: 组合总和
- LeetCode 51: N皇后

### 贪心

- 贪心算法基础
- LeetCode 55: 跳跃游戏
- LeetCode 121: 买卖股票的最佳时机

### 二分查找

- 二分查找基础
- LeetCode 33: 搜索旋转排序数组
- LeetCode 162: 寻找峰值
- LeetCode 34: 在排序数组中查找元素的第一个和最后一个位置

### 字符串

- 字符串基础
- LeetCode 5: 最长回文子串
- LeetCode 8: 字符串转换整数 (atoi)

### 排序

- 排序算法基础
- LeetCode 215: 数组中的第K个最大元素

### 设计题

- 设计题基础
- LeetCode 146: LRU缓存
- LeetCode 208: 实现Trie (前缀树)

## 设计模式

### 设计原则与框架应用

- SOLID原则
- 设计模式在Spring中的应用

### 创建型模式

- 单例模式
- 工厂模式
- 建造者模式

### 结构型模式

- 代理模式
- 适配器模式
- 装饰器模式
- 门面模式

### 行为型模式

- 策略模式
- 模板方法模式
- 观察者模式
- 责任链模式
- 状态模式

## 前端八股

### JavaScript基础

- JS数据类型与类型判断
- 原型链与继承
- 闭包与作用域
- 浏览器渲染流程
- Event Loop与异步
- Promise与async/await
- 手写Promise
- 深拷贝与浅拷贝
- 防抖与节流

### 网络与安全

- HTTP/HTTPS/TCP协议
- HTTP 缓存
- 跨域与请求方案
- Cookie、Session、Token 与 JWT
- 前端安全防护

### CSS与布局

- 盒模型与BFC
- Flex与Grid布局
- 响应式设计与CSS工程化

### TypeScript

- TS基础类型与类型系统
- 泛型与工具类型
- TS与JS互操作与工程配置
- TypeScript 高级类型编程

### React深入

- React核心概念与Fiber
- React Hooks 原理
- React状态管理
- React路由与数据加载
- React性能优化
- React并发渲染与自动批处理

### Vue框架

- Vue响应式原理
- Vue生命周期与组合式API
- Vue编译与虚拟DOM
- Vue生态（Pinia/Vue Router）

### 前端工程化

- Webpack核心原理
- Vite原理与对比
- Tree Shaking 与代码分割
- 前端CI/CD与发布
- 前端监控与错误追踪

### Node.js

- Node.js核心概念
- Node.js模块系统与包管理
- Koa/Express框架原理
- Node.js 进程管理与线上排查

### 前端架构

- 前端状态管理架构
- 前端路由原理
- 前端加载性能优化
- 微前端架构
- BFF与全栈架构

### 客户端开发

- Electron开发
- 跨平台方案对比
- React Native核心原理
- 移动端适配与性能

## 架构设计

### 架构方法论

- DDD领域驱动设计
- CQRS架构
- 事件驱动架构
- 六边形架构

### 微服务设计

- 微服务拆分原则
- 分布式事务方案选型
- 分布式锁实现方案
- 限流降级熔断策略
- 服务治理核心链路
- 分布式ID生成方案
- 幂等性设计
- 服务网格与 Service Mesh
- API网关设计

### 系统设计

- 秒杀系统设计
- 消息队列架构设计
- 缓存架构设计
- 大数据量分库分表方案
- 读写分离与数据一致性
- 高可用架构

### 业务系统架构设计

- 多租户SaaS架构设计
- 低代码平台核心架构

## .NET 开发

### C# 语言基础

- C# 类型系统
- LINQ
- async/await 异步编程
- 泛型与协变逆变
- 反射与特性

### .NET Core / .NET 8+

- 依赖注入
- 中间件管道
- 配置与选项模式
- 日志与监控
- .NET 运行时与 GC

### ASP.NET Core

- Web API 设计
- 过滤器管道
- 认证与授权
- SignalR 实时通信
- ASP.NET 性能优化

### EF Core 与数据库

- EF Core 基础
- EF Core 性能优化
- 仓储模式与工作单元
- 数据库兼容与多租户

### 客户端开发

- WPF 核心原理
- MAUI 跨平台
- Avalonia UI
- XAML 数据绑定
- 客户端架构模式

### .NET 微服务

- gRPC 与 Protobuf
- 消息队列集成
- 微服务通信
- 容器化与部署

### 高级主题

- 设计模式在 .NET 中的应用
- .NET 与 Java 对比
- 性能调优与诊断

## 操作系统与 Linux

### 进程与线程

- 进程与线程的区别
- 线程同步机制
- 死锁的产生与避免
- 进程间通信方式
- 协程与纤程

### 内存管理

- 虚拟内存原理
- 内存分页与分段
- 页面置换算法
- 内存泄漏与溢出

### IO 模型

- 阻塞/非阻塞/同步/异步
- select/poll/epoll
- Reactor 模式

### Linux 基础

- 常用命令
- 文件权限与用户管理
- 进程管理与监控

## 计算机网络

### TCP/UDP 协议

- TCP 与 UDP 的区别
- TCP 三次握手与四次挥手
- TCP 可靠传输机制
- TCP 流量控制与拥塞控制
- TCP 粘包与拆包

### HTTP/HTTPS

- HTTP 1.0/1.1/2.0/3.0 演进
- HTTP 状态码与头部字段
- HTTPS 加密原理
- 跨域与 CORS

### DNS 与 CDN

- DNS 解析流程
- CDN 原理与应用

### WebSocket

- WebSocket 协议原理
- WebSocket 与长轮询对比
