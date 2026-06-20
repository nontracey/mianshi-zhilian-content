# 内容精修器（v3，API 模式）

精修器用于替代过去的 CI LLM 评分报告流程。CI 现在只跑确定性校验：`npm run ci:static`。LLM 质量检查和内容重写由维护者在本机按需运行精修器完成。

> **v3 重大变更**（2026-06-17）：CLI 调度路径全部删除，统一走 OpenAI 兼容 API；流式 SSE + token 实时显示；额度耗尽全局暂停闸（手动 / 自动探活 / 跳过三种策略）；内置模型清单只保留当前默认免费/限额在线链路，额外模型用 `.env` 分组变量显式加入；所有默认值都在 `.env`，交互向导一路回车即可开跑。9 维度评分、反刷分、keep-best、块合并、空转看门狗、确定性门禁全部保留。
>
> **v3.1 标准同步**（2026-06-19）：统一标准版本为 `knowledge-content-standard-v1.1`。判官新增 `diagramModalityFinding`，专门评估 SVG / Mermaid / compareTable / code/text / none 哪种图解形态更适合 topic；不是每篇都必须配图，已有承载真实机制的 SVG 不得被弱化成 Mermaid，新增 SVG 必须有 mermaid/text 兜底且资源真实存在。正式发布精修目标按 production-strict 口径看齐静态/动态 `95+`，仓库 CI 的 `90` 仍只是最低门禁。
>
> **v3.2 资源池与外部判官**（2026-06-19）：LLM 调用新增统一模型池/队列，按 global / kind / provider / account / model 五层限流；模型清单支持 `.env` 注入免费模型、多账号端点和本地 OpenAI-compatible 模型，并声明 `text/json/image` 能力。动态判官可接入 MCP 视觉 QA 与 MCP 联网事实依据；未配置视觉/联网后端时必须标记 `not_checked`，不能伪造核验结论。
>
> **v3.4 落盘前确定性修复 + 坏图不降级 + 该加图触发 + 模型有效期/QPS**（2026-06-20）：
> ① **落盘前确定性修复**——`checkInvariants` 之前先跑 `repairTopic`：把模型无权改/易写错的机械格式确定性恢复或归一（身份/锁定元数据/difficulty、补回被删字段、强制 `updatedAt`、归一 mermaid 头剥围栏去 `%%{init}%%`、`rubric.scoreWeights` 比例归一到 100），避免一个图头或权重和把整篇昂贵生成丢弃重来。原则：模型只改文字，机械格式由驱动保证而非校验后报错。
> ② **坏图绝不降级成纯文字**——App 渲染优先级固定 SVG>Mermaid>Text，text 只是渲染挂掉的兜底。mermaid 无法挽救时：卡片仍有 SVG → 只修 mermaid 兜底层、保住可能已优化的 SVG；无 SVG → 用原 topic 已上线的有效图恢复；都没有才交给图候选重生或走重试。
> ③ **"该加 SVG"触发**——`shouldTriggerDiagramCandidate` 除 `visualFit=fail`/SVG 被删外，新增判官 `isCurrentFormatFit=false && recommendedFormat=svg` 且精修后仍无 SVG 时也触发专用图生成器：有 diagram 卡则升级、无则插入新卡。质量双闸（`selectBestCandidate` 视觉 score≥50 + 整篇 `acceptByJudge` 回归向量）保证"更差不落盘"。
> ④ **schema 协议容错增强**——`tier=free` 也可用 `LLM_FREE_SCHEMA_MODE` 调起步协议；任何模型"拿到文本但解析不出 JSON"会自动降协议（json_schema→json_object→prompt）重试，弱模型不再在坏协议上空转。
> ⑤ **联网核验优先官方文档**——`FACT_CHECK_PREFER_OFFICIAL_DOCS=true`（默认）按领域→官方文档站点表先发 `site:` 受限查询，权威源排前并打 `authoritative` 标记，summary 提示判官以一手文档为最高证据；`FACT_CHECK_DOC_SITES_JSON` 可扩站点。
> ⑥ **模型有效期 + QPS 通用字段**——任意模型可声明 `*_EXPIRES_AT`（到期自动从可用列表/模型链剔除、`resolveSpec` 抛 availabilityFailure 触发降级，无需手动移除；preflight 打印 `[已过期]`/`[即将过期]`，`MODEL_EXPIRY_WARN_DAYS` 默认 7）和 `*_QPS`（模型池令牌桶限每秒起始速率）。
>
> **v3.3 弱模型 + 内置联网 + 多候选图选优**（2026-06-19）：模型池升级——多账号 round-robin + 故障冷却、`tier=free` 模型自动伸缩并发（连续 3 次成功扩容、连续 2 次 quota/timeout 缩容）；本地模型自动发现（Ollama/vLLM）。内置联网不依赖 MCP——`FACT_CHECK_BACKEND=auto` 时按 Google CSE → Bing → Baidu → Sogou → DuckDuckGo 优先级探测可达后端，国内零配置默认走 Baidu；搜索结果 1h 缓存。多候选图选优——视觉判官 fail 时对坏图产 3 候选（SVG/Mermaid/compareTable），视觉判官打分选最优落盘，全 fail 兜底保留旧版 + stuck 检测；图生成优先 free 模型，付费需 `--allow-paid-diagram` 显式授权。判官看图——`imageUnderstanding: native|mcp|none` 三模式，弱文本模型 + MCP 视觉工具也能"看图"；ensemble 投票 visualFit 多数决 + 维度分歧度告警。成本统计 + token 预算——内置常见模型价格表 + 多模态 token 估算，summary.json 输出成本表，`--max-cost-per-run` 超限优雅停止。运行时韧性——MCP 故障隔离、模型能力启动探测、启动 preflight 彩色能力表、`--profile=quick|deep|offline` 三预设、`--health-port` HTTP 端点、state.json 持久化 + `--resume` 续跑。

## 推荐入口

优先使用交互式启动器：

```bash
npm run quality:refine:interactive
```

也可以直接执行脚本：

```bash
./scripts/quality_refine_interactive.sh
```

首次运行需要先把 secret 灌进 `.env`：

```bash
cp .env.example .env
node scripts/llm/seed-env.mjs           # 从 ~/.qwen/settings.json 的 env 段把 API key 写入,不覆盖已填值
node scripts/llm/seed-env.mjs --upgrade-defaults  # 把 .env 里的旧默认值升级到 v3
```

交互器会依次选择：

1. 同步阶段：全部、仅测试、仅草稿。
2. 运行模式：正式精修、测试预览、仅审计。
3. 领域：全部、单领域、多领域。
4. Topic：列出所选领域内全部 topic；正式模式可选全部、多个编号、范围、随机或手动路径；测试预览只选单篇，直接回车会随机一篇。
5. 执行参数：合格分、并发、轮数、limit、重试、超时、降级阈值、**额度耗尽行为**（manual / auto-probe / skip）。
6. 精修模型链：默认走 `.env REFINE_MODEL_CHAIN`（默认 `zhipu:glm-4.7-flash,longcat:LongCat-2.0-Preview`），回车即可；老手可手选或自定义。
7. 判官模型：默认走 `.env JUDGE_MODEL_CHAIN`（默认 `longcat:LongCat-2.0-Preview,zhipu:glm-4.7-flash`），回车即可；可多选组成 ensemble，或选 0 关闭判官。deep 严格启动下不建议关闭判官。
8. 判官参数：投票数、动态免改线、批量大小、预热并发。
9. 确认。

每一步都支持：

- `b`、`back`、`上一步`、`返回`：回到上一层。
- `q`、`quit`、`退出`、`取消`：退出。
- 任何参数填好后，下次启动器会问要不要复用上次配置；想直接开跑就回车 Yes。

## 核心原则

- **API 模式独占**。所有 LLM 调用统一走 `scripts/llm/runner.mjs` → `openai-runner.mjs`，无任何 CLI 子进程；模型清单在 `scripts/llm/env-config.mjs`，默认只启用 `zhipu:glm-4.7-flash` 与 `longcat:LongCat-2.0-Preview`，spec 格式 `<provider>:<modelId>`。
- 一次精修一个 topic（API 调用，无子进程隔离需求）。领域或多 topic 选择只是队列。
- 并发表示同时跑多个精修请求；遇到限流/超时/5xx 自动收敛到 `--auto-concurrency-min`。
- **流式 SSE**：每个调用默认 `stream:true`，token 实时刷在固定栏的子 agent 行（含 `tok N · 最新一行`）；不支持流式的 provider 自动回退非流式。
- **schema 自适应**：强模型先尝试 `response_format=json_schema`（strict）；`tier=weak` 默认从 `json_object` 起步，`tier=free` 可用 `LLM_FREE_SCHEMA_MODE` 调（默认仍 `json_schema`），本地模型默认从 prompt 注入 schema 起步（可用 `LLM_WEAK_SCHEMA_MODE` / `LLM_LOCAL_SCHEMA_MODE` 调整）。**任何模型一旦"返回了文本但解析不出 JSON"，自动把该 spec 的协议降一级（json_schema→json_object→prompt）重试**，弱模型不再在坏协议上空转。这只影响输出协议容错，不放宽本地 schema 不变量、静态审计、判官和 keep-best 验收。
- **落盘前确定性修复（repairTopic）**：候选过 `checkInvariants` 之前先做确定性修复——恢复身份/锁定元数据/difficulty、补回被删顶层字段、强制 `updatedAt`、归一 mermaid 头（剥 ``` 围栏、去 `%%{init}%%`/注释、bare flowchart 补方向）、`rubric.scoreWeights` 比例归一到 100；坏 mermaid 优先恢复原有效图（绝不降级成纯文字）。目的是让失败只因"内容不够好"，不因"少个图头/权重和不对/漏改日期"丢弃整轮。
- **额度耗尽行为可选**：
  - `manual`（默认）：429/402/quota 关键词命中时全局 `pauseBus.pause()`，所有 worker 阻塞；用户在终端按 Enter 继续 / `a` 切自动探活 / `s` 跳过当前篇 / `p` 切回手动。
  - `auto-probe`：按 `QUOTA_PROBE_BACKOFF_MS=60s,2m,5m,10m` 退避周期对暂停的 spec 发 1-token 探针，恢复即自动 resume。
  - `skip`：本篇标记 `quota-skip`，跳下一篇继续。
- **模型降级链**：连续 N 次（`LLM_DEGRADE_AFTER`，10min 滑窗）可用性失败才降到下一 spec；配额错误不计入降级（避免把暂停吞掉）。
- **严格启动**：`QUALITY_REFINE_STRICT_STARTUP=true` 时（deep 默认），启动会先按目标 topic 检查能力：必须有动态判官，必须有联网事实核验；目标集含 SVG 时必须有视觉 MCP 或 image-capable 视觉模型；目标集含 diagram/animation 且图候选开启时必须有可用 free 图模型或显式 `--allow-paid-diagram`。能力不够直接退出，避免“跑起来但少一块质量闸”。
- **模型池 / 队列**：外层 `--concurrency` 只控制 topic 并发；所有 LLM 请求还会进入 `scripts/llm/model-pool.mjs`，按 `LLM_POOL_GLOBAL_CONCURRENCY`、`LLM_POOL_KIND_*`、`LLM_POOL_PROVIDER_*`、`LLM_POOL_ACCOUNT_*`、`LLM_POOL_MODEL_*` 五层限流。免费模型、多账号和本地模型可以各自设置更小并发，避免额度或本机性能被打爆。
- **自定义模型**：日常用 `LLM_CUSTOM_MODELS` + `LLM_MODEL_<别名>_*` 分组变量加入本地 Ollama/vLLM、免费 API、多账号端点；复杂批量导入再用 `LLM_MODELS_JSON` / `LLM_MODELS_FILE`。模型必须声明 `provider`、`id`、`baseUrl`，可选 `apiKeyEnv`、`apiKeyOptional`、`local`、`modality`、`accounts`、`maxContext`、`maxOutputTokens`、`autoScale`、`imageUnderstanding`、`pricePerMtok`、`maxConcurrency`、`qps`、`expiresAt`。`modality` 含 `image` 或显式 `imageUnderstanding=mcp/native` 的模型才允许参与视觉链路。其中 `id` 必须是接口真实模型 id（如某些网关需从 `/models` 取，不能用展示名）。
- **模型有效期与限流（通用，不写死代码）**：`LLM_MODEL_<别名>_EXPIRES_AT`（`YYYY-MM-DD` 含当天全天，或 ISO 时间戳）声明限时 key 的有效期——到期后该模型自动从 `listModels`/模型链剔除、`resolveSpec` 抛 `availabilityFailure` 使链自动降级到下一个模型，**无需手动移除**；preflight 能力表打印 `[已过期]`/`[即将过期]`（`MODEL_EXPIRY_WARN_DAYS` 默认 7 天）。`LLM_MODEL_<别名>_QPS` 用模型池令牌桶限每秒起始速率，`LLM_MODEL_<别名>_MAX_CONCURRENCY` 限模型层并发。彻底清理只需删该别名的 `.env` 块或从 `LLM_CUSTOM_MODELS` 去掉别名。
- 启用判官时，第一轮先对 scope 内 topic 做判前评审，按 `contentHash` 缓存。
- 静态分数是地板，判官分数是语义天花板。两者都达标且所有维度均不低于 4 才直接跳过改写。
- 内容深度对标真实职级：技术域写到 **P7/P7+（资深/专家）** 的纵深。判官的 `seniorityDiscrimination`（区分度天花板）维度专门把关：difficulty≥3 缺"为什么这样设计 / 如何排查 / 取舍 / 极端场景"会被压分；rubric 内嵌代码、纯线性关键词链假图直接判 fail。
- 图解形态是独立门禁：不是每个 topic 都必须有 SVG、Mermaid 或其他 diagram；SVG 不是天然高级，Mermaid 不是天然降级。算法/空间状态/多步骤机制确实需要图解时优先 SVG；协议交互优先 sequenceDiagram；状态机优先 stateDiagram；架构边界优先 flowchart/graph+subgraph；概念对比优先 compareTable。判官必须输出 `diagramModalityFinding`，落盘前也会阻断 SVG-only 无兜底、新增 SVG 资源不存在、已有机制型 SVG 被删除且信息量退化等问题。
- 文本模型不能假装看见图片。判官只能评估图源码和图文语义；重叠、裁切、显示不全、文字过密等视觉问题由 `quality_visual_judge.mjs` 静态 QA、MCP 视觉工具或 image-capable LLM 评估。没有视觉报告时，判官应把 `visualFit` 标为 `not_checked`。
- Agnes MCP 的 `visual_judge` 会先把 SVG artifact 用本机 `qlmanage` 渲成 PNG，再交给 Agnes 视觉模型；Agnes Image 模型只用于 `image_generate` 生图，不当视觉判官。
- 全面精修建议开启联网事实依据；deep 严格启动会要求 `FACT_CHECK_ENABLED=true` 且后端可用。内置 `FACT_CHECK_BACKEND=auto` 可零配置探测 Baidu/Sogou/DuckDuckGo，也可配置 MCP。外部事实工具返回 wrong/outdated 时，会合并进 `factFindings` 与 `blockingFindings`。
- **优先官方文档核验**：`FACT_CHECK_PREFER_OFFICIAL_DOCS=true`（默认）按领域→官方文档站点表（`scripts/web/authoritative-sources.mjs`，如 java→docs.oracle.com/openjdk、frontend→react.dev/MDN、k8s→kubernetes.io、RFC/OWASP 等）先发 `site:` 受限查询与"官方文档"关键词加权查询，权威源排前并给 source 标 `authoritative`，summary 提示判官以一手官方文档为最高证据（版本/默认值/复杂度/API 行为以官方为准）。`FACT_CHECK_DOC_SITES_JSON` 可追加/覆盖站点表。
- 候选会先跑 invariant、静态审计和判后评审，再用回归向量决定整篇接受、保留旧版，或只合并变好的块。
- **CI 仍只跑确定性门禁**：阈值仍是 `90`，不会调用 LLM 判官；但 `scripts/content_quality_audit.mjs` 已纳入图解兜底、SVG 资源和空间/状态型假图的部分静态检查。精修器以确定性审计为最低验收线，以动态判官补足事实、深度和图解形态判断。
- **CI 不启动精修链路**：`npm run ci:static` 只做 `node --check`、精修器纯函数/候选/视觉静态单测、`validate`、`quality:scan`、`quality:audit`。它不会探测模型、联网、MCP、视觉后端或启动真实改写。
- 按 `Ctrl-C` 中断当前精修；再次按强制退出。

## 内容契约与运行产物

v3.3 没有改变 App / Studio 读取的 topic 顶层结构，`schemaVersion` 仍按兼容新增字段处理。精修器只能落盘现有 `learningCards` 契约：`diagram.sources[]` 的 `kind` 为 `svg`、`mermaid`、`text`；`compareTable` 必须是独立卡片，不能写成 `diagram.sources`。

跨端约定：

- `svg.path`：指向 `assets/` 下真实存在的资源文件，App 加载资源，Studio 展示路径。
- `svg.content`：真正的内联 SVG，必须以 `<svg` 开头；App 用 inline SVG 渲染，Studio 展示源码。
- `mermaid.content` / `text.content`：只走 `content`，不走 `path`。
- `summary.json`、`v33-state.json`、`progress.jsonl` 是 `.quality-refine/` 下的本地运行产物，不会部署给 App；v3.3 新增的 `cost`、`poolHealth`、`mcpHealth`、`budgetExceeded`、`diagramStates` 等字段只服务续跑、TUI 和人工排障。

## 子 agent 行（固定栏，summary + TTY 模式）

```
├─ active workers (3) ────────────────────────
 · java/concurrent/synchronized       生成   12s · glm-4.7-flash@zhi · tok 1820 · 改 interviewAnswer.followUpQuestions[0]…
 · go/context-cancel                  判前    3s · LongCat-2.0-Preview@lon · tok 540 · 评估 explainCards[2]
 · python/decorator-factory           判后   45s · ⏸ 暂停(额度耗尽 longcat:LongCat-2.0-Preview)
```

每行实时刷新 `tok` 数和最新一行；`⏸` 表示该 worker 因配额暂停闸阻塞中。

## .env 关键配置

```bash
# Secrets
ZHIPU_API_KEY=
LONGCAT_API_KEY=
AGNES_API_KEY=

# 模型链：精修默认 GLM-4.7-Flash，判官默认 LongCat；二者互为兜底。
REFINE_MODEL_CHAIN=zhipu:glm-4.7-flash,longcat:LongCat-2.0-Preview
JUDGE_MODEL_CHAIN=longcat:LongCat-2.0-Preview,zhipu:glm-4.7-flash
BLOCK_JUDGE_MODEL_CHAIN=zhipu:glm-4.7-flash,longcat:LongCat-2.0-Preview

# 自定义模型池：免费模型、多账号、本地模型。日常不需要写 JSON。
LLM_CUSTOM_MODELS=ollama_14b
LLM_MODEL_OLLAMA_14B_PROVIDER=ollama
LLM_MODEL_OLLAMA_14B_ID=qwen2.5:14b
LLM_MODEL_OLLAMA_14B_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL_OLLAMA_14B_TIER=local
LLM_MODEL_OLLAMA_14B_LOCAL=true
LLM_MODEL_OLLAMA_14B_API_KEY_OPTIONAL=true
LLM_MODEL_OLLAMA_14B_MODALITY=text,json
LLM_MODEL_OLLAMA_14B_MAX_CONTEXT=32768
LLM_MODEL_OLLAMA_14B_MAX_OUTPUT_TOKENS=8192
LLM_MODELS_JSON=
LLM_MODELS_FILE=

# 限时多模态在线模型示例（讯飞星火 MaaS：图片理解+文本）。ID 用接口 /v2/models 返回的真实 id。
# 有效期到点后自动从模型链剔除、无需手动移除；并发/QPS 由模型池限。
XF_MAAS_API_KEY=
# LLM_CUSTOM_MODELS=xf_qwen3            # 与上面的别名合并成一行逗号分隔
LLM_MODEL_XF_QWEN3_PROVIDER=xfyun
LLM_MODEL_XF_QWEN3_ID=xopqwen36v35b
LLM_MODEL_XF_QWEN3_BASE_URL=https://maas-api.cn-huabei-1.xf-yun.com/v2
LLM_MODEL_XF_QWEN3_API_KEY_ENV=XF_MAAS_API_KEY
LLM_MODEL_XF_QWEN3_TIER=free
LLM_MODEL_XF_QWEN3_MODALITY=text,json,image
LLM_MODEL_XF_QWEN3_IMAGE_UNDERSTANDING=native
LLM_MODEL_XF_QWEN3_MAX_CONCURRENCY=100
LLM_MODEL_XF_QWEN3_QPS=100
LLM_MODEL_XF_QWEN3_EXPIRES_AT=2026-06-30
MODEL_EXPIRY_WARN_DAYS=7              # preflight 提前几天提示模型即将过期

# 模型池限流：topic 并发之外的资源治理
LLM_POOL_GLOBAL_CONCURRENCY=8
LLM_POOL_KIND_REFINE=4
LLM_POOL_KIND_JUDGE=4
LLM_POOL_KIND_BLOCK_JUDGE=4
LLM_POOL_KIND_VISION_JUDGE=1

# 额度行为
QUOTA_PAUSE_DEFAULT=manual                     # manual | auto-probe | skip
QUOTA_PROBE_BACKOFF_MS=60000,120000,300000,600000

# MCP 与外部判官。工具引用仍是 server:tool。
MCP_SERVERS=agnes
MCP_SERVER_AGNES_COMMAND=node
MCP_SERVER_AGNES_ARGS=scripts/mcp/agnes-image-server.mjs
MCP_SERVER_AGNES_TIMEOUT_MS=120000
MCP_SERVERS_JSON=
MCP_SERVERS_FILE=
VISION_JUDGE_ENABLED=true
VISION_JUDGE_MCP_TOOL=
VISION_JUDGE_MCP_TOOLS=agnes:visual_judge
VISION_JUDGE_MODEL_CHAIN=
AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
AGNES_IMAGE_MODEL=agnes-image-2.1-flash
AGNES_VISION_MODEL_CHAIN=agnes-1.5-flash,agnes-2.0-flash
AGNES_RENDER_SVG_TO_PNG=true
AGNES_RENDER_SIZE=1024
AGNES_RENDER_TIMEOUT_MS=15000

FACT_CHECK_ENABLED=true
FACT_CHECK_BACKEND=auto
FACT_CHECK_MCP_TOOL=
FACT_CHECK_RECENCY_DAYS=1095
FACT_CHECK_PREFER_OFFICIAL_DOCS=true            # 先官方文档：site: 受限查询 + 权威源排前
FACT_CHECK_DOC_SITES_JSON=                       # 可选：{"<领域或关键词>":["site1","site2"]} 追加/覆盖站点表
QUALITY_REFINE_STRICT_STARTUP=true

# schema 协议容错（弱/免费模型）：解析不出 JSON 会自动降协议重试，不放宽验收
LLM_FREE_SCHEMA_MODE=json_schema                # 免费在线模型起步协议；可改 json_object
# LLM_WEAK_SCHEMA_MODE=json_object  LLM_LOCAL_SCHEMA_MODE=prompt

# 流式日志
LLM_STREAM=true
LLM_LIVE_EVENTS=                                # 留空只渲染 TUI；填路径同时写 JSONL(未来 web shell)
SUBAGENT_LAST_LINE_MAX=80

# 内容卡片降级链 / Mermaid 解禁（app 已支持复杂图种）
REFINE_ALLOW_COMPLEX_MERMAID=true

# 交互向导默认值(填满后回车直达确认)
DEFAULT_SCOPE=failing
DEFAULT_LIMIT=20
DEFAULT_MAX_ROUNDS=3
DEFAULT_CONCURRENCY=4
DEFAULT_MIN_SCORE=95
DEFAULT_USE_JUDGE=true
DEFAULT_JUDGE_COUNT=1
DEFAULT_TEST_RUN=false
```

分组变量命名规则：

- `LLM_CUSTOM_MODELS=ollama_14b,qwen_long` 只负责列出启用的自定义模型别名。
- 每个模型写 `LLM_MODEL_<别名>_PROVIDER/ID/BASE_URL/TIER/MODALITY/...`；别名会自动转成大写下划线。
- 多账号写 `LLM_MODEL_<别名>_ACCOUNTS=a,b`，再分别写 `LLM_MODEL_<别名>_ACCOUNT_A_API_KEY_ENV=...`。
- MCP 写 `MCP_SERVERS=agnes,browser`，再分别写 `MCP_SERVER_AGNES_COMMAND/ARGS/TIMEOUT_MS`。
- JSON 入口只作为高级兜底，适合一次性导入很多模型或传复杂 `extraParams`。

本地视觉模型示例（OpenAI-compatible，例如 vLLM 网关）：

```bash
LLM_CUSTOM_MODELS=ollama_14b,local_vision
LLM_MODEL_LOCAL_VISION_PROVIDER=local-vision
LLM_MODEL_LOCAL_VISION_ID=qwen2.5-vl
LLM_MODEL_LOCAL_VISION_BASE_URL=http://127.0.0.1:8000/v1
LLM_MODEL_LOCAL_VISION_TIER=local
LLM_MODEL_LOCAL_VISION_LOCAL=true
LLM_MODEL_LOCAL_VISION_API_KEY_OPTIONAL=true
LLM_MODEL_LOCAL_VISION_MODALITY=text,json,image
LLM_MODEL_LOCAL_VISION_IMAGE_UNDERSTANDING=native
LLM_MODEL_LOCAL_VISION_AUTOSCALE_ENABLED=false
LLM_MODEL_LOCAL_VISION_AUTOSCALE_MAX=1
```

然后可配置：

```bash
VISION_JUDGE_ENABLED=true
VISION_JUDGE_MCP_TOOLS=agnes:visual_judge
FACT_CHECK_ENABLED=true
FACT_CHECK_BACKEND=auto
```

当前仓库是“单 topic 精修 / 单 topic 判官”粒度。抽样统计 `topics/` 下最大 topic 约 2.4 万字符，粗估不到 1 万 token；加上精修 prompt、9 维 rubric、事实摘要和视觉摘要，`glm-4.7-flash` 的 200K 上下文足够当前一篇文章闭环。只有未来把“整领域 / 多篇 topic”塞进同一次 LLM 请求，或单 topic 粗估超过 12 万 token 时，才需要先按 `learningCards` 分块评审、块级改写，再用整篇合并判官复审。

## 常用命令（直接 CLI）

仅审计：

```bash
npm run quality:refine -- --audit-only --scope domain:go --min-score 95
```

正式精修一个领域，模型链全 .env 默认：

```bash
npm run quality:refine -- \
  --scope domain:go \
  --concurrency 3 \
  --max-rounds 3 \
  --retries 1 \
  --timeout-ms 600000 \
  --judge-count 1 \
  --dynamic-skip-min 95 \
  --judge-batch-size 5 \
  --judge-warm-concurrency 3 \
  --min-score 95
```

正式精修多个指定 topic：

```bash
npm run quality:refine -- \
  --scope domain:go \
  --topics topics/go/context.json,topics/go/interface.json \
  --concurrency 1 \
  --max-rounds 3 \
  --min-score 95
```

直接使用 `quality:refine` 只负责改 `topics/`。需要同步测试或草稿环境时，手动运行：

```bash
node scripts/sync_environment_content.mjs all
node scripts/sync_environment_content.mjs staging
node scripts/sync_environment_content.mjs draft
```

交互式启动器会在正式精修成功后自动执行对应同步。

## 模型 spec 与降级链

当前内置 spec（`scripts/llm/env-config.mjs`）：

```
zhipu:glm-4.7-flash
longcat:LongCat-2.0-Preview
```

凭据通过 `.env` 的 `ZHIPU_API_KEY` / `LONGCAT_API_KEY` 提供。运行时 `discover_models` 只列出有 key 或 `apiKeyOptional=true` 的 spec。内置 Zhipu 链路默认传 `thinking.type=disabled`，把预算留给可解析 JSON；需要深思版时用 `LLM_CUSTOM_MODELS` 另配一个别名。其它免费、本地或付费模型不要写 JSON，优先用 `LLM_CUSTOM_MODELS` + `LLM_MODEL_<别名>_*` 分组变量加入；复杂批量导入才用 `LLM_MODELS_JSON` / `LLM_MODELS_FILE`。

## 进度与产物

正式精修在 summary + TTY 下显示固定栏（含 `active workers` 子 agent 行带 token / lastLine），其它模式回退滚屏。

每次运行的中间产物在 `.quality-refine/<runId>/`：

- `progress.jsonl`：逐 topic 进度。
- `summary.json`：最终汇总。
- `judge-cache/`：按 `contentHash + rubricVersion + judgeSetHash` 缓存判官结果。

`.quality-refine/` 是本地运行产物，已在 `.gitignore` 中忽略。

## 与 CI 的关系

CI 不再运行 LLM 评分、也不要求提交 `.quality-review/reports/`。当前 CI 只负责：

```bash
npm run ci:static
```

本地 pre-commit hook 也是快速确定性门禁。真正的语义质量、事实正确性、专家口吻和面试可用性，改由维护者人工触发精修器来把关。
