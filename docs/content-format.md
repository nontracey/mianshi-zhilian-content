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
  staging-manifest.json
  draft-manifest.json
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
  staging/
    domains/
      java.json
    topics/
      java/
        jvm-runtime-data-area.json
  draft/
    domains/
      java.json
    topics/
      java/
        jvm-runtime-data-area.json
```

## 3. manifest.json

`manifest.json` 是正式内容入口。测试和草稿分别使用 `staging-manifest.json`、`draft-manifest.json`。App 或工作台启动/同步时先读取对应环境的 manifest。

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

环境隔离规则：

| 入口 | 领域路径 | 知识点路径 | 使用者 |
| --- | --- | --- | --- |
| `manifest.json` | `domains/` | `topics/` | 正式用户 App |
| `staging-manifest.json` | `staging/domains/` | `staging/topics/` | 测试 App、测试预览 |
| `draft-manifest.json` | `draft/domains/` | `draft/topics/` | 内容工作台 |

调用方必须使用 `manifest.domains[].entry` 加载领域文件，并使用 `domain.categories[].topics[]` 加载知识点文件；不能根据 domainId 或 topicId 自行拼接固定路径。

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
| `estimatedMinutes` | 是 | 建议学习时长。口径为**首次阅读理解**所需分钟数，不含反复复述练习与 AI 评估的时间；App 仅作展示（详情页/目录/今日复习卡片），不参与推荐或排期计算。 |
| `order` | 是 | 领域内默认学习顺序。 |
| `recommendWeight` | 是 | 推荐权重，0-100。 |
| `learningCards` | 是 | 学习内容卡片。 |
| `recallPrompts` | 是 | 主动复述题。 |
| `rubric` | 是 | AI 评估标准。 |
| `sourceRef` | 否 | 内部溯源，不给用户展示。 |
| `status` | 否 | 内容状态，`production`（正式）、`staging`（测试）或 `draft`（草稿），默认 `draft`。状态字段用于工作台流程，真正的环境隔离以 manifest 指向的文件路径为准。 |
| `prerequisites` | 否 | 前置依赖知识点 ID 数组，例如 `["java.jvm.runtime-data-area"]`。 |
| `interviewFrequency` | 否 | 面试频率，`high`（高频）/ `medium`（中频）/ `low`（低频）。 |
| `interviewerFocus` | 否 | 面试官关注点，说明面试官问这个知识点时真正想考察什么。 |

## 6. learningCards 类型

`learningCards` 是知识学习页的核心。App 按 `type` 选择渲染方式。

所有卡片都应至少包含：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `type` | 是 | 卡片类型。当前 schema 允许 `explain`、`interviewAnswer`、`compareTable`、`code`、`animation`、`diagram`、`checklist`。 |
| `title` | 是 | 卡片标题。 |
| `content` | 否 | Markdown 或纯文本内容。部分卡片可使用结构化字段替代。 |

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

面试回答模板，包含主回答和追问。`content` 支持 Markdown，涉及多个要点时必须使用 Markdown 有序列表或无序列表，不要写成 `1）...；2）...；3）...` 这种行内编号。App 已兼容 Markdown 渲染，列表拆行后更适合移动端阅读。

高频 topic 的 `interviewAnswer.content` 应能明显读出三层结构：先用一小段给 30 秒结论，再用列表解释核心机制，最后补充追问边界、常见坑或方案取舍。可以不机械使用固定标题，但不要只堆清单或代码。

```json
{
  "type": "interviewAnswer",
  "title": "面试回答模板",
  "content": "**问题：JVM 运行时数据区怎么划分？**\n\nJVM 运行时数据区可以先按线程私有和线程共享来讲。\n\n1. 线程私有区域包括程序计数器、虚拟机栈和本地方法栈。\n2. 线程共享区域包括堆和方法区。\n3. 堆是 GC 主要管理的区域，方法区主要存储类信息、常量和静态变量。",
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

`interviewAnswer` 卡片允许同时包含 `content` 和 `followUpQuestions`。正式内容建议每张 `interviewAnswer` 至少维护 2 条追问，schema 会校验追问对象必须包含 `question` 与 `answer`。

### 6.3 compareTable

对比表。推荐使用结构化 `columns` + `rows`，App 可以直接渲染为表格；也可使用 `content` 写 Markdown 表格。结构化表格中每一行的列数应与 `columns` 对齐。

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

`compareTable` 字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `columns` | 条件必填 | 表头数组。使用结构化表格时必须提供。 |
| `rows` | 条件必填 | 表格行二维数组。使用结构化表格时必须提供。 |
| `content` | 条件必填 | Markdown 表格或解释内容；未提供 `columns`/`rows` 时必须提供。 |

### 6.4 code

代码卡片。`language` 必填，值应使用 App 语法高亮可识别的语言 ID，例如 `java`、`python`、`javascript`、`typescript`、`bash`、`sql`、`json`、`yaml`、`c`、`cpp`、`go`、`rust`。

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

`highlights` 用于给代码行加讲解锚点。每个对象必须包含：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `line` | 是 | 需要强调的行号，从 1 开始。 |
| `note` | 是 | 针对该行的说明，必须写具体语义，不要写“关键行”这类泛化占位。 |

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

静态流程图或结构图。`format` 当前允许 `mermaid`、`svg`、`image`、`text`。

```json
{
  "type": "diagram",
  "title": "RAG 全流程",
  "format": "mermaid",
  "content": "flowchart LR\nA[文档] --> B[切分] --> C[Embedding] --> D[向量库] --> E[召回] --> F[生成]"
}
```

`diagram` 字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `format` | 否 | 图示格式；未填时按文本/Markdown 兜底处理。 |
| `content` | 条件必填 | `format=mermaid` 时必须提供 Mermaid 源码。 |
| `svgPath` | 否 | SVG 静态资源路径。 |
| `asset` | 否 | 图片或动画资源路径。 |
| `svg` | 否 | 内联 SVG 字符串；仅用于受控内容。 |
| `fallback` | 否 | 图示无法渲染时给用户看的文字说明。 |
| `caption` | 否 | 图注。 |

Mermaid 约束：

1. `format=mermaid` 的 `content` 必须以 `flowchart` 或 `graph` 开头，并带方向声明，例如 `flowchart LR`、`flowchart TD`、`graph LR`。
2. 只使用 App 已验证的基础流程图子集：节点、连线、分支、简单标签；不要使用 sequence、classDiagram、stateDiagram、mindmap、复杂样式或外部资源引用。
3. Mermaid 图应该能用纯文本解释兜底，复杂知识建议同时写 `fallback` 或 `caption`。
4. 图示节点必须使用当前 topic 的专属概念、对象、状态或链路名，不得大量使用 `输入`、`处理`、`输出`、`关键流程`、`边界处理` 这类万能节点。
5. 图示必须表达真实关系，例如调用顺序、数据流、状态转移、依赖关系、隔离边界或失败路径；不能只是把正文关键词横向摆放。
6. `caption` 或 `fallback` 应说明图在解释哪个机制，不能写成“展示本知识点关键环节”这类模板句。
7. 遇到 Mermaid 孤立节点时必须先判断语义：引用错位就补正确连线，重复定义且已有更好图承接才删除，不能为了通过校验直接批量清理。
8. 禁止用 `topic 标题 -> 领域 -> 分类 -> 标签` 拼成“关键链路图”；这类图与 topic 表面相关，但没有解释真实机制。

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

> **规则：第一条 recallPrompt 必须是该 topic 最核心、可直接模拟面试的问题。** App 会在复述练习、模拟面试、追问跟练等入口按练习轮次轮换消费多条 `recallPrompts`，因此每一条都不能是泛化模板或跨 topic 复制的通用题；第一条仍必须是最核心问题，用于首轮练习和旧版本兼容。

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
4. `scoreWeights` 必须包含 `coverage`、`accuracy`、`interviewExpression`、`depth` 四项；每项为 0-100 的整数，总和应为 100。

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
- [ ] `prerequisites` 中引用的知识点 ID 确实存在。
- [ ] 动画类卡片有 `fallback`。
- [ ] `diagram.format=mermaid` 的内容以 `flowchart` 或 `graph` 开头，并只使用 App 可渲染的基础子集。
- [ ] 图示节点、标题、图注和兜底说明都与当前 topic 相关，没有复用万能流程图或跨领域无关图。
- [ ] 图示没有自动拼接感；孤立节点已按“补边、重画、替换、删除重复定义”的顺序诊断。
- [ ] `code` 卡片必须有 `language`，`highlights` 必须指向具体行。
- [ ] 内容具备正向质量证据：具体例子、边界/失败路径、验证或排查指标、取舍分析、真实追问和专属 rubric；字段齐全但证据不足会被评分封顶。
- [ ] 所有资源路径存在。
- [ ] `scoreWeights` 总和为 100。
- [ ] JSON 能通过 schema 校验。
- [ ] `npm run quality:audit` 通过，单 topic、单领域和总体质量分均不低于 90。

## 11. 新增内容示例流程

新增一个“线程池核心参数”知识点：

1. 在 `topics/java/` 下新增 `thread-pool-core-params.json`。
2. 在 `domains/java.json` 的 `concurrency` 分类里加入该 topic 路径。
3. 如果需要动画，把资源放到 `assets/java/thread-pool-lifecycle.webp`。
4. 更新 `manifest.json` 的 `contentVersion`、`topicCount`、`updatedAt`。
5. 运行 schema 校验。
6. 运行 `npm run quality:audit`，确认内容质量、深度、图示、追问、rubric 和正向证据达到 90 分门槛；95+ 需要例子、边界、验证、取舍和图文贴合都比较扎实。
7. 发布内容仓库。
8. App 下次同步后自动出现该知识点，不需要发新版 App。

## 12. JSON 结构契约同步规则

这里的“结构变更”只指最终 JSON 契约或 schema 发生变化，不指新增/删除领域、分类、知识点，也不指修改难度、频率、权重、排序、标题、正文等知识内容。

新增知识点、删除知识点、调整领域/分类/排序、修改 difficulty/recommendWeight/interviewFrequency 等，属于内容更新。按 App 部署文档要求更新 `manifest.json` 的 `contentVersion`，运行 schema 校验并发布内容即可；通常不需要发新版 App。

### 12.1 什么是 JSON 结构契约变更

以下情况才属于结构契约变更：

1. topic、domain、manifest 字段更名、删除字段、增加必填字段。
2. 新增字段且 App 或 studio 需要识别、编辑、筛选、渲染、排序、校验或生成该字段。
3. 修改字段类型、字段语义、枚举值或嵌套对象结构。
4. 新增 `learningCards.type`、`recallPrompts.mode` 等需要新渲染或新编辑能力的枚举。
5. 修改 manifest/domain/topic 的加载入口、文件路径规则、draft/staging/production manifest 规则。
6. 修改 schemaVersion/minAppVersion 兼容策略，或引入旧 App 不能忽略的新结构。

### 12.2 结构契约变更时必须同步的项目

| 项目 | 同步内容 |
|------|----------|
| **内容仓库** | `schemas/`、manifest 示例、校验脚本、生成脚本、内容格式文档、判断标准 |
| **App 项目** | 内容解析模型、缓存/版本兼容逻辑、渲染逻辑、测试、App 对应文档 |
| **studio 项目** | 类型定义、表单编辑器、AI 生成模板、校验流程、预览逻辑、发布流程、对应文档 |

最终部署、内容版本、缓存刷新、schemaVersion/minAppVersion 策略，应参考 App 项目的部署文档：`/Users/yingjunchi/code/mianshi-zhilian-app/docs/deploy.md`。

### 12.3 内容更新检查清单

- [ ] 更新 `manifest.json` 的 `contentVersion`。
- [ ] 更新相关 `topicCount`、`updatedAt` 和 domain topic 引用。
- [ ] 运行 `npm run validate`。
- [ ] 运行 `npm run quality:audit`。
- [ ] 确认字段名、字段类型、枚举值、卡片类型没有变化。
- [ ] 若只是内容值变化，通常不需要改 App 或 studio。
- [ ] 若实际发现 App 渲染、缓存、studio 编辑或生成流程不兼容，再同步修对应项目和文档。

### 12.4 结构契约变更检查清单

- [ ] 更新 `schemas/*.schema.json`。
- [ ] 更新 `docs/content-format.md` 和相关内容标准。
- [ ] 更新内容校验脚本和生成脚本。
- [ ] 更新 App 内容解析、渲染、缓存和兼容逻辑。
- [ ] 更新 App 项目文档，尤其是内容加载、部署和版本兼容说明。
- [ ] 更新 studio 类型、表单、AI 生成模板、校验、预览和发布流程。
- [ ] 更新 studio 对应文档。
- [ ] 根据兼容性调整 `schemaVersion` 和 `minAppVersion`。
- [ ] 运行内容仓库、App、studio 各自测试或校验。

### 12.5 同步失败处理

如果同步过程中出现问题：

1. **立即回滚**：恢复到上一个正常版本
2. **检查日志**：查看各项目的错误日志
3. **逐步排查**：从内容维护平台开始，逐个检查各项目
4. **测试验证**：在各端测试内容加载和显示
5. **记录问题**：将问题记录到文档，避免下次再犯
