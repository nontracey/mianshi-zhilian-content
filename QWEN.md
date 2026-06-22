# 面试智练内容仓库 (mianshi-zhilian-content)

## 项目概述

面试智练的公共知识内容源。这是一个 **JSON 内容分发仓库**，通过 GitHub Actions + Wrangler CLI 部署为 Cloudflare Pages 静态站点，供移动端 App 消费。App 通过 `manifest.json` 发现领域、分类、知识点和资源；新增/修改知识无需改动 App 代码。

**核心原则**：App 是内容驱动的，用户侧知识结构只有"领域 -> 分类 -> 知识点"三层。不使用阶段、天数或排期概念。

**当前规模**：16 个领域、425 个知识点（`manifest.json` 中 `contentVersion: 2026.06.12`）。

**关联项目**：
- [mianshi-zhilian-app](https://github.com/nontracey/mianshi-zhilian-app) — 终端 App 和官网
- [mianshi-zhilian-studio](https://github.com/nontracey/mianshi-zhilian-studio) — 内容维护工具

## 技术栈

| 技术                | 用途                                                    |
| ------------------- | ------------------------------------------------------- |
| Node.js 22 (ESM)    | 脚本运行环境（`package.json` 中 `"type":"module"`）     |
| JSON / JSON Schema  | 内容格式与校验（`ajv` + `ajv-formats`，Draft 2020-12）  |
| Cloudflare Pages    | 静态部署                                                |
| GitHub Actions      | CI/CD：验证 + 自动部署                                  |
| Wrangler CLI        | Cloudflare Pages 部署工具                               |

仓库无运行时依赖，仅 `devDependencies`：`ajv@^8.17.1`、`ajv-formats@^3.0.1`。

## 目录结构

```
/
├── manifest.json              # 正式内容入口（生产环境）
├── staging-manifest.json      # 测试内容入口
├── draft-manifest.json        # 草稿内容入口
├── package.json               # npm 脚本和依赖
├── .gitmessage                # commit message 模板
├── .githooks/                 # 本地 git hooks（pre-commit / commit-msg）
├── schemas/                   # JSON Schema (Draft 2020-12)
│   ├── manifest.schema.json
│   ├── domain.schema.json
│   └── topic.schema.json
├── domains/                   # 16 个领域与分类定义
├── topics/                    # 425 个知识点 JSON（按领域分目录）
│   ├── java/ (59) ├── go/ (12) ├── dotnet/ (35) ├── python/ (25)
│   ├── frontend/ (52) ├── database/ (17) ├── devops/ (14)
│   ├── data-engineering/ (14) ├── security/ (13) ├── agent/ (30)
│   ├── algorithm/ (70) ├── design-pattern/ (16) ├── architecture/ (19)
│   ├── os/ (19) ├── network/ (16) └── self-media/ (14)
├── staging/                   # 测试环境隔离副本（domains/ + topics/）
├── draft/                     # 草稿环境隔离副本（domains/ + topics/）
├── assets/diagrams/           # 33 个 SVG 图解 + 5 个 GIF 动画
├── scripts/                   # 生成、校验、质量脚本
│   ├── generate_content.mjs            # 从 Markdown 源生成内容 JSON
│   ├── sync_environment_content.mjs    # 同步 staging/draft 副本
│   ├── validate_content.mjs            # Schema + 语义校验
│   ├── quality_scan.mjs                # 模板/泛化文本扫描
│   ├── content_quality_audit.mjs       # 确定性 9 维质量打分（0-100）
│   ├── quality_gate_staged.mjs         # pre-commit 暂存 topic 门禁
│   └── ci_static_check.mjs             # CI 同款静态门禁
├── docs/                      # 内容规范、知识目录、9 维评分文档
│   ├── content-format.md
│   ├── knowledge-content-standard.md
│   ├── knowledge-directory.md
│   ├── content-improvement-plan.md
│   └── nine-dimension-scoring.md
└── .github/workflows/
    ├── validate.yml         # PR/push 校验 + contentVersion 自动管理 + 触发下游
    ├── deploy-content.yml   # main push 自动部署到 Cloudflare Pages + 主备验证
    └── codeql.yml           # 安全扫描
```

## 内容数据模型

### 三层结构

```
manifest.json
  └── domains/{domain}.json        # 领域定义 + categories[]，每个 category 有 topics[]
        └── topics/{domain}/{file}.json   # 具体知识点
```

### Topic 必需字段（`schemas/topic.schema.json`）

| 字段             | 类型      | 约束                                                                                |
| ---------------- | --------- | ----------------------------------------------------------------------------------- |
| id               | string    | 正则 `^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$`，即 `{domain}.{category}.{slug}`        |
| domain, category | string    | 小写 kebab-case，与父级引用一致                                                     |
| title, summary   | string    | 非空                                                                                |
| tags             | array     | ≥1 项                                                                               |
| difficulty       | int 1-5   |                                                                                     |
| estimatedMinutes | int       | ≥1                                                                                  |
| order            | int       | 排序序号                                                                            |
| recommendWeight  | int 0-100 |                                                                                     |
| learningCards    | array     | 必含 `explain` / `interviewAnswer` / `checklist`，至少一项 `compareTable` / `diagram` / `code` |
| recallPrompts    | array     | ≥1，每条含 `id`、`prompt`、`mode`（text/code/voice）                                |
| rubric           | object    | `mustHave`(≥1) / `goodToHave` / `commonMistakes` / `scoreWeights`，4 项 score 总和 = 100 |

可选字段：`prerequisites`、`interviewFrequency` (high/medium/low)、`interviewerFocus`、`status` (production/staging/draft)、`group`。

### learningCard 类型

| type            | 必需附加字段                                                                            |
| --------------- | --------------------------------------------------------------------------------------- |
| explain         | `content`                                                                               |
| interviewAnswer | `content` + `followUpQuestions` (≥1 条 `question`/`answer`)                             |
| checklist       | `items[]`                                                                               |
| compareTable    | `content` 或 `columns` + `rows`                                                         |
| code            | `content` + `language`，可选 `highlights[].line/note`                                   |
| diagram         | `format` (mermaid/svg/image/text) + `content` 或 `sources[]`，`sources` 支持 `svg.path`/`svg.content`、`mermaid.content`、`text.content`，可有 `fallback`/`caption` |
| animation       | `asset` 或 `sources[]` 降级链                                                           |

mermaid 卡只能使用 App 轻量解析器支持的子集：`flowchart`/`graph` + 方向、`subgraph`、`stateDiagram`、`sequenceDiagram` 和 5 色板 `classDef`。禁止 `classDiagram`/`gantt`/`pie`/`journey`/`erDiagram`/`mindmap`、裸 `style`、`linkStyle`、`click` 和带标签虚线边。

### 三个环境入口

| 入口文件                | 指向                                       | 用途         |
| ----------------------- | ------------------------------------------ | ------------ |
| `manifest.json`         | `domains/` + `topics/`                     | 生产 App     |
| `staging-manifest.json` | `staging/domains/` + `staging/topics/`     | 预发布验证   |
| `draft-manifest.json`   | `draft/domains/` + `draft/topics/`         | 草稿/工作台  |

`staging-` / `draft-` manifest 通过顶层 `environment` 字段标识。**调用方必须按 `manifest.domains[].entry` 加载 domain，再按 `domain.categories[].topics[]` 加载 topic，禁止硬编码路径。**

### 16 个领域

`java` (59) · `go` (12) · `dotnet` (35) · `python` (25) · `frontend` (52) · `database` (17) · `devops` (14) · `data-engineering` (14) · `security` (13) · `agent` (30) · `algorithm` (70) · `design-pattern` (16) · `architecture` (19) · `os` (19) · `network` (16) · `self-media` (14)

各领域分类定义见 `domains/{domain}.json`，分类规则见 README.md「领域分类规则」章节。

## 构建和运行

### 本地命令（来自 `package.json`）

```bash
npm install                             # 安装 ajv + ajv-formats
npm run validate                        # Schema + 语义 + 顺序/权重/资源校验
npm run quality:scan                    # 模板文本、泛化追问质量扫描
npm run quality:audit                   # 确定性质量打分（默认 --min-score=90）
npm run generate                        # 从 Markdown 源生成 JSON（需 CONTENT_SOURCE_ROOT），并自动 sync
npm run sync:env                        # 从正式内容同步 staging/draft 隔离副本
npm run hooks:install                   # 安装 .githooks（每个 clone 一次）
npm run ci:static                       # CI 同款静态门禁：语法 + validate + scan + audit
```

### 校验检查项（`scripts/validate_content.mjs`）

1. JSON Schema 验证（manifest / domain / topic）
2. 禁止排期文案：`第X天` / `Day X` / `第X阶段` / `今日练习与总结`
3. `code` 卡片禁止 ASCII 画图字符（`┌┐└┘├┤┬┴┼│─═╔╗╚╝╠╣╦╩╬`）
4. `interviewAnswer` 禁止行内编号（`1）` / `1.`）
5. topic ID 全局唯一；`domain` / `category` 引用一致
6. 必含 `explain` / `interviewAnswer` / `checklist`，且至少一项 `compareTable` / `diagram` / `code`
7. `rubric.scoreWeights` 4 维总和 = 100
8. 孤儿文件检查：每个 topic 文件必须被 domain category 引用
9. 顺序/权重合理性（order 重复/降序、低频高权重等告警）
10. `diagram` 卡 `svgPath` / `asset` / `sources[].path` 资源必须存在；`svg.content` 必须是内联 `<svg...>`，不能写资源路径；`fallback` / `content` 禁止"建议用…"占位文字
11. mermaid 语法限制：仅 App 解析器支持的子集

### 三环境同步规则

修改正式内容（`topics/`、`domains/`）后必须同步 staging/draft 副本——`npm run generate` 会自动调用 `sync_environment_content.mjs`；手动改动则需 `npm run sync:env`。`status` 字段用于环境隔离，详见 `docs/content-format.md`。

### CI/CD（GitHub Actions）

**`validate.yml`**（PR / push）：
1. `npm ci && npm run validate && npm run quality:scan && npm run quality:audit`
2. PR 检查 `contentVersion` 不早于当天
3. **Fork PR 仅允许修改 `draft/` 目录**
4. main push 时自动把三个 manifest 的 `contentVersion` 设为当天 (`YYYY.MM.DD`)，并以 `github-actions[bot]` 自动 commit + push
5. `docs/` 或 `schemas/` 变更触发 `mianshi-zhilian-site` 仓库 dispatch（需 `SITE_TRIGGER_TOKEN`）
6. 内容契约（schema / manifest / domains / topics / staging / draft）变更触发 App smoke（需 `APP_TRIGGER_TOKEN`）

**`deploy-content.yml`**（main push）：
1. `npm ci && npm run validate && npm run quality:scan && npm run quality:audit`
2. 准备 `dist/`（复制 manifest、domains、topics、staging、draft、schemas、assets）
3. **`find dist -name ".DS_Store" -delete`** 清理 macOS 元数据
4. `wrangler pages deploy dist --project-name=mianshi-zhilian-content`
5. 抓取主备域名 manifest + 抽样 domain/topic/schema/asset 路径，做 `cmp -s` 比对，最多重试 24×10s

**主备入口**（必须返回同一份 dist 产物）：
- 主用：<https://mianshizhilian-content.nontracey.de5.net/manifest.json>
- 备用：<https://mianshi-zhilian-content.pages.dev/manifest.json>

**必需配置**（GitHub Secrets/Variables）：`CLOUDFLARE_API_TOKEN`（Pages:Edit 权限）、`CLOUDFLARE_ACCOUNT_ID`、可选 `SITE_TRIGGER_TOKEN`、`APP_TRIGGER_TOKEN`。

### 本地 git hook（`.githooks/pre-commit`）

仅对**本次暂存**的 `topics/**.json` 做：JSON 可解析 + `quality_gate_staged.mjs` 静态质量分 ≥ 90。历史存量低分文件不连坐。临时跳过：`git commit --no-verify`。`commit-msg` hook 用 `.gitmessage` 模板的中文 `<type>: <描述>` 风格。

## 开发约定

### Topics 路径约定（最常踩坑）

`domains/{domain}.json` 中每个 category 的 `topics[]`：

- 必须是**相对文件路径字符串**：`topics/{domain}/{file}.json`
- 不能是 topic ID、不能是对象、不能省略 `topics/` 前缀
- staging/draft 环境带前缀：`staging/topics/...` / `draft/topics/...`
- schema 正则：`^(?:(?:staging|draft)/)?topics/[a-z0-9-]+/.+\.json$`

### 创建新领域步骤

1. 创建 `domains/{domain}.json`（categories.topics 先空 `[]`）
2. 创建 `topics/{domain}/{file}.json`
3. 重建 topics 数组：扫描目录，按 `order` 排序写回路径
4. 更新 `manifest.json` 的对应 `topicCount`
5. `npm run validate` + `npm run sync:env`

### contentVersion（自动管理）

**禁止手动修改 `contentVersion`**。`main` push 时 CI 会自动设为当天 (`YYYY.MM.DD`)；当天则跳过。App 通过版本号比较来失效本地缓存。

### 提交约定

- commit message 走 `.gitmessage` 模板：`feat` / `fix` / `refactor` / `perf` / `docs` / `chore` / `ci` / `revert`
- **避免中文顿号 `、`**：Cloudflare Pages API 对部分非 ASCII 字符不兼容，CI 会清洗 head_commit.message 但建议尽量用 ASCII（英文逗号 `,` 替代）
- Fork PR 只能改 `draft/`

### 跨项目同步

内容结构变更（schema / 字段语义 / manifest 形状）需同步：
1. 本仓库的 `docs/content-format.md`、`docs/knowledge-content-standard.md`、`docs/knowledge-directory.md`
2. `mianshi-zhilian-app`：内容解析、缓存、版本检测
3. `mianshi-zhilian-studio`：内容管理逻辑
4. `mianshi-zhilian-site`：自定义内容章节渲染

## 9 维评分与静态门禁

CI 通过 `npm run ci:static` 跑确定性静态门禁：脚本语法、`validate`、`quality:scan`、`quality:audit --min-score=90`。`content_quality_audit.mjs` 按 9 维（结构完整性、内容深度、专家证据、讲解清晰度、图示/对比、面试可用性、rubric 评估、模板与语言卫生、区分度天花板）打分，单篇 <90 视为不通过。评分口径与反刷分规则见 `docs/nine-dimension-scoring.md`，agent 审查或改写 topic 时按该文档对照。

pre-commit hook（`scripts/quality_gate_staged.mjs`）对暂存 topic 跑同款静态门禁，历史存量低分不连坐。

## 已知问题与注意事项

- 历史 topic 中存在系统性模板污染（`code.highlights[].note`、`explain` 三段式、`commonMistakes`、`interviewerFocus`、`followUpQuestions`），主要影响 `java`、`agent`、`architecture`、`dotnet`、`frontend`，需按 `docs/nine-dimension-scoring.md` 逐域清理
- 已知少量 P0 JSON/转义错误集中在部分 `dotnet` 和 `java` topic（详见维护者本地审计报告）
- 修改大量 topic 时优先写一次性 Node.js 脚本批量处理，避免逐文件手编出错（参见项目 skill `batch-content-modification-with-scripts`）
