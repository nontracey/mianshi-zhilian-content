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

每一步都支持：

- `b`、`back`、`上一步`、`返回`：回到上一层。
- `q`、`quit`、`退出`、`取消`：退出。

## 核心原则

- 一个 CLI 调用只处理一个 topic。领域或多 topic 选择只是队列，不会把整个领域塞进同一个 prompt。
- 并发表示同时启动多个“单 topic CLI 子进程”。如果希望绝对串行，把并发设为 `1`。
- 第一轮会把选中的全部 topic 都送 LLM 精修，即使静态审计已经达到 `90` 分。
- 静态分数只作为上下文和最终验收兜底，不作为跳过 LLM 的依据。
- 后续轮次只复修仍低于 `min-score` 的 topic，避免已经静态达标的内容反复重写。
- 正式精修写回 `topics/`；只有全部目标最终达标时，交互脚本才会按阶段同步到 `staging/`、`draft/`。
- 测试预览不改仓库内容，产物写入 `.quality-refine/preview/`，并在终端渲染文字版。
- 执行期间会输出单篇开始、完成/失败和重试信息。正式模式默认每 30 秒输出一条聚合 `[RUNNING]`，不会按每个 CLI 子进程刷屏；测试预览默认显示单篇 `[SPAWN]` / `[WAIT]` / `[DONE]` 细反馈。
- 可用 `--progress-style summary|topic|quiet` 控制反馈密度；可用 `--heartbeat-seconds` 或 `QUALITY_REFINE_HEARTBEAT_SECONDS` 调整心跳间隔，`0` 表示关闭心跳。
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
  --concurrency 2 \
  --max-rounds 3 \
  --retries 1 \
  --timeout-ms 600000 \
  --heartbeat-seconds 30 \
  --progress-style summary \
  --model-chain minimax-m3,deepseek-v4-pro,glm-5.1 \
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

## 进度与产物

正式精修会输出类似：

```text
[3/12 ✓2 ✗1 | go | m=minimax-m3] OK topics/go/context.json
```

含义：

- 当前进度 / 总数。
- 成功数与失败数。
- 当前领域。
- 当前模型。
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
