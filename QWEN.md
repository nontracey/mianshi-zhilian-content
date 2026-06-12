# 面试智练内容仓库 (mianshi-zhilian-content)

## 项目概述

面试智练的公共知识内容源。这是一个 **JSON 内容分发仓库**，通过 Cloudflare Pages 部署为静态站点，供移动端 App 消费。App 通过 `manifest.json` 发现领域、分类、知识点和资源；新增知识无需修改 App 代码。

**核心原则**：App 是内容驱动的，用户侧知识结构只有"领域 -> 分类 -> 知识点"三层。不使用阶段、天数或排期概念。

**当前规模**：16 个领域、425 个知识点（2026-06-12）。

**关联项目**：
- [mianshi-zhilian-app](https://github.com/nontracey/mianshi-zhilian-app) — 面向终端用户的 App 和官网
- [mianshi-zhilian-studio](https://github.com/nontracey/mianshi-zhilian-studio) — 内容维护工具

## 技术栈

| 技术               | 用途                   |
| ------------------ | ---------------------- |
| Node.js 22         | 脚本运行环境           |
| JSON / JSON Schema | 内容格式与校验 (Ajv)   |
| Cloudflare Pages   | 静态部署               |
| GitHub Actions     | CI/CD: 验证 + 自动部署 |
| Wrangler CLI       | Pages 部署工具         |

## 目录结构

```
/
├── manifest.json              # 正式内容入口（生产环境）
├── staging-manifest.json      # 测试内容入口
├── draft-manifest.json        # 草稿内容入口
├── package.json               # npm 脚本和依赖 (ajv + ajv-formats)
├── schemas/                   # JSON Schema
│   ├── manifest.schema.json
│   ├── domain.schema.json
│   └── topic.schema.json
├── domains/                   # 领域与分类定义 (16个领域)
│   ├── java.json
│   ├── go.json
│   ├── dotnet.json
│   ├── python.json
│   ├── frontend.json
│   ├── database.json
│   ├── devops.json
│   ├── data-engineering.json
│   ├── security.json
│   ├── agent.json
│   ├── algorithm.json
│   ├── design-pattern.json
│   ├── architecture.json
│   ├── os.json
│   ├── network.json
│   └── self-media.json
├── topics/                    # 知识点 JSON (按领域分目录)
│   ├── java/                  # 59 topics
│   ├── go/                    # 12 topics
│   ├── dotnet/                # 35 topics
│   ├── python/                # 25 topics
│   ├── frontend/              # 52 topics
│   ├── database/              # 17 topics
│   ├── devops/                # 14 topics
│   ├── data-engineering/      # 14 topics
│   ├── security/              # 13 topics
│   ├── agent/                 # 30 topics
│   ├── algorithm/             # 70 topics
│   ├── design-pattern/        # 16 topics
│   ├── architecture/          # 19 topics
│   ├── os/                    # 19 topics
│   ├── network/               # 16 topics
│   └── self-media/            # 14 topics
├── staging/                   # 测试环境隔离副本
│   ├── domains/
│   └── topics/
├── draft/                     # 草稿环境隔离副本
│   ├── domains/
│   └── topics/
├── scripts/                   # 生成、校验、质量扫描脚本
│   ├── generate_content.mjs   # 从 Markdown 源生成内容 JSON
│   ├── validate_content.mjs   # Schema + 语义校验
│   ├── sync_environment_content.mjs  # 同步 staging/draft 副本
│   ├── quality_scan.mjs       # 模板文本、泛化追问等质量扫描
│   └── *.py                   # 一次性修复脚本
├── docs/                      # 文档
│   ├── content-format.md      # 详细内容格式规范
│   ├── content-improvement-plan.md
│   ├── knowledge-content-standard.md
│   └── knowledge-directory.md
├── assets/diagrams/           # SVG 图解 + GIF 动画资源 (31 SVG + 5 GIF)
└── .github/workflows/
    ├── deploy-content.yml     # 自动部署到 Cloudflare Pages
    ├── validate.yml           # PR/push 自动校验 + contentVersion 自动管理
    └── codeql.yml             # 安全扫描
```

## 内容结构

### 三层数据模型

```
manifest.json  (入口，包含领域列表 + 版本号)
  └── domains/{domain}.json  (领域定义，包含分类列表)
        └── topics/{domain}/{topic}.json  (具体的知识点)
```

### Topic 格式要求

每个 topic JSON 文件必须包含：

| 字段             | 类型      | 说明                                                                   |
| ---------------- | --------- | ---------------------------------------------------------------------- |
| id               | string    | 格式 `{domain}.{category}.{slug}`，匹配 `^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$` |
| domain           | string    | 所属领域 ID                                                            |
| category         | string    | 所属分类 ID                                                            |
| title            | string    | 知识点标题                                                             |
| summary          | string    | 一句话概述                                                             |
| tags             | array     | 标签（至少1个）                                                        |
| difficulty       | 1-5 int   | 难度等级                                                               |
| estimatedMinutes | int       | 预估学习时长（≥1）                                                     |
| order            | int       | 排序序号                                                               |
| recommendWeight  | 0-100 int | 推荐权重                                                               |
| learningCards    | array     | **必须包含**: explain, interviewAnswer, checklist                      |
|                  |           | **至少一项**: compareTable / diagram / code                            |
| recallPrompts    | array     | 回顾提醒问题 (至少1个, 含 id/prompt/mode)                              |
| rubric           | object    | 评分标准 (mustHave, goodToHave, commonMistakes, scoreWeights 总和=100) |

**可选字段**：prerequisites（前置依赖）、interviewFrequency（high/medium/low）、interviewerFocus、status（production/staging/draft）、group

### learningCard 类型

| 类型            | 用途                     | 必需字段                          |
| --------------- | ------------------------ | --------------------------------- |
| explain         | 知识全景拆解             | type, title, content              |
| interviewAnswer | 面试回答模板             | type, title, content, followUpQuestions (≥1) |
| checklist       | 学习检查项               | type, title, items                |
| compareTable    | 对比边界                 | type, title, columns + rows 或 content |
| code            | 代码抓手                 | type, title, content, language    |
| diagram         | 图解                     | type, title, format (mermaid/svg/image/text), content 或 svgPath/asset |
| animation       | 动画                     | type, title, asset                |

### 三个环境入口

| 文件                    | 用途                         | 指向路径                  |
| ----------------------- | ---------------------------- | ------------------------- |
| `manifest.json`         | 生产环境 - 线上 App 正式使用 | `domains/` + `topics/`    |
| `staging-manifest.json` | 测试环境 - 预发布验证        | `staging/domains/` + `staging/topics/` |
| `draft-manifest.json`   | 草稿环境 - 开发中的内容      | `draft/domains/` + `draft/topics/` |

staging 和 draft manifest 中的 `environment` 字段标识环境类型。调用方必须按 `manifest.domains[].entry` 加载 domain，按 `domain.categories[].topics[]` 加载 topic，不要硬编码路径。

### 16 个领域

| 领域              | topic 数 | 分类                                                                            |
| ----------------- | -------- | ------------------------------------------------------------------------------- |
| Java 核心与中间件 | 59       | java-fundamentals, jvm, concurrency, collections, spring, database, middleware, microservice |
| Go 语言           | 12       | (待确认)                                                                        |
| .NET 开发         | 35       | csharp, dotnet-core, aspnet, ef-core, client, microservice-dotnet, advanced    |
| Python 开发       | 25       | Python 基础, 进阶, 面向对象, 并发, 工程实践, Web 开发, 编码面试                 |
| 前端八股          | 52       | js-fundamentals, typescript, css-layout, react, vue, nodejs, engineering, frontend-architecture, client-dev, network-security |
| 数据库            | 17       | (待确认)                                                                        |
| DevOps 与云原生   | 14       | (待确认)                                                                        |
| 数据工程          | 14       | (待确认)                                                                        |
| 网络安全          | 13       | (待确认)                                                                        |
| Agent 开发        | 30       | llm, embedding-retrieval, rag, agent-architecture, ai-engineering               |
| 算法与数据结构    | 70       | array-list, tree-graph, dynamic-programming, string-search, stack-queue, hash-greedy, backtracking |
| 设计模式          | 16       | creational, structural, behavioral, principles                                  |
| 架构设计          | 19       | methodology, microservice, system-design, project-design                        |
| 操作系统与 Linux  | 19       | 进程线程, 内存管理, IO 模型, Linux 基础                                        |
| 计算机网络        | 16       | TCP/UDP, HTTP/HTTPS, DNS, WebSocket                                             |
| 自媒体运营        | 14       | (待确认)                                                                        |

**总计：425 个知识点**

## 构建和运行

### 本地命令

```bash
npm install              # 安装依赖 (ajv + ajv-formats)
npm run validate         # 校验所有内容：schema 验证 + 语义检查 + 顺序/权重检查
npm run generate         # 从原始 Markdown 源文件重新生成内容 JSON (需 CONTENT_SOURCE_ROOT)
npm run sync:env         # 从正式内容同步生成 staging/draft 隔离副本
npm run quality:scan     # 质量扫描：检查模板文本、泛化追问等
```

### 生成脚本说明

`npm run generate` 需要设置 `CONTENT_SOURCE_ROOT` 环境变量，指向原始 Markdown 源目录。脚本会：

1. 扫描 Markdown 文件，按领域规则自动分类
2. 生成 topic JSON（含 learningCards、recallPrompts、rubric）
3. 生成 domain JSON 和 manifest JSON（含三个环境）
4. 自动清理排期文案（"第X天"、"今日练习与总结"等）
5. 自动同步 staging/draft 隔离副本（调用 `sync_environment_content.mjs`）

### CI/CD — GitHub Actions 工作流

**validate.yml** — 每次 push/PR 触发：

1. `npm ci && npm run validate` — 校验内容
2. PR 检查 contentVersion 不早于当天
3. Fork PR 只允许修改 `draft/` 目录
4. main push 时自动设置 contentVersion 为当天日期（`YYYY.MM.DD`）
5. docs/schemas 变更时触发 Site 仓库重建（需 `SITE_TRIGGER_TOKEN`）
6. 内容契约变更时触发 App 仓库 smoke 测试（需 `APP_TRIGGER_TOKEN`）

**deploy-content.yml** — main 分支 push 触发：

1. `npm ci && npm run validate` — 验证内容
2. 准备 `dist/` 目录（复制 manifest、domains、topics、staging、draft、schemas、assets）
3. 清理 `.DS_Store` 文件
4. `wrangler pages deploy` — 部署到 Cloudflare Pages
5. 验证主备域名内容一致性（pages.dev vs de5.net），比较 manifest 内容并抽样深路径

**正式入口**：

- 主用：<https://mianshizhilian-content.nontracey.de5.net/manifest.json>
- 备用：<https://mianshi-zhilian-content.pages.dev/manifest.json>

主备域名必须绑定到同一份 Cloudflare Pages 内容产物，所有 manifest、domains、topics、schemas、assets 路径保持一一对应。

**必需配置**（GitHub Secrets/Variables）：

- `CLOUDFLARE_API_TOKEN` — 需要 `Cloudflare Pages:Edit` 权限
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare 账号 ID
- `SITE_TRIGGER_TOKEN` — 触发 Site 仓库重建（可选）
- `APP_TRIGGER_TOKEN` — 触发 App 仓库 smoke 测试（可选）

## 开发约定

### 版本管理（自动）

- **无需手动修改 contentVersion**。`main` 分支 push 时 CI 会自动将三个 manifest 的 `contentVersion` 设为当天日期（`YYYY.MM.DD`），已是当天则跳过
- App 通过版本号检测内容更新，版本不变则使用本地缓存

### Topics 路径约定

`domains/{domain}.json` 中分类的 `topics` 数组：

- 必须是**相对文件路径**：`topics/{domain}/{filename}.json`
- 不能是 topic ID 字符串或 dict 对象
- staging/draft 环境路径带前缀：`staging/topics/{domain}/{filename}.json`、`draft/topics/{domain}/{filename}.json`
- schema 正则约束：`^(?:(?:staging|draft)/)?topics/[a-z0-9-]+/.+\.json$`

### 创建新领域步骤

1. 创建领域 JSON: `domains/{domain}.json`（categories.topics 先留空 `[]`）
2. 生成知识点文件: `topics/{domain}/{filename}.json`
3. 重建 topics 数组：扫描 `topics/{domain}/` 目录，按 order 排序后写回路径
4. 更新 `manifest.json` 的 topicCount
5. 运行 `npm run validate` 验证

### 内容结构同步规则

内容结构变更（新增/删除领域/分类/知识点、修改字段）须同步更新：

1. **内容维护平台**（本仓库）：文件、manifest、schema、文档
2. **内容平台**（独立项目）：内容文件、topics 目录、CI 配置
3. **App 平台**（移动端）：内容解析逻辑、缓存机制、版本检测
4. **Site 站点**：自定义内容章节的解析/渲染逻辑

### 校验检查项（validate_content.mjs）

1. JSON Schema 验证（manifest / domain / topic）
2. 禁止排期文案（"第X天"、"Day X"、"今日练习与总结"）
3. code 卡片禁止 ASCII 画图字符（`┌┐└┘├┤┬┴┼│─═╔╗╚╝╠╣╦╩╬` 等）
4. interviewAnswer 禁止行内编号列表（`1）` / `1.`）
5. 语义检查：`今日笔记`、`面试话术`、泛化追问模板等
6. topic ID 全局唯一、domain/category 引用一致性
7. 必须包含 explain / interviewAnswer / checklist 卡片
8. 至少一项 compareTable / diagram / code 深度卡片
9. rubric.scoreWeights 四维总和必须为 100
10. topic 文件必须被 domain category 引用（孤儿文件检查）
11. 顺序/权重合理性（order 重复、降序、低频高权重、高频低权重）
12. 图解卡资源必须存在（svgPath/asset 指向的文件必须在仓库中）
13. 图解卡 fallback/content 禁止"建议用…"占位文字
14. mermaid 语法限制：只允许 App 轻量解析器支持的子集（flowchart/graph + 基本边，禁止 subgraph/classDef/style/labeled-dotted-edges 等）

### 提交约定

- **禁止中文顿号 `、`** 在 commit message 中（Cloudflare Pages API 不兼容），使用英文逗号 `,` 替代
- Fork PR 仅允许修改 `draft/` 目录

### App 缓存机制

```dart
// 每次启动比较 contentVersion
if (remoteVersion != localVersion) {
  // 清除缓存，重新加载所有内容
}
```

用户也可手动：**个人中心 → 知识源配置 → 应用并重载**

## 图解资源

`assets/diagrams/` 下存放 SVG 图解和 GIF 动画：

- **SVG 图解**（31 个）：`01-jvm-runtime-data-area.svg` ~ `31-distributed-transaction.svg`
- **GIF 动画**（5 个）：`anim-bfs-grid.gif`、`anim-binary-search.gif`、`anim-fast-slow-cycle.gif`、`anim-sliding-window.gif`、`anim-two-pointers.gif`

topic 的 diagram 卡片通过 `svgPath` 或 `asset` 字段引用这些资源。引用的资源必须实际存在，否则校验报错。
