# 内容精修器

精修器用于替代过去的 CI LLM 评分报告流程。CI 现在只跑确定性校验：`npm run validate`、`npm run quality:scan`、`npm run quality:audit`。LLM 质量检查和内容重写由维护者在本机按需运行精修器完成。

## 推荐入口

优先使用交互式启动器：

```bash
npm run quality:refine:interactive
```

也可以直接执行脚本：

```bash
./scripts/quality_refine_interactive.sh
```

交互器会依次选择：

1. 同步阶段：全部、仅测试、仅草稿。
2. 运行模式：正式精修、测试预览、仅审计。
3. 领域：全部、单领域、多领域。
4. Topic：列出所选领域内全部 topic；正式模式可选全部、多个编号、范围、随机或手动路径；测试预览只选单篇，直接回车会随机一篇。
5. 执行参数：合格分、并发、轮数、limit、重试、超时、降级阈值。
6. CLI agent：自动扫描本机安装的 `qwen`、`codex`、`claude`、`gemini`、`opencode` 等，优先显示 qwen。
7. 模型链：只展示所选 CLI 的配置模型；可选择多个模型组成降级链。
8. 判官模型：默认跟精修模型链一致，也可多选组成 ensemble，或选择不启用判官。
9. 判官数量与动态免改线：配置每个判官模型的实例数、`dynamic-skip-min`、`judge-batch-size`、`judge-warm-concurrency`（判前预热并发，默认与精修并发一致）。

每一步都支持：

- `b`、`back`、`上一步`、`返回`：回到上一层；多输入步骤（执行参数、判官参数）按 `b` 只回退到上一道子题，第一题再按 `b` 才整步退出。
- `q`、`quit`、`退出`、`取消`：退出。

## 核心原则

- 一个 CLI 调用只处理一个 topic。领域或多 topic 选择只是队列，不会把整个领域塞进同一个 prompt。
- 并发表示同时启动多个“单 topic CLI 子进程”。如果希望绝对串行，把并发设为 `1`。
- 并发大于 `3` 时，默认启用自适应并发：遇到限流、服务繁忙、超时、非零退出等可用性失败，会把并发逐步降到 `3`，并重试这些失败 topic；内容校验失败不会触发并发降级。
- 启用判官时，第一轮会先对 scope 内 topic 做判前评审，并按 `contentHash` 缓存；全域运行会按 `judge-batch-size` 批量预热缓存，预热阶段以 `judge-warm-concurrency` 个 worker 并发跑批，启动行会打印 `missing/cached/batches/并发/预计` 估时，每完成一批刷一行进度（`summary` 模式还会按表头打印 已用/剩余/缓存/最新 引用列）。判官输出和精修输出一样走本地文件协议，文件必须带 `//---END---`，主进程严格解析合法 JSON，格式失败只允许同批重试，不能作为正常回退路径吞掉。
- 静态分数是地板，判官分数是语义天花板。静态分达标且判官达到 `dynamic-skip-min`、8 维均不低于 4、无 blocking 时，topic 会直接跳过改写。
- 未达标 topic 才进入逐篇改写；候选会先跑 invariant、静态审计和判后评审，再用回归向量决定整篇接受、保留旧版，或只合并变好的块。
- 块级合并只吸收被静态检查和块级判官确认更好的块；合并前后会检查重复块回归，候选不得新增同类型同标题重复块，也不得增加同类型语义高度相似的卡片对。
- 后续轮次只复修仍低于 `min-score` 或判官未达标的 topic，避免已经达标的内容反复重写。
- 正式精修写回 `topics/`；只有全部目标最终达标时，交互脚本才会按阶段同步到 `staging/`、`draft/`。
- 测试预览不改仓库内容，产物写入 `.quality-refine/preview/`，并在终端渲染文字版。
- 执行期间会输出单篇开始、完成/失败和重试信息。正式模式默认每 30 秒输出一条聚合 `[RUNNING]`，不会按每个 CLI 子进程刷屏；测试预览默认显示单篇 `[SPAWN]` / `[WAIT]` / `[DONE]` 细反馈。
- 正式模式的配置摘要、scope 标题、`[RUNNING]` 心跳和单篇完成行都会显示当前并发；自动降级后会显示新的并发值。
- 可用 `--progress-style summary|topic|quiet` 控制反馈密度；`summary` 会按阶段输出低频心跳，并在每完成一篇时刷一行紧凑进度表。可用 `--heartbeat-seconds` 或 `QUALITY_REFINE_HEARTBEAT_SECONDS` 调整心跳间隔，`0` 表示关闭心跳。
- 按 `Ctrl-C` 会中断当前精修，并尝试终止正在运行的外部 CLI 子进程；再次按 `Ctrl-C` 会强制退出。

## 常用命令

仅审计：

```bash
npm run quality:refine -- --audit-only --scope domain:go --min-score 90
```

测试预览单篇：

```bash
npm run quality:refine -- \
  --preview \
  --cli qwen \
  --scope domain:go \
  --topic topics/go/context.json \
  --model-chain minimax-m3,deepseek-v4-pro \
  --min-score 90
```

正式精修一个领域内全部 topic：

```bash
npm run quality:refine -- \
  --cli qwen \
  --scope domain:go \
  --concurrency 3 \
  --max-rounds 3 \
  --retries 1 \
  --timeout-ms 600000 \
  --heartbeat-seconds 60 \
  --progress-style summary \
  --model-chain minimax-m3,deepseek-v4-pro,glm-5.1 \
  --judge-models minimax-m3,deepseek-v4-pro \
  --judge-count 1 \
  --dynamic-skip-min 85 \
  --judge-batch-size 5 \
  --judge-warm-concurrency 3 \
  --judge-json-retries 2 \
  --min-score 90
```

正式精修多个指定 topic：

```bash
npm run quality:refine -- \
  --cli qwen \
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

## CLI 与模型降级

交互器会扫描本机 PATH 中的常见 agent CLI，并优先显示 qwen。模型列表按选中的 CLI 分开读取，例如选择 qwen 时读取 qwen 配置中的模型；选择 codex 时只显示 codex 相关模型。

模型链用于处理“主模型频繁不可用”的情况：

```bash
--model-chain model-a,model-b,model-c
```

当当前模型连续达到 `--degrade-after` 次可用性失败后，自动降级到下一个模型。内容质量失败只触发该 topic 重试，不触发模型降级。

并发降级独立于模型降级。直接指定 `--concurrency 4` 时，默认等价于允许降到 `--auto-concurrency-min 3`；如果想关闭并发降级，可以显式传 `--auto-concurrency-min 0`。

## 进度与产物

正式精修会输出类似：

```text
[3/12 ✓2 ✗1 | go | m=minimax-m3] c=3 OK topics/go/context.json
[4/12 ✓2 ✗1 ★1 ⇄1 ◦1 | go | m=minimax-m3] c=3 MERGED topics/go/interface.json
```

含义：

- 当前进度 / 总数。
- 成功数与失败数。
- `★` 整篇接受数，`⇄` 块级合并数，`◦` 判前已达标跳过数。
- 当前领域。
- 当前模型。
- 当前并发。
- 当前 topic 路径。

正式批量运行等待外部 CLI 时会看到聚合心跳：

```text
[RUNNING] 3/12 ✓3 ✗0 active=2 elapsed=1m30s current=topics/go/context.json 44s m=minimax-m3 | topics/go/interface.json 41s m=minimax-m3
```

测试预览或 `--progress-style topic` 时还会看到单篇细反馈：

```text
[SPAWN] REFINE topics/go/context.json attempt=1/2 model=minimax-m3 pid=12345 timeout=10m00s
[WAIT] REFINE topics/go/context.json attempt=1/2 model=minimax-m3 elapsed=30s / timeout=10m00s capture=42KB stderr=0B
[DONE] REFINE topics/go/context.json attempt=1/2 model=minimax-m3 elapsed=1m42s capture=118KB
```

每次运行的中间产物在 `.quality-refine/<runId>/`：

- `progress.jsonl`：逐 topic 进度。
- `summary.json`：最终汇总。
- `judge-cache/`：按 `contentHash + rubricVersion + judgeSetHash` 缓存判官结果。
- `*.raw.txt`：每篇 CLI 原始输出，便于排查。

`.quality-refine/` 是本地运行产物，已在 `.gitignore` 中忽略。

## 与 CI 的关系

CI 不再运行 LLM 评分、也不要求提交 `.quality-review/reports/`。当前 CI 只负责：

```bash
npm run validate
npm run quality:scan
npm run quality:audit
```

本地 pre-commit hook 也是快速确定性门禁，只检查暂存 topic 的 JSON 和静态质量分。真正的语义质量、事实正确性、专家口吻和面试可用性，改由维护者人工触发精修器来把关。
