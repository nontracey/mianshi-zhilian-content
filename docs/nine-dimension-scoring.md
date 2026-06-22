# 9 维评分（agent 审查口径）

本文档供 agent 在审查或改写 `topics/` 内容时参照。评分由 `scripts/content_quality_audit.mjs` 实现，是仓库唯一的确定性质量评分，CI 通过 `npm run ci:static` 强制执行。

> 历史的 LLM 精修器与 `quality:llm:*` 评审流程已删除，动态判官那套 9 维（`accuracy`/`cognitiveOrder`/...）不再使用。当前所有质量判断只看本文档描述的静态 9 维评分。

## 9 个维度

评分按资深领域评审视角拆成 8 个打分维度 + 1 个封顶维度，合计 9 维：

| 维度 | 字段名 | 满分 | 地板（低于此封顶 89） |
| --- | --- | --- | --- |
| 结构完整性 | `structure` | 10 | 60% |
| 内容深度 | `depth` | 20 | 55% |
| 专家证据 | `expertise` | 20 | 60% |
| 讲解清晰度 | `clarity` | 12 | 60% |
| 图示/对比 | `visual` | 10 | 45% |
| 面试可用性 | `interview` | 14 | 60% |
| rubric 评估 | `assessment` | 10 | 55% |
| 模板与语言卫生 | `hygiene` | 4 | 45% |
| 区分度天花板 | `seniorityCap` | — | 封顶而非打分 |

### 1. 结构完整性（structure，10）

- `status` 标注 `production`。
- 标题干净（无 AI 脚手架腔、无跨 topic 重复）。
- 摘要 `summary` 覆盖动机 + 机制 + 边界。
- `interviewerFocus` 具体指向本篇考点。
- `estimatedMinutes` 在 35-450 字/分钟密度区间。
- 必备卡片齐全（`explain` / `interviewAnswer` / `checklist` 至少一类深度卡片）。

### 2. 内容深度（depth，20）

- `explain` 正文字量达到资深水平（`expertExplainChars` 阈值）。
- 全篇总字量充足但不靠重复堆叠。
- explain 卡数量符合 difficulty 期望。
- 机制解释占比高（不是定义 + 列举）。
- 句子重复率低。
- 算法/Go 领域必须有 code 卡；其他领域不强制。

### 3. 专家证据（expertise，20）

- 卡片正文与 topic 专属术语贴合（`topicAlignmentRatio` ≥ 0.55）。
- 有具体例子、边界条件、验证指标、取舍权衡、失败路径。
- 有领域证据（复杂度、版本号、时延、容量等事实锚点）。

> 例子/边界/验证/取舍/失败路径只在卡片正文（`explain`/`interviewAnswer`/`checklist`/对比表/图注）中取证；写在 `title`、`tags`、`summary`、`rubric` 里不算数，杜绝"自己匹配自己"。

### 4. 讲解清晰度（clarity，12）

- 自然语言写成，不是清单骨架。
- 卡片标题信息量大（写本卡具体考点，不是"核心概念""深入理解"）。
- 卡片顺序符合认知规律。
- checklist 具体可勾选。
- 卡片数量与 difficulty 匹配（difficulty ≥3 至少 6 张）。
- difficulty <3 的 explain 不强制列表化；difficulty ≥3 允许结构化列表。

### 5. 图示/对比（visual，10）

- 有承载真实机制的 diagram 或 compareTable。
- 图解可读：mermaid 首行是合法图类型声明、无重复连线；compareTable 无空单元格、无重复行、无所有列同值。
- 图节点与 topic 专属术语贴合，不是通用关键词链。
- 图注与 fallback 不模板化。

### 6. 面试可用性（interview，14）

- `interviewAnswer` 有结构：结论 + 机制 + 边界。
- interviewAnswer 有深度（不是背诵稿）。
- `followUpQuestions` 数量与深度匹配 difficulty。
- `recallPrompts` 像真实面试题，数量匹配 difficulty（≥3 至少 3 条，<3 至少 2 条）。
- 高频题（`interviewFrequency=high`）的 interviewAnswer 用 Markdown 列表结构化。

### 7. rubric 评估（assessment，10）

- `rubric.mustHave` ≥3 条、`goodToHave` ≥2 条、`commonMistakes` ≥2 条。
- rubric 三项专属度高（不泛化到任何 topic 都成立）。
- `rubric.scoreWeights` 各项之和 = 100。
- **rubric 不得内嵌代码**：`mustHave`/`goodToHave`/`commonMistakes` 命中 `throw new ...()`、`function`、`=>`、带分号语句、缩进代码块即判 P0，代码只能进 code 卡。

### 8. 模板与语言卫生（hygiene，4）

- 无模板污染句（"深入理解续""核心概念""建议结合实际项目""理论和实践脱节""关键行"等）。
- 无跨 topic 模板句（≥20 字的句子逐字出现在 ≥4 个 topic 中即判模板句）。
- 标题无中英文之间的不自然空格。
- 无 `highlight.note` 通用化文案。
- 无 AI 脚手架式图注。

### 9. 区分度天花板（seniorityCap，封顶）

这不是打分维度而是封顶闸：

- difficulty ≥3 的技术题，`recallPrompts`/`followUpQuestions` 全是"是什么/列举"、缺"为什么这样设计 / 如何排查 / 取舍 / 极端场景"深问 → 封顶"仅区分中级"，达不到 P7。
- difficulty 4-5 必须具备专家（P7+）区分度。
- difficulty 1-2 的基础题豁免，但不得为凑深度注水或虚标难度。
- 技术域对标 P7/P7+；非技术域对标该职业资深从业者纵深。

## 评分流程

### 两遍扫描

1. **第一遍**：加载全库建立语料库（跨 topic 句子指纹、领域术语词典）。
2. **第二遍**：带语料库上下文逐 topic 评分。

### 反刷分机制

1. **跨 topic 模板句封顶**：含 1 句封顶 94，2 句封顶 92，3 句及以上封顶 88。
2. **有效字数去重**：topic 内部句子重复率 >15% 扣分并封顶 89，>12% 封顶 94。
3. **取证范围限定卡片正文**（见上文）。
4. **维度地板**：任一核心维度低于地板直接封顶 89，强维度不能补偿弱维度。
5. **领域术语词典**：difficulty ≥3 的 topic 卡片正文若一个领域术语都不命中，按跑题/表面化处理。
6. **图表与代码刚性检查**：mermaid 首行、对比表、code 卡 language 与内容特征。
7. **完成度与可读性**：TODO/待补充占位封顶 89；未渲染 `\n`/`\t`、未闭合代码围栏、≥380 字无换行长文、≥150 字无停顿长句扣分。
8. **重复互抄检查**：explain 卡之间、追问答案之间、recallPrompts 之间 Jaccard >0.7-0.8 扣分；explain 与 interviewAnswer 整体重复扣分。
9. **正向事实锚点**：具体数字、复杂度、版本号、容量/时延单位为正向信号；difficulty ≥4 完全没有事实锚点扣分。
10. **学习闭环自包含**：recallPrompts 考的点必须能从本篇卡片正文学到；rubric.mustHave 必须被正文覆盖。
11. **场景迁移练习**：difficulty ≥3 的非算法 topic 必须有场景型问题，否则封顶 94。
12. **清单骨架检测**：explain 卡成段文字 <60 字、实质要点 ≤2 条、要点行 ≥5 行 → 封顶 92。算法领域步骤列表 + 代码卡豁免。
13. **讲练衔接**：interviewAnswer 与 explain 词汇关联度过低或过高都扣分。
14. **学习时长真实性**：estimatedMinutes 与去重后内容密度超出 35-450 字/分钟扣分。
15. **rubric 不得内嵌代码**（见 §7）。
16. **假图检测**：mermaid 构成单链（每节点入度≤1、出度≤1）或终点命中"结论/要点/总结/面试" → 假图扣分。
17. **区分度天花板**（见 §9）。
18. **图解形态非退化**：已有承载真实空间/状态/数据结构信息的 SVG 被删除或弱化成 Mermaid 线性链 → 扣分或封顶。

### 分数语义

- **90-94**：最低合格线。零基础用户只靠这一篇就能建立机制理解、答出回忆题、把知识用到面试回答里。结构完整但教不会人不算 90。
- **95-98**：内容优秀，有清晰例子、边界、验证证据、图示和追问，语言完全为本知识点原创。
- **99-100**：接近人工精品，几乎无短板。

### 门禁阈值

- CI 静态门禁：`npm run ci:static` → `quality:audit --min-score=90`。单篇 <90 视为不通过。
- 本地 pre-commit hook（`.githooks/pre-commit` → `scripts/quality_gate_staged.mjs`）：暂存 topic 静态分必须 ≥90。
- 全库总体平均分必须 ≥90。

## agent 审查使用方式

agent 审查或改写一篇 topic 后，运行：

```bash
# 单篇审查（JSON 模式筛该篇扣分明细）
node scripts/content_quality_audit.mjs --min-score=90 --json \
  | jq '.allTopics[] | select(.ref=="topics/<domain>/<file>.json")'

# 全库审查
npm run quality:audit
# 或 CI 同款全量静态门禁
npm run ci:static
```

`content_quality_audit.mjs` 会输出：

- 每篇总分（0-100）。
- 9 维各维度实际得分与满分。
- 触发的反刷分规则、封顶原因、扣分明细。
- 跨 topic 模板句命中列表。
- `Domain priority (worst first)` 跨域排名（JSON 模式见 `result.domainPriority`）。

agent 应根据扣分明细定向修复：维度短板补对应证据，模板句改写为本篇原创，假图重画为真实机制图，rubric 代码移到 code 卡，区分度不足补"为什么/排查/取舍/极端场景"深问。
