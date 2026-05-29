# 知识库内容评估与调整计划

## 一、Java 领域问题汇总

### 1.1 排序严重不合理 ❌

**当前 category 排序**：
```
new-features (order: 7)  ← 排第一！
jvm (order: 10)
concurrency (order: 20)
java-fundamentals (order: 30)
spring (order: 40)
database (order: 50)
middleware (order: 60)
```

**问题**：
- `new-features` 排在最前面（order: 7），但它依赖 `java-fundamentals`（order: 30）
- 用户一进来就看到"Java 新特性"，但 Java 基础还没学
- 这完全不符合学习逻辑

**学习路径定义的是**：
```
JVM → Java 基础 → 并发 → 新特性 → Spring → 数据库 → 中间件
```

**建议调整**：
```
java-fundamentals (order: 10)  ← 基础先行
jvm (order: 20)                ← 底层原理
concurrency (order: 30)        ← 并发进阶
spring (order: 40)             ← 框架应用
database (order: 50)
middleware (order: 60)
```

### 1.2 "Java 新特性"分类应该拆散 ❌

**当前 `new-features` 包含 8 个知识点**：
- topic-lambda.json → Lambda 表达式
- topic-stream-api.json → Stream API
- topic-optional.json → Optional
- topic-record.json → Record
- topic-sealed-classes.json → Sealed Classes
- topic-pattern-matching.json → Pattern Matching
- topic-virtual-threads.json → Virtual Threads
- topic-new-datetime.json → 新日期 API

**问题**：
- Lambda、Stream、Optional 现在已经是 **Java 基础**，不是"新特性"了
- 面试官问 Lambda 不会说"请介绍一下 Java 新特性"，而是"说说 Lambda"
- 单独列出"新特性"分类，浪费用户时间，显得知识库不专业

**建议**：
| 知识点 | 融入分类 | 理由 |
|--------|----------|------|
| Lambda | java-fundamentals | Java 8 基础语法 |
| Stream API | java-fundamentals | 集合操作核心 |
| Optional | java-fundamentals | 空值处理标准 |
| Record | java-fundamentals | 数据类语法糖 |
| Sealed Classes | java-fundamentals | 类型系统增强 |
| Pattern Matching | java-fundamentals | 语法增强 |
| Virtual Threads | concurrency | 并发编程核心 |
| 新日期 API | 删除或移至 java-fundamentals | 低频面试题 |

### 1.3 面试频率标记不合理 ⚠️

**发现**：
- `topic-013 并发理论基础` 标记为 `"low"` → **应该是 `high`**！
- 并发理论（原子性/可见性/有序性/JMM/happens-before）是面试高频考点

### 1.4 summary 格式错误 ⚠️

**文件**: `topic-013-cc70cb0e.json`
```json
"summary": "*并发（Concurrency）**：多个任务..."
```
- Markdown 加粗语法不完整（开头单星号，结尾双星号）
- 作为纯文本展示时会显示 `**`

### 1.5 代码缩进错乱 ⚠️

**多个文件存在**：
- `topic-013-cc70cb0e.json` 的代码块缩进不一致
- `topic-021-d2222a23.json`（线程池原理）代码缩进错乱
- 可能是 Markdown 转 JSON 时丢失了层级信息

---

## 二、算法领域问题汇总

### 2.1 category 排序与 prerequisites 矛盾 ❌

**当前排序**：
```
array-list (order: 10)
tree-graph (order: 20) → prerequisites: ["stack-queue"]
dynamic-programming (order: 30)
string-search (order: 40)
stack-queue (order: 50)  ← 被 tree-graph 依赖，但排在后面
hash-greedy (order: 60)
backtracking (order: 70)
```

**问题**：
- `tree-graph` 依赖 `stack-queue`，但 `stack-queue` 排在 `tree-graph` 后面
- 学习路径中"栈与队列"排第二，但 category 排序中排倒数第三

**建议调整**：
```
array-list (order: 10)
stack-queue (order: 20)  ← 提前
hash-greedy (order: 30)  ← 提前
string-search (order: 40)
tree-graph (order: 50)
dynamic-programming (order: 60)
backtracking (order: 70)
```

### 2.2 高频题与知识点混在一起 ❌

**问题示例** - `topic-114 数组基础` 包含了：
- 数组基础概念
- 双指针技巧
- 滑动窗口
- 前缀和
- 差分数组
- 高频面试真题（两数之和、三数之和、盛水容器）

**用户反馈**：
> "高频题也应该分开，一堆题在一起怎么复述的出来，甚至高频题都可以不列为知识，而是提供 leetcode 的链接方便用户跳过去都可以"

**建议方案**：
1. **拆分知识点**：双指针、滑动窗口、前缀和应该各自独立成 topic
2. **高频题独立**：每个知识点下只保留 1-2 道经典题作为示例
3. **提供 LeetCode 链接**：在 recallPrompts 或新字段中添加 LeetCode 题号和链接

### 2.3 代码注释偏少 ⚠️

**问题**：
- 代码块较密集，缺少逐行注释
- 对于学习者来说，纯看代码比较累

---

## 三、Agent 领域问题汇总

### 3.1 知识点分布不均衡 ⚠️

**当前分布**：
```
LLM 基础: 11 个
RAG 与向量检索: 7 个
Agent 架构: 5 个
AI 工程化: 6 个
```

**问题**：
- LLM 基础知识点太多，可能有冗余
- Agent 架构只有 5 个，对于当前 Agent 开发热潮来说偏少
- 缺少 MCP（Model Context Protocol）的独立深入讲解

### 3.2 学习路径跳跃 ⚠️

**当前路径**：
```
LLM 基础 → RAG → Agent 架构 → AI 工程化
```

**问题**：
- 从 LLM 基础直接跳到 RAG，中间缺少"Prompt Engineering"的系统讲解
- Agent 架构和 RAG 是并行关系，但都被标记为依赖 LLM 基础
- 实际面试中，Prompt Engineering 是独立考察点

---

## 四、设计模式领域问题汇总

### 4.1 代码格式问题 ⚠️

**问题**：
- code 卡片中的代码是单行字符串（用 `\n` 分隔）
- 虽然有 `language: "java"` 标记，但代码格式不友好
- 可能导致某些客户端渲染时缩进丢失

---

## 五、其他领域通用问题

### 5.1 错别字检查

**已发现**：
- `topic-013` 的 summary: `*并发` → 应该是 `**并发`
- 用户提到"线程有错字"，需要进一步检查

**待检查**：
- 搜索所有 topic 文件中的常见错别字
- 重点检查：线程、并发、同步、锁、内存、集合等关键词

### 5.2 Markdown 格式问题

**多个文件的 summary 字段使用了 Markdown 加粗**：
```json
"summary": "**并发（Concurrency）**：..."
```
- summary 在很多场景下是纯文本渲染
- `**` 会原样显示

---

## 六、调整优先级

### P0 - 必须立即修复
1. **Java category 排序**：调整 order 值，让 java-fundamentals 排第一
2. **拆散 new-features**：将 Lambda/Stream/Optional 移入 java-fundamentals，Virtual Threads 移入 concurrency
3. **算法 category 排序**：调整 stack-queue 排序，解决 prerequisites 矛盾

### P1 - 尽快修复
4. **并发理论基础面试频率**：从 "low" 改为 "high"
5. **错别字修复**：检查并修复所有 summary 中的格式错误
6. **代码缩进修复**：修复并发相关 topic 的代码缩进

### P2 - 后续优化
7. **算法高频题拆分**：将大 topic 拆分为小知识点
8. **添加 LeetCode 链接**：在 recallPrompts 中添加题号
9. **Agent 领域补充**：增加 MCP 独立知识点
10. **代码注释增强**：为关键代码块添加注释

---

## 七、需要你确认的问题

1. **Java 新特性拆分方案**：是否同意将 Lambda/Stream/Optional 移入 java-fundamentals？
2. **算法高频题处理**：是拆分知识点，还是只添加 LeetCode 链接？
3. **Agent 领域**：是否需要增加 MCP 的独立知识点？
4. **Virtual Threads**：是放入 concurrency 还是保留单独分类？

---

## 八、执行计划

**第一步：修复排序（P0）**
- 修改 `domains/java.json` 的 category order
- 修改 `domains/algorithm.json` 的 category order
- 调整 prerequisites 依赖关系

**第二步：拆分 new-features（P0）**
- 将 8 个 topic 移动到对应分类
- 更新 `domains/java.json` 的 topics 数组
- 删除 new-features 分类

**第三步：修复内容问题（P1）**
- 修复 summary 格式错误
- 修复代码缩进
- 调整面试频率标记

**第四步：优化算法结构（P2）**
- 拆分大 topic
- 添加 LeetCode 链接
- 增强代码注释

**第五步：补充 Agent 内容（P2）**
- 评估是否需要增加 MCP 知识点
- 优化学习路径

---

请确认以上调整方案，我将按照你的确认逐步执行。
