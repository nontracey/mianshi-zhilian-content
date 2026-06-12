# LLM 内容质量评审

本仓库采用默认档 LLM 评审：**维护者本地 agent 负责评审，仓库和 CI 只验证结构化报告**。仓库不保存 LLM key、模型名配置或 provider 配置。

## 默认范围

默认只检查当前改动中的发布态 topic：

```bash
npm run quality:llm:packet
npm run quality:llm:run -- --cli qwen
npm run quality:llm:verify
```

等价于：

```bash
npm run quality:llm:packet -- --env=production --scope=changed
npm run quality:llm:run -- --env=production --scope=changed --cli qwen
npm run quality:llm:verify -- --env=production --scope=changed
```

默认不抽样：`scope=changed` 下会评审当前 staged diff 中所有发布态 topic。`changed` 在本地默认读取 staged diff，因此请先 `git add` 内容改动，再生成请求包。如果同一 topic 还有未暂存编辑，脚本会要求先 stage 或 stash，避免评审报告和实际提交内容不一致。

## 本地 hook 安装

Git 不会自动读取仓库里的 `.githooks/`。每个本地 clone 必须安装一次：

```bash
npm run hooks:install
```

这会执行：

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/commit-msg
```

安装后，用户自己在 shell 里执行 `git commit`、agent 执行 `git commit`、大多数 Git GUI 提交，都会触发 `.githooks/pre-commit`。如果没有安装，本地不会触发 hook；CI 仍会执行 `quality:llm:verify` 作为分支保护兜底。

## 提交流程

1. 修改 topic 内容。
2. 暂存内容改动：

   ```bash
   git add topics/java/example.json
   ```

3. 生成 LLM 评审请求：

   ```bash
   npm run quality:llm:packet
   ```

4. 选择一个外部 CLI 非交互执行评审。不要让当前写作/修改内容的 agent 直接开 subagent 自评：

   ```bash
   npm run quality:llm:run -- --cli qwen --model your-model --concurrency 2 --retries 1
   ```

   未指定 `--model` 时使用该 CLI 的默认配置模型。也可以用环境变量指定：

   ```bash
   QUALITY_LLM_CLI=qwen QUALITY_LLM_MODEL=your-model npm run quality:llm:run
   ```

   `quality:llm:run` 会按 topic 拆分任务，限制并发，失败自动重试，最后写入 `.quality-review/reports/<reviewId>.json`。如果要手动评审，也可以让维护者自己的 CLI/agent 读取 `.quality-review/requests/<reviewId>.md` 后写同一个 report。
5. 暂存报告：

   ```bash
   git add .quality-review/reports/<reviewId>.json
   ```

6. 清理旧报告：

   ```bash
   npm run quality:llm:prune
   ```

7. 本地验证：

   ```bash
   npm run quality:llm:verify
   ```

8. 提交。pre-commit 会再次验证 staged diff 对应的报告。

`.quality-review/requests/` 是本地临时请求包，不提交；`.quality-review/reports/` 需要提交，CI 依赖它做确定性校验。

## 多 commit push 与 PR：联合覆盖

reviewId 与一次评审的目标集合及内容哈希绑定。本地按 commit 评审，但 CI 验证的是**聚合 diff**（PR 是 `origin/main...HEAD`，push 是 `before...sha`），聚合范围不会与任何单次评审的 reviewId 相同。因此 verify 有两级匹配：

1. **精确模式**：存在与当前范围 reviewId 完全一致的报告 → 全套哈希校验。
2. **联合覆盖模式**：精确报告不存在时，扫描 `.quality-review/reports/` 中所有已提交的 pass 报告，要求当前范围内每篇 topic 都被某份报告的条目按 `reviewedTopics[].contentHash` 精确命中（且该条目自身 pass、分数和 factFindings 合规）。多个 commit 各自的报告可以联合覆盖一次 push/PR 的聚合 diff。

也就是说：**每篇 topic 的最终内容版本必须被某份提交过的 pass 报告评审过**，评审报告随对应 commit 一起提交即可，无需在 push 前重新评审整个聚合范围。fail 报告的条目不能用于覆盖。

## 报告清理

`.quality-review/reports/` 不是长期档案目录，只保存仍然有效的 gate 证明材料。历史报告由 Git history 保留。

清理旧报告：

```bash
npm run quality:llm:prune
```

先预览会删除哪些文件：

```bash
npm run quality:llm:prune -- --dry-run
```

`prune` 保留两类报告：当前 `env/scope/sample` 对应 reviewId 的报告，以及任何仍能提供联合覆盖的报告（存在条目的 `contentHash` 与对应 topic 当前文件内容一致的 pass 报告）。只有"评审过的内容已经又被修改"的过期报告会被删除，因此 prune 不会破坏后续 push/PR 的联合覆盖。

## 可选范围

```bash
# 全发布态抽样
npm run quality:llm:packet -- --env=production --scope=all --sample=10

# 单领域抽样
npm run quality:llm:packet -- --env=production --scope=domain:java --sample=10

# 单 topic
npm run quality:llm:packet -- --env=production --scope=topic:topics/java/topic-001-ebcc71cb.json

# staging 或 draft
npm run quality:llm:packet -- --env=staging --scope=changed
npm run quality:llm:packet -- --env=draft --scope=changed
```

## 外部 CLI 执行

`quality:llm:run` 要求显式选择 CLI；仓库不会默认调用当前 Codex agent。常见用法：

```bash
# Qwen Code，使用 CLI 默认模型
npm run quality:llm:run -- --cli qwen --concurrency 2 --retries 1

# Claude Code，指定模型
npm run quality:llm:run -- --cli claude --model sonnet --concurrency 2 --retries 1

# Gemini CLI
npm run quality:llm:run -- --cli gemini --model gemini-2.5-pro --concurrency 2 --retries 1

# OpenCode
npm run quality:llm:run -- --cli opencode --model provider/model --concurrency 2 --retries 1

# Codex CLI
npm run quality:llm:run -- --cli codex --concurrency 2 --retries 1

# 通用 CLI：按需指定非交互参数
npm run quality:llm:run -- --cli some-cli --preset generic --base-arg run --prompt-mode flag --prompt-arg --prompt --extra-arg --non-interactive
```

并发上限为 4，默认 `--concurrency=2`；默认 `--retries=1`，即失败任务最多执行 2 次；默认单任务超时为 10 分钟，可用 `--timeout-ms` 调整。运行产物在 `.quality-review/tmp/<reviewId>/`，最终提交只需要 `.quality-review/reports/<reviewId>.json`。

注意：qwen/gemini preset 的 pty 包装（`script` 命令）只在 macOS 生效，Linux 下自动降级为直接执行；评审模型的 `verdict` 只有显式 `pass` 才算通过，其他值（含缺失）一律按 fail 处理。

权限默认（最小权限原则）：评审任务的全部输入都内嵌在 prompt 中，评审 CLI 不需要任何工具执行权限。qwen/gemini preset 默认 `--approval-mode plan`（只读/只分析），codex preset 默认 `--sandbox read-only`——杜绝被评审内容中的注入文本诱导评审 CLI 执行命令或写文件。如确需放开（不推荐），用 `--no-default-extra-args` 并自行传 `--extra-arg`。

非发布态目前不会嵌入 `content_quality_audit.mjs` 的静态评分哈希，因为该脚本只评分 `manifest.json` 的 production 内容；报告仍会校验 topic 内容哈希、目标范围和 LLM 结论。

## 评审阻断条件

评分量纲：总分 0-100（与标准 §8.3 语义对齐，低于 85 阻断）；维度分 1-5 整数（4 = 合格，低于 4 阻断）。

LLM report 必须满足：

1. `verdict` 为 `pass`。
2. `blockingFindings` 为空。
3. 整体分和每篇 topic 分数都在 85-100。
4. `accuracy`、`cognitiveOrder`、`expertVoice`、`selfContained`、`interviewUsability`、`difficultyFit` 均为 4 或 5。
5. 每篇 topic 的 `factFindings` 至少 3 条结构化核验记录（`claim`/`verdict`/`evidence`），且不含 `wrong`、`outdated` 的事实；`suspicious` 必须写明无法核验的原因。
6. report 中的 `reviewId`、`targetHash`、`contentHash`、`staticAuditHash` 与当前仓库状态一致。

重点评审维度：

1. 事实正确性（`accuracy`）：关键事实、版本、边界条件不能错；图的流程方向、对比表结论、代码正确性同样按事实核验。
2. 认知顺序（`cognitiveOrder`）：讲解要符合从动机到机制、例子、边界和面试表达的学习路径。
3. 专家口吻（`expertVoice`）：必须有机制、条件、指标、失败路径和取舍，不能是模板腔。
4. 自包含闭环（`selfContained`）：正文必须能支撑自己的 `recallPrompts` 和 `rubric.mustHave`。
5. 面试可用性（`interviewUsability`）：能形成可复述的结论、主线和追问边界。
6. 难度匹配（`difficultyFit`）：内容深度与 `difficulty` 标注一致，低难度不注水、高难度不浅讲。

评审独立性：评审必须在干净上下文的 agent 会话中进行，不要复用写作/修改这批内容的会话。报告作为核验痕迹随内容一起提交，可追溯。
