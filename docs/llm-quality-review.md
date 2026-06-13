# LLM 内容质量评审（历史可选）

本仓库过去使用 `quality:llm:*` 生成结构化 LLM 评审报告，并让 CI 校验 `.quality-review/reports/`。这套流程已经不再作为发布门禁使用。

当前主流程是：

```bash
npm run validate
npm run quality:scan
npm run quality:audit
npm run quality:refine:interactive
```

CI 只运行确定性校验，不再运行 LLM 评分，也不要求提交 `.quality-review/reports/`。语义质量、事实正确性、讲解顺序、专家口吻和面试可用性由维护者本机运行精修器负责。详见 [内容精修器](quality-refine.md)。

## 为什么替换

结构化 LLM report 的 CI 流程可以留下审计痕迹，但耗时长、容易被模型/网络/CLI 状态拖慢，并且每次内容小改都要重新生成报告。现在改为维护者按需运行精修器：

- 保留 `validate`、`quality:scan`、`quality:audit` 作为 CI 兜底。
- 把耗时 LLM 判断移到本地人工触发。
- 精修器直接产出改写后的 topic，而不是只产出评分报告。
- 每次 CLI 调用只处理一个 topic，避免一个领域合包导致上下文污染。

## 旧脚本状态

`package.json` 中的以下脚本仍保留，主要用于临时对比、排查或历史报告复现：

```bash
npm run quality:llm:packet
npm run quality:llm:run
npm run quality:llm:verify
npm run quality:llm:prune
```

这些脚本不再是常规提交流程的一部分，也不再由 CI 调用。除非明确需要复用旧报告机制，否则不要把 `.quality-review/reports/` 当作必须提交的产物。

## 旧流程速查

如果确实需要手动生成旧式 LLM report，可以按下面方式运行：

```bash
git add topics/java/example.json
npm run quality:llm:packet
npm run quality:llm:run -- --cli qwen --model your-model --concurrency 2 --retries 1
npm run quality:llm:verify
```

旧流程会生成：

- `.quality-review/requests/`：本地请求包，已忽略，不提交。
- `.quality-review/reports/`：旧式评审报告；当前 CI 不再依赖它。

新内容质量把关应优先使用：

```bash
npm run quality:refine:interactive
```
