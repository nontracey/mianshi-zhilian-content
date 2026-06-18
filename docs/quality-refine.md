# 内容精修器（v3，API 模式）

精修器用于替代过去的 CI LLM 评分报告流程。CI 现在只跑确定性校验：`npm run validate`、`npm run quality:scan`、`npm run quality:audit`。LLM 质量检查和内容重写由维护者在本机按需运行精修器完成。

> **v3 重大变更**（2026-06-17）：CLI 调度路径全部删除，统一走 OpenAI 兼容 API；流式 SSE + token 实时显示；额度耗尽全局暂停闸（手动 / 自动探活 / 跳过三种策略）；模型清单 `scripts/llm/env-config.mjs` 硬编码 13 个 spec；所有默认值都在 `.env`，交互向导一路回车即可开跑。9 维度评分、反刷分、keep-best、块合并、空转看门狗、确定性门禁全部保留。

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
6. 精修模型链：默认走 `.env REFINE_MODEL_CHAIN`（默认 `volcengine:glm-5.1,volcengine:deepseek-v4-flash`），回车跳过；老手可手选或自定义。
7. 判官模型：默认走 `.env JUDGE_MODEL_CHAIN`（默认 `volcengine:deepseek-v4-pro,volcengine:deepseek-v4-flash`），回车跳过；可多选组成 ensemble，或选 0 关闭判官。
8. 判官参数：投票数、动态免改线、批量大小、预热并发。
9. 确认。

每一步都支持：

- `b`、`back`、`上一步`、`返回`：回到上一层。
- `q`、`quit`、`退出`、`取消`：退出。
- 任何参数填好后，下次启动器会问要不要复用上次配置；想直接开跑就回车 Yes。

## 核心原则

- **API 模式独占**。所有 LLM 调用统一走 `scripts/llm/runner.mjs` → `openai-runner.mjs`，无任何 CLI 子进程；模型清单硬编码在 `scripts/llm/env-config.mjs`（13 个 OpenAI 兼容 spec），spec 格式 `<provider>:<modelId>`。
- 一次精修一个 topic（API 调用，无子进程隔离需求）。领域或多 topic 选择只是队列。
- 并发表示同时跑多个精修请求；遇到限流/超时/5xx 自动收敛到 `--auto-concurrency-min`。
- **流式 SSE**：每个调用默认 `stream:true`，token 实时刷在固定栏的子 agent 行（含 `tok N · 最新一行`）；不支持流式的 provider 自动回退非流式。
- **schema 自适应**：先尝试 `response_format=json_schema`（strict），不支持的端点（如火山方舟）自动降级到 `json_object` 再到 `prompt 注入 schema`，整个 spec 会缓存它能用的 mode 避免重复探测。
- **额度耗尽行为可选**：
  - `manual`（默认）：429/402/quota 关键词命中时全局 `pauseBus.pause()`，所有 worker 阻塞；用户在终端按 Enter 继续 / `a` 切自动探活 / `s` 跳过当前篇 / `p` 切回手动。
  - `auto-probe`：按 `QUOTA_PROBE_BACKOFF_MS=60s,2m,5m,10m` 退避周期对暂停的 spec 发 1-token 探针，恢复即自动 resume。
  - `skip`：本篇标记 `quota-skip`，跳下一篇继续。
- **模型降级链**：连续 N 次（`LLM_DEGRADE_AFTER`，10min 滑窗）可用性失败才降到下一 spec；配额错误不计入降级（避免把暂停吞掉）。
- 启用判官时，第一轮先对 scope 内 topic 做判前评审，按 `contentHash` 缓存。
- 静态分数是地板，判官分数是语义天花板。两者都达标且所有维度均不低于 4 才直接跳过改写。
- 内容深度对标真实职级：技术域写到 **P7/P7+（资深/专家）** 的纵深。判官的 `seniorityDiscrimination`（区分度天花板）维度专门把关：difficulty≥3 缺"为什么这样设计 / 如何排查 / 取舍 / 极端场景"会被压分；rubric 内嵌代码、纯线性关键词链假图直接判 fail。
- 候选会先跑 invariant、静态审计和判后评审，再用回归向量决定整篇接受、保留旧版，或只合并变好的块。
- **CI 静态门禁不变**：`scripts/content_quality_audit.mjs` / `quality_scan.mjs` / `quality_gate_staged.mjs` 全部不动。精修器以确定性审计为唯一验收线。
- 按 `Ctrl-C` 中断当前精修；再次按强制退出。

## 子 agent 行（固定栏，summary + TTY 模式）

```
├─ active workers (3) ────────────────────────
 · java/concurrent/synchronized       生成   12s · glm-5.1@vol · tok 1820 · 改 interviewAnswer.followUpQuestions[0]…
 · go/context-cancel                  判前    3s · ds-v4-pro@vol · tok 540 · 评估 explainCards[2]
 · python/decorator-factory           判后   45s · ⏸ 暂停(额度耗尽 volcengine:glm-5.1)
```

每行实时刷新 `tok` 数和最新一行；`⏸` 表示该 worker 因配额暂停闸阻塞中。

## .env 关键配置

```bash
# 模型链(默认值,精修便宜稳定、判官评分稳)
REFINE_MODEL_CHAIN=volcengine:glm-5.1,volcengine:deepseek-v4-flash
JUDGE_MODEL_CHAIN=volcengine:deepseek-v4-pro,volcengine:deepseek-v4-flash
BLOCK_JUDGE_MODEL_CHAIN=volcengine:glm-5.1,volcengine:deepseek-v4-flash

# 额度行为
QUOTA_PAUSE_DEFAULT=manual                     # manual | auto-probe | skip
QUOTA_PROBE_BACKOFF_MS=60000,120000,300000,600000

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
DEFAULT_MIN_SCORE=90
DEFAULT_USE_JUDGE=true
DEFAULT_JUDGE_COUNT=1
DEFAULT_TEST_RUN=false
```

## 常用命令（直接 CLI）

仅审计：

```bash
npm run quality:refine -- --audit-only --scope domain:go --min-score 90
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
  --dynamic-skip-min 85 \
  --judge-batch-size 5 \
  --judge-warm-concurrency 3 \
  --min-score 90
```

正式精修多个指定 topic：

```bash
npm run quality:refine -- \
  --scope domain:go \
  --topics topics/go/context.json,topics/go/interface.json \
  --concurrency 1 \
  --max-rounds 3 \
  --min-score 90
```

直接使用 `quality:refine` 只负责改 `topics/`。需要同步测试或草稿环境时，手动运行：

```bash
node scripts/sync_environment_content.mjs all
node scripts/sync_environment_content.mjs staging
node scripts/sync_environment_content.mjs draft
```

交互式启动器会在正式精修成功后自动执行对应同步。

## 模型 spec 与降级链

支持的 13 个 spec（`scripts/llm/env-config.mjs`）：

```
volcengine:deepseek-v4-flash    volcengine:deepseek-v4-pro
volcengine:glm-5.1              volcengine:minimax-m3
longcat:LongCat-2.0-Preview
deepseek:deepseek-v4-flash      deepseek:deepseek-v4-pro
baidu:deepseek-v4-flash         baidu:glm-5            baidu:glm-5.1
mimo:mimo-v2.5-pro
opencode:glm-5.1                opencode:deepseek-v4-pro
```

每个 spec 在 `.env` 通过对应 `<HUOSHAN|DEEPSEEK|BAIDU|LONGCHAT|MIMO|OPENCODE>_API_KEY` 提供凭据。运行时 `discover_models` 只列出 .env 里有 key 的 spec。

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
npm run validate
npm run quality:scan
npm run quality:audit
```

本地 pre-commit hook 也是快速确定性门禁。真正的语义质量、事实正确性、专家口吻和面试可用性，改由维护者人工触发精修器来把关。

