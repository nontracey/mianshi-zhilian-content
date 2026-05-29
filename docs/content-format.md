# 面试智练内容格式规范

> 版本：v0.2  
> 日期：2026-05-29  
> 用途：供后续 AI 或人工编辑扩充“面试智练”知识内容时参考。新增领域、分类、知识点、动画和练习题时，应只修改内容仓库，不修改 App 代码。

## 1. 核心原则

1. App 是内容驱动的，不能在代码里写死 Java、Agent、算法等领域。
2. 内容仓库使用 `manifest.json` 作为入口，App 通过 manifest 发现领域和内容版本。
3. 用户侧知识结构只有：领域 -> 分类 -> 知识点。
4. 不使用“第几天”“Day X”“第几阶段”作为内容结构。
5. 每个知识点都要能独立学习、独立复述、独立评估、独立记录掌握度。
6. 新增知识默认向后兼容，旧 App 遇到不认识的字段应忽略。

## 2. 推荐目录结构

```text
content-repo/
  manifest.json
  schemas/
    domain.schema.json
    topic.schema.json
  assets/
    java/
      jvm-memory-flow.webp
      thread-pool-lifecycle.webp
    agent/
      rag-pipeline.webp
    algorithm/
      dp-state-transition.webp
  domains/
    java.json
    agent.json
    algorithm.json
  topics/
    java/
      jvm-runtime-data-area.json
      gc-roots-reference.json
    agent/
      react-agent.json
      rag-pipeline.json
    algorithm/
      dp-basic.json
```

## 3. manifest.json

`manifest.json` 是内容入口。App 启动或同步时先读取它。

```json
{
  "schemaVersion": "1.0.0",
  "contentVersion": "2026.05.27",
  "minAppVersion": "0.1.0",
  "defaultDomain": "java",
  "domains": [
    {
      "id": "java",
      "title": "Java 核心与中间件",
      "description": "JVM、并发、集合、Spring、数据库、中间件",
      "entry": "domains/java.json",
      "topicCount": 42,
      "updatedAt": "2026-05-27"
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 内容 schema 版本。只新增兼容字段时可不变。 |
| `contentVersion` | 是 | 内容包版本，用于客户端判断是否需要更新。 |
| `minAppVersion` | 是 | 加载该内容所需最低 App 版本。 |
| `defaultDomain` | 是 | 默认学习领域 ID。 |
| `domains` | 是 | 领域列表，App 根据它生成领域卡片和切换入口。 |

## 4. 领域文件

领域文件放在 `domains/` 下，例如 `domains/java.json`。

```json
{
  "id": "java",
  "title": "Java 核心与中间件",
  "description": "面向后端技术面试的 Java 知识体系。",
  "icon": "code",
  "themeColor": "#0A2540",
  "accentColor": "#00CCF9",
  "categories": [
    {
      "id": "jvm",
      "title": "JVM",
      "description": "运行时内存、GC、类加载、调优。",
      "order": 10,
      "topics": [
        "topics/java/topic-001-ebcc71cb.json",
        "topics/java/topic-002-3bee1565.json"
      ],
      "prerequisites": []
    }
  ],
  "learningPaths": [
    {
      "id": "java-backend",
      "title": "Java 后端面试路线",
      "description": "从 JVM 基础到中间件，按依赖关系逐步深入",
      "steps": [
        {
          "title": "JVM 基础",
          "description": "理解内存区域、GC 机制、类加载",
          "categoryIds": ["jvm"],
          "estimatedHours": 4
        },
        {
          "title": "并发编程",
          "description": "线程、锁、线程池、并发容器",
          "categoryIds": ["concurrency"],
          "estimatedHours": 5,
          "prerequisiteSteps": ["JVM 基础"]
        }
      ]
    }
  ]
}
```

`learningPaths` 字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 学习路径 ID，全局唯一。 |
| `title` | 是 | 学习路径名称。 |
| `description` | 是 | 学习路径简介。 |
| `steps` | 是 | 学习步骤数组，按推荐顺序排列。 |

`steps` 步骤字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 步骤名称。 |
| `description` | 是 | 步骤简介。 |
| `categoryIds` | 是 | 该步骤包含的分类 ID 数组。 |
| `estimatedHours` | 是 | 建议学习时长（小时）。 |
| `prerequisiteSteps` | 否 | 前置步骤名称数组，例如 `["JVM 基础"]`。 |

领域字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 全局唯一，使用小写英文、数字、短横线。 |
| `title` | 是 | 领域显示名称。 |
| `description` | 是 | 领域简介。 |
| `icon` | 否 | 图标名，由 App 映射。 |
| `themeColor` | 否 | 领域主色。 |
| `accentColor` | 否 | 领域强调色。 |
| `categories` | 是 | 领域下的知识分类。 |

分类字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 分类 ID，例如 `jvm`、`concurrency`、`rag`。 |
| `title` | 是 | 分类显示名称。 |
| `description` | 是 | 分类简介。 |
| `order` | 是 | 分类排序，数字越小越靠前。 |
| `topics` | 是 | 该分类下的知识点 JSON 路径。 |
| `prerequisites` | 否 | 前置依赖分类 ID 数组，例如 `["jvm", "concurrency"]`。 |

## 4.1 新领域规划格式

当内容工作台通过 AI 创建新领域时，AI 不应直接生成全部正式知识点，而应先生成领域规划，供人工审核。

```json
{
  "domain": {
    "id": "database-interview",
    "title": "数据库面试",
    "description": "面向后端面试的数据库核心知识体系。",
    "icon": "database",
    "themeColor": "#12372A",
    "accentColor": "#10B981"
  },
  "categories": [
    {
      "id": "mysql-index",
      "title": "MySQL 索引",
      "description": "B+ 树、联合索引、覆盖索引、索引失效。",
      "order": 10,
      "topics": [
        {
          "id": "database-interview.mysql-index.b-plus-tree",
          "title": "B+ 树索引",
          "summary": "理解 B+ 树为什么适合作为 MySQL 索引结构。",
          "difficulty": 3,
          "recommendWeight": 95,
          "estimatedMinutes": 25,
          "animationSuggested": true
        }
      ]
    }
  ]
}
```

新领域规划规则：

1. `domain.id` 必须全局唯一。
2. `category.id` 在领域内唯一。
3. `topic.id` 必须全局唯一，建议格式：`domain.category.topic`。
4. 不允许出现“第几天”“Day X”“第几阶段”。
5. 规划阶段只生成知识树，不生成完整正文。
6. 人工确认知识树后，再批量生成知识点 JSON。

## 5. 知识点文件

知识点文件放在 `topics/{domain}/` 下。一个知识点一个 JSON。

```json
{
  "id": "java.jvm.runtime-data-area",
  "domain": "java",
  "category": "jvm",
  "group": "memory-management",
  "title": "JVM 运行时数据区",
  "summary": "理解程序计数器、虚拟机栈、本地方法栈、堆、方法区的职责和生命周期。",
  "tags": ["JVM", "Heap", "Stack", "Metaspace"],
  "difficulty": 2,
  "estimatedMinutes": 20,
  "order": 10,
  "recommendWeight": 90,
  "status": "production",
  "prerequisites": [],
  "interviewFrequency": "high",
  "interviewerFocus": "考察对JVM内存管理的理解深度，能否区分线程私有和共享区域",
  "learningCards": [
    {
      "type": "explain",
      "title": "核心概念",
      "content": "JVM 在执行 Java 程序时，会把内存划分为不同运行时数据区。程序计数器、虚拟机栈、本地方法栈属于线程私有；堆和方法区属于线程共享。"
    }
  ],
  "recallPrompts": [
    {
      "id": "java.jvm.runtime-data-area.recall.1",
      "prompt": "请用自己的话解释 JVM 运行时数据区的划分。",
      "mode": "text"
    }
  ],
  "rubric": {
    "mustHave": ["线程私有区域", "线程共享区域", "堆", "虚拟机栈", "方法区"],
    "goodToHave": ["程序计数器不会 OOM", "JDK 8 后元空间替代永久代"],
    "commonMistakes": ["把方法区直接等同于永久代", "忽略程序计数器线程私有"],
    "scoreWeights": {
      "coverage": 40,
      "accuracy": 25,
      "interviewExpression": 20,
      "depth": 15
    }
  },
  "sourceRef": "运行时数据区概述.md"
}
```

知识点字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 全局唯一，推荐格式：`domain.category.topic`。 |
| `domain` | 是 | 所属领域 ID。 |
| `category` | 是 | 所属分类 ID。 |
| `group` | 否 | 更细分的组，例如 `memory-management`。 |
| `title` | 是 | 知识点标题。 |
| `summary` | 是 | 一句话摘要。 |
| `tags` | 是 | 标签，用于搜索和展示。 |
| `difficulty` | 是 | 难度，建议 1-5。 |
| `estimatedMinutes` | 是 | 建议学习时长。 |
| `order` | 是 | 领域内默认学习顺序。 |
| `recommendWeight` | 是 | 推荐权重，0-100。 |
| `learningCards` | 是 | 学习内容卡片。 |
| `recallPrompts` | 是 | 主动复述题。 |
| `rubric` | 是 | AI 评估标准。 |
| `sourceRef` | 否 | 内部溯源，不给用户展示。 |
| `status` | 否 | 生产状态，`production`（正式）或 `draft`（草稿），默认 `draft`。 |
| `prerequisites` | 否 | 前置依赖知识点 ID 数组，例如 `["java.jvm.runtime-data-area"]`。 |
| `interviewFrequency` | 否 | 面试频率，`high`（高频）/ `medium`（中频）/ `low`（低频）。 |
| `interviewerFocus` | 否 | 面试官关注点，说明面试官问这个知识点时真正想考察什么。 |

## 6. learningCards 类型

`learningCards` 是知识学习页的核心。App 按 `type` 选择渲染方式。

### 6.1 explain

普通解释卡片。

```json
{
  "type": "explain",
  "title": "核心概念",
  "content": "用清晰、完整但不过度冗长的方式解释知识点。"
}
```

### 6.2 interviewAnswer

面试回答模板，包含主回答和追问。

```json
{
  "type": "interviewAnswer",
  "title": "面试回答模板",
  "content": "JVM 运行时数据区可以先按线程私有和线程共享来讲……",
  "followUpQuestions": [
    {
      "question": "能结合实际项目说说JVM调优经验吗？",
      "answer": "GC调优的核心是理解对象的生命周期。新生代用复制算法，老年代用标记-清除……"
    },
    {
      "question": "和JVM相关的替代方案有哪些？",
      "answer": "对比方案时，核心是理解各自的适用场景和限制条件……"
    }
  ]
}
```

`followUpQuestions` 字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `question` | 是 | 面试官的追问问题。 |
| `answer` | 是 | 针对该追问的参考回答，必须针对当前知识点的具体内容，禁止使用模板化回答。 |

### 6.3 compareTable

对比表。

```json
{
  "type": "compareTable",
  "title": "堆和栈的区别",
  "columns": ["维度", "堆", "栈"],
  "rows": [
    ["线程关系", "线程共享", "线程私有"],
    ["存储内容", "对象实例", "栈帧、局部变量"],
    ["异常", "OutOfMemoryError", "StackOverflowError"]
  ]
}
```

### 6.4 code

代码卡片。

```json
{
  "type": "code",
  "title": "线程池创建示例",
  "language": "java",
  "content": "ThreadPoolExecutor executor = new ThreadPoolExecutor(...);",
  "highlights": [
    {
      "line": 1,
      "note": "不要直接使用 Executors 创建无限队列线程池。"
    }
  ]
}
```

### 6.5 animation

动画或动态图卡片。

```json
{
  "type": "animation",
  "title": "一次方法调用中的 JVM 内存流转",
  "asset": "assets/java/jvm-memory-flow.webp",
  "fallback": "如果动画加载失败，用流程图展示栈帧创建、对象进入堆、类信息在元空间共享。",
  "caption": "左侧线程创建栈帧，右侧堆保存对象实例，元空间保存类信息。"
}
```

动画资源要求：

| 项 | 要求 |
| --- | --- |
| 格式 | 优先 `webp`，也可用 `gif`、`mp4`、`svg`。 |
| 路径 | 放在 `assets/{domain}/` 下。 |
| 大小 | MVP 建议单个资源小于 2MB。 |
| 兜底 | 必须提供 `fallback` 文案。 |
| 内容 | 只表达知识流转，不做纯装饰动画。 |

### 6.6 diagram

静态流程图或结构图。

```json
{
  "type": "diagram",
  "title": "RAG 全流程",
  "format": "mermaid",
  "content": "flowchart LR\nA[文档] --> B[切分] --> C[Embedding] --> D[向量库] --> E[召回] --> F[生成]"
}
```

### 6.7 checklist

学习检查清单。

```json
{
  "type": "checklist",
  "title": "学完后应能说清楚",
  "items": [
    "程序计数器为什么线程私有",
    "堆和栈的区别",
    "方法区和元空间的关系"
  ]
}
```

## 7. recallPrompts

`recallPrompts` 用于主动复述练习。

```json
[
  {
    "id": "java.jvm.runtime-data-area.recall.1",
    "prompt": "请用自己的话解释 JVM 运行时数据区的划分。",
    "mode": "text",
    "expectedMinutes": 3,
    "difficulty": 2
  },
  {
    "id": "java.jvm.runtime-data-area.recall.2",
    "prompt": "如果面试官问堆和栈有什么区别，你会怎么回答？",
    "mode": "text",
    "expectedMinutes": 2,
    "difficulty": 1
  }
]
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 复述题唯一 ID。 |
| `prompt` | 是 | 用户看到的问题。 |
| `mode` | 是 | `text`、`code`、`voice`，MVP 先支持 `text`。 |
| `expectedMinutes` | 否 | 建议回答时间。 |
| `difficulty` | 否 | 题目难度 1-5。 |

## 8. rubric

`rubric` 用于 AI 评估，不要写太泛。

```json
{
  "mustHave": ["线程私有区域", "线程共享区域", "堆", "虚拟机栈", "方法区"],
  "goodToHave": ["程序计数器不会 OOM", "JDK 8 后元空间替代永久代"],
  "commonMistakes": ["把方法区直接等同于永久代", "忽略程序计数器线程私有"],
  "scoreWeights": {
    "coverage": 40,
    "accuracy": 25,
    "interviewExpression": 20,
    "depth": 15
  }
}
```

规则：

1. `mustHave` 写必须覆盖的关键点。
2. `goodToHave` 写加分点。
3. `commonMistakes` 写常见错误和混淆点。
4. `scoreWeights` 四项总和应为 100。

## 9. 内容编写规范

### 标题

标题要是知识概念，不要是排期。

推荐：

- `JVM 运行时数据区`
- `ReAct Agent`
- `动态规划状态转移`

不推荐：

- `第 1 天 JVM`
- `Day 31 Agent`
- `第 3 阶段复习`

### 摘要

摘要用一句话说明用户能学到什么。

推荐：

```text
理解程序计数器、虚拟机栈、本地方法栈、堆、方法区的职责和生命周期。
```

### 学习解释

解释要按这个顺序写：

1. 先给定义。
2. 再讲为什么需要它。
3. 再拆关键组成。
4. 再讲常见误区。
5. 最后给面试表达方式。

### 面试回答

面试回答要像人能说出口的话，不要像教材段落。

推荐结构：

```text
面试时我会先按线程私有和线程共享来讲……
```

### 动画说明

复杂知识建议加动画或图示，例如：

| 知识 | 推荐动画 |
| --- | --- |
| JVM 内存 | 栈帧创建、对象入堆、类信息共享 |
| GC | 可达性分析、对象回收流程 |
| 线程池 | 任务进入队列、线程创建、拒绝策略 |
| RAG | 文档切分、向量化、召回、重排、生成 |
| Agent | Thought、Action、Observation 循环 |
| 动态规划 | 状态表填充过程 |

## 10. 内容校验清单

新增或修改知识点前，检查：

- [ ] 没有 `第几天`、`Day X`、`第几阶段` 字段或标题。
- [ ] `id` 全局唯一。
- [ ] `domain` 在 manifest 中存在。
- [ ] `category` 在领域文件中存在。
- [ ] `learningCards` 至少包含一个 `explain`。
- [ ] `interviewAnswer` 卡片的 `followUpQuestions` 至少 2 个，回答必须针对当前知识点。
- [ ] `recallPrompts` 至少包含一个问题。
- [ ] `rubric.mustHave` 不为空。
- [ ] `interviewFrequency` 为 `high`/`medium`/`low` 之一。
- [ ] `prerequisites` 中引用的知识点 ID 确实存在。 |
- [ ] 动画类卡片有 `fallback`。
- [ ] 所有资源路径存在。
- [ ] `scoreWeights` 总和为 100。
- [ ] JSON 能通过 schema 校验。

## 11. 新增内容示例流程

新增一个“线程池核心参数”知识点：

1. 在 `topics/java/` 下新增 `thread-pool-core-params.json`。
2. 在 `domains/java.json` 的 `concurrency` 分类里加入该 topic 路径。
3. 如果需要动画，把资源放到 `assets/java/thread-pool-lifecycle.webp`。
4. 更新 `manifest.json` 的 `contentVersion`、`topicCount`、`updatedAt`。
5. 运行 schema 校验。
6. 发布内容仓库。
7. App 下次同步后自动出现该知识点，不需要发新版 App。

## 12. 内容结构同步规则

当内容结构发生变更时（如新增/删除领域、分类、知识点，修改字段结构等），必须同步更新以下三个项目和相关文档，确保各端一致性：

### 12.1 需要同步的项目

| 项目 | 说明 | 同步内容 |
|------|------|----------|
| **内容维护平台** | 内容仓库（本项目） | 内容文件、manifest、schema、文档 |
| **内容平台** | 独立项目，有 CI 流程 | 内容文件、topics 目录结构、CI 配置 |
| **App 平台** | 移动端应用 | 内容解析逻辑、缓存机制、版本检测 |

### 12.2 需要同步的文档

| 文档 | 位置 | 更新内容 |
|------|------|----------|
| **README.md** | 内容维护平台根目录 | 目录结构、字段说明、更新流程 |
| **content-format.md** | docs/ 目录 | 格式规范、字段定义、示例 |
| **schema 文件** | schemas/ 目录 | JSON Schema 定义 |
| **App 文档** | App 项目 | 内容解析逻辑、缓存策略 |

### 12.3 同步检查清单

- [ ] 内容维护平台：更新内容文件、manifest、schema
- [ ] 内容平台：同步内容文件、更新 topics 目录结构
- [ ] App 平台：更新内容解析逻辑、缓存机制
- [ ] 文档：更新 README.md、content-format.md、schema 文件
- [ ] 验证：运行 `npm run validate` 确保内容格式正确
- [ ] 测试：在各端测试内容加载和显示

### 12.4 常见同步场景

#### 场景一：新增领域

1. **内容维护平台**
   - 创建领域 JSON：`domains/{domain}.json`
   - 生成知识点文件：`topics/{domain}/{filename}.json`
   - 更新 `manifest.json` 的 `contentVersion`、`topicCount`
   - 更新 README.md 的领域分类规则

2. **内容平台**
   - 同步领域文件和知识点文件
   - 更新 CI 配置（如有新目录）
   - 更新 topics 目录结构

3. **App 平台**
   - 确保能正确解析新领域
   - 测试领域切换和内容加载
   - 更新缓存清理机制（如有需要）

4. **文档**
   - 更新 README.md 的领域分类规则
   - 更新 content-format.md 的示例
   - 更新 schema 文件（如有新字段）

#### 场景二：修改知识点结构

1. **内容维护平台**
   - 更新知识点 JSON 文件
   - 更新 schema 文件
   - 更新 manifest.json 版本号

2. **内容平台**
   - 同步知识点文件
   - 确保 CI 流程兼容新结构

3. **App 平台**
   - 更新内容解析逻辑
   - 测试新字段的渲染
   - 确保向后兼容

4. **文档**
   - 更新字段说明
   - 更新示例代码
   - 更新校验清单

#### 场景三：删除内容

1. **内容维护平台**
   - 删除文件
   - 更新 manifest.json
   - 更新版本号

2. **内容平台**
   - 同步删除文件
   - 确保 CI 流程正常

3. **App 平台**
   - 确保缓存清理机制正常
   - 测试删除后的内容加载

4. **文档**
   - 更新相关说明
   - 移除过时示例

### 12.5 同步失败处理

如果同步过程中出现问题：

1. **立即回滚**：恢复到上一个正常版本
2. **检查日志**：查看各项目的错误日志
3. **逐步排查**：从内容维护平台开始，逐个检查各项目
4. **测试验证**：在各端测试内容加载和显示
5. **记录问题**：将问题记录到文档，避免下次再犯
