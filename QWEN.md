# 面试智练内容仓库 (mianshi-zhilian-content)

## 项目概述

面试智练的公共知识内容源。这是一个 **JSON 内容分发仓库**，通过 Cloudflare Pages 部署为静态站点，供移动端 App 消费。App 通过 `manifest.json` 发现领域、分类、知识点和资源；新增知识无需修改 App 代码。

**核心原则**：App 是内容驱动的，用户侧知识结构只有"领域 -> 分类 -> 知识点"三层。

**当前规模**：9 个领域、298 个知识点（2026-06-01）。

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
├── package.json               # npm 脚本和依赖
├── schemas/                   # JSON Schema
│   ├── manifest.schema.json
│   ├── domain.schema.json
│   └── topic.schema.json
├── domains/                   # 领域与分类定义 (9个领域)
│   ├── java.json
│   ├── agent.json
│   ├── algorithm.json
│   ├── design-pattern.json
│   ├── frontend.json
│   ├── architecture.json
│   ├── dotnet.json
│   ├── os.json
│   └── network.json
├── topics/                    # 知识点 JSON (按领域分目录)
│   ├── java/
│   ├── agent/
│   ├── algorithm/
│   ├── design-pattern/
│   ├── frontend/
│   ├── architecture/
│   ├── dotnet/
│   ├── network/
│   └── os/
├── scripts/                   # 生成、校验、质量扫描脚本
│   ├── generate_content.mjs
│   ├── validate_content.mjs
│   └── quality_scan.mjs
├── docs/                      # 文档
│   └── content-format.md      # 详细内容格式规范 (~634行)
├── assets/diagrams/           # SVG 图解资源
└── .github/workflows/
    ├── deploy-content.yml     # 自动部署到 Cloudflare Pages
    └── validate.yml           # PR/push 自动校验
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
| id               | string    | 格式 `{domain}.{category}.{slug}`                                      |
| title            | string    | 知识点标题                                                             |
| summary          | string    | 一句话概述                                                             |
| difficulty       | 1-5 int   | 难度等级                                                               |
| estimatedMinutes | int       | 预估学习时长                                                           |
| order            | int       | 排序序号                                                               |
| recommendWeight  | 0-100 int | 推荐权重                                                               |
| learningCards    | array     | **必须包含**: explain, interviewAnswer, checklist                      |
|                  |           | **至少一项**: compareTable / diagram / code                            |
| recallPrompts    | array     | 回顾提醒问题 (至少1个)                                                 |
| rubric           | object    | 评分标准 (mustHave, goodToHave, commonMistakes, scoreWeights 总和=100) |

**可选字段**：prerequisites（前置依赖）、interviewFrequency（high/medium/low）、interviewerFocus、status（production/staging/draft）

### 三个环境入口

| 文件                    | 用途                         |
| ----------------------- | ---------------------------- |
| `manifest.json`         | 生产环境 - 线上 App 正式使用 |
| `staging-manifest.json` | 测试环境 - 预发布验证        |
| `draft-manifest.json`   | 草稿环境 - 开发中的内容      |

staging 和 draft manifest 中的 `environment` 字段标识环境类型。

### 9 个领域

| 领域              | topic 数 | 分类                                                                            |
| ----------------- | -------- | ------------------------------------------------------------------------------- |
| Java 核心与中间件 | 67       | java-fundamentals, jvm, concurrency, spring, microservice, database, middleware |
| Agent 开发        | 26       | llm-foundation, embedding-retrieval, rag, agent-architecture, ai-engineering    |
| 算法与数据结构    | 62       | 数组链表/树图/DP/字符串排序/栈队列/哈希贪心/回溯                                |
| 设计模式          | 14       | 创建型/结构型/行为型/原则                                                       |
| 前端八股          | 49       | JS/TS/CSS/React/Vue/Node.js/工程化/架构/客户端/网络安全                         |
| 架构设计          | 21       | 方法论/微服务/系统设计/项目架构                                                 |
| .NET 开发         | 31       | C#/.NET Core/ASP.NET/EF Core/客户端/微服务/高级                                 |
| 操作系统与 Linux  | 15       | 进程线程/内存管理/IO 模型/Linux 基础                                            |
| 计算机网络        | 13       | TCP/UDP/HTTP/HTTPS/DNS/WebSocket                                                |

**总计：298 个知识点**

## 构建和运行

### 本地命令

```bash
npm install              # 安装依赖 (ajv + ajv-formats)
npm run validate         # 校验所有内容：schema 验证 + 语义检查 + 顺序/权重检查
npm run generate         # 从原始 Markdown 源文件重新生成内容 JSON
npm run quality:scan     # 质量扫描：检查模板文本、泛化追问等
```

### 生成脚本说明

`npm run generate` 需要设置 `CONTENT_SOURCE_ROOT` 环境变量，指向原始 Markdown 源目录。脚本会：

1. 扫描 Markdown 文件，按领域规则自动分类
2. 生成 topic JSON（含 learningCards、recallPrompts、rubric）
3. 生成 domain JSON 和 manifest JSON（含三个环境）
4. 自动清理排期文案（"第X天"、"今日练习与总结"等）

### CI/CD — 两个 GitHub Actions 工作流

**validate.yml** — 每次 push/PR 触发：

```bash
npm ci && npm run validate
```

**deploy-content.yml** — main 分支 push 触发：

1. `npm ci && npm run validate` — 验证内容
2. 准备 `dist/` 目录（复制 manifest、domains、topics、schemas、assets）
3. `wrangler pages deploy` — 部署到 Cloudflare Pages

**正式入口**：

- 主用：<https://mianshi-zhilian-content.pages.dev/manifest.json>
- 备用：<https://mianshizhilian-content.nontracey.de5.net/manifest.json>

主备域名必须绑定到同一份 Cloudflare Pages 内容产物，所有 manifest、domains、topics、schemas、assets 路径保持一一对应。部署后 workflow 会比较 pages.dev 与 de5.net 的 manifest/staging/draft 内容，并抽样验证 domain、topic、schema、asset 深路径。

**必需配置**（GitHub Secrets）：

- `CLOUDFLARE_API_TOKEN` — 需要 `Cloudflare Pages:Edit` 权限
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare 账号 ID

## 开发约定

### 版本管理

- 修改内容后**必须更新**三个 manifest 中的 `contentVersion`（格式 `YYYY.MM.DD`）
- App 通过版本号检测内容更新，版本不变则使用本地缓存
- 批量更新脚本：`python3 -c "..."` 见 README.md

### Topics 路径约定

`domains/{domain}.json` 中分类的 `topics` 数组：

- 必须是**相对文件路径**：`topics/{domain}/{filename}.json`
- 不能是 topic ID 字符串或 dict 对象
- 自动修复工具：`python3 scripts/validate_paths.py --fix`

### 内容结构同步规则

内容结构变更（新增/删除领域/分类/知识点、修改字段）须同步更新：

1. **内容维护平台**（本仓库）：文件、manifest、schema、文档
2. **内容平台**（独立项目）：内容文件、topics 目录、CI 配置
3. **App 平台**（移动端）：内容解析逻辑、缓存机制、版本检测

### 校验检查项（validate_content.mjs）

1. JSON Schema 验证（manifest / domain / topic）
2. 禁止排期文案（"第X天"、"Day X"、"今日练习与总结"）
3. code 卡片禁止 ASCII 画图字符（`┌┐└┘├┤┬┴┼│─` 等）
4. interviewAnswer 禁止行内编号列表（`1）` / `1.`）
5. 语义检查：`今日笔记`、`面试话术`、泛化追问模板等
6. topic ID 全局唯一、domain/category 引用一致性
7. 必须包含 explain / interviewAnswer / checklist 卡片
8. 至少一项 compareTable / diagram / code 深度卡片
9. rubric.scoreWeights 四维总和必须为 100
10. topic 文件必须被 domain category 引用（孤儿文件检查）
11. 顺序/权重合理性（order 重复、降序、低频高权重、高频低权重）

### 提交约定

- **禁止中文顿号 `、`** 在 commit message 中（Cloudflare Pages API 不兼容），使用英文逗号 `,` 替代

### App 缓存机制

```dart
// 每次启动比较 contentVersion
if (remoteVersion != localVersion) {
  // 清除缓存，重新加载所有内容
}
```

用户也可手动：**个人中心 → 知识源配置 → 应用并重载**
