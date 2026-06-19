# 精修器融合回路 · 方案 v2（实现计划）

> 状态：历史实现计划。当前可执行口径以 `docs/knowledge-content-standard.md` v1.1、`docs/quality-refine.md` v3.1 和 `scripts/quality_standard.mjs` 为准。本文中“8 维”是旧计划语境；现实现已升级为 9 维，并新增图解形态适配与 SVG/Mermaid 非退化门禁。

> 目标：维护者每次只需启动精修器、等它跑完，内容就**只增不减地往上挪一格**。
> 静态审计当地板 + 跨 topic 套话检测；现有 LLM 评审升级成 8 维当真天花板，接进精修回路；
> 落盘用 keep-best（回归向量 + 至少一块变好 + 块级保留），保证「越跑越高」且「部分写得更好的块不会因为整体分波动被丢弃」。

本文件是后续实现的唯一依据，分阶段交付，每阶段独立可回归验证。

---

## 1. 总体架构：双分体系

| 分数 | 来源 | 角色 |
|---|---|---|
| **静态分** | `scripts/content_quality_audit.mjs`（不变） | 便宜的**地板** + 全量两遍扫描抓**跨 topic 套话**（per-topic 判官看不到的横向重复） |
| **动态分** | 复用 `scripts/quality_llm_run.mjs` 的评审逻辑，升级到 **8 维** | 语义/事实/可教会的**真天花板**，连静态 ≥90 的篇也判 |

二者互补：静态抓横向模板与结构硬伤，动态抓事实/认知顺序/专家口吻/可读性/覆盖。**单靠任一都不够**。

---

## 2. 判官（统一 8 维评审，不新造第二套评估器）

### 2.1 共享模块
抽出 `scripts/quality_llm_judge.mjs`，集中维护 8 维 rubric、review normalize、聚合、回归判据、批量判官 prompt 与块级判官 prompt。
`quality_llm_run.mjs` / `quality_llm_verify.mjs` 共享同一份 `JUDGE_DIMENSIONS`，避免报告流与精修流维度漂移。

### 2.2 维度：6 → 8（1–5 整数，`<4 必 fail`）
原 6 维（对应标准 §8.4 "精修器必须处理"）：
`accuracy / cognitiveOrder / expertVoice / selfContained / interviewUsability / difficultyFit`

新增 2 个正交维度：
- `learnerClarity`：零基础读者能否真看懂（句子清晰、术语先解释、认知负荷）。补 cognitiveOrder（推理顺序）和 expertVoice（深度）都不直接量"可教会"的洞。
- `coverage`：面试关键面是否讲全。**口径写死：按"这个 title/difficulty 的知识点资深面试官会考什么"评，明令禁止拿本篇自己的 rubric 当标尺**（破 selfContained 的循环——否则一篇可以自己出浅题、自己答得上、selfContained 满分却漏考点）。

### 2.3 findings 驱动"每块更精准"
维度管门禁（粗），findings 管"改哪块"（细）。保留现有 `factFindings / orderFindings / voiceFindings / selfContainedFindings / blockingFindings`，新增：
- `followUpFindings`：逐条 `{ question, isSpecific, answerAdequate, fix }`——把"追问精准"压到块级。
- `clarityFindings`、`coverageFindings`：哪段初学者难懂 / 哪个关键面没讲。

### 2.4 多判官（ensemble）
- 入口：`--judge-models a,b`（默认 = 精修模型链）、`--judge-count N`（每个判官模型跑几个实例，默认 1）、`--dynamic-skip-min`（动态免改线，旧 `--dynamic-min` 仅作兼容别名）、`--judge-batch-size`。总判官数 = 模型数 × 每模型实例数，全部一起聚合。判官 CLI 默认 = 精修 CLI，留 `--judge-cli` 口子给跨 CLI 高级用法（不进向导）。`--no-judge` 关判官走纯静态。
- 聚合：分数/维度取**中位数**；事实 `wrong/outdated`（blockingFinding）取**并集**——任一判官报就拦。
- 注意：「同模型 N 个判官」只有判官采样**温度 >0** 时才有投票价值（每次输出不同）；温度 0 的确定性 CLI 跑 N 次是同一份结果。

### 2.5 缓存
`.quality-refine/judge-cache/<contentHash>-<rubricVersion>-<judgeSetHash>.json`（gitignore）。
内容 / 判官集（模型+数量）/ 评审口径任一变即失效。让"判全库"成为一次性成本，重跑只判变过的篇。

---

## 3. keep-best：越跑越高 + 部分更好不丢

### 3.1 接受判据（自动，无人工逐项确认）
判前、判后各判一次。**接受候选覆盖磁盘版，当且仅当全部满足**：
1. `checkInvariants` 通过（含 §4 Phase 0 锁字段）；
2. 8 维**无任一跌破地板**；
3. **无新增 `wrong/outdated` 事实**（对比判前 blockingFindings）；
4. 静态硬规则未破、静态分不跌破 90；
5. **且至少一块被判 improved**。

**总分（静态 + 动态）只作监控与报告，绝不当开关**——它有噪声、可 Goodhart，盯总分会把"部分更好但总分波动"的候选误杀。

### 3.2 块级 keep-best（Phase 3）
独立块 = 每张 `learningCard` + `interviewAnswer.followUpQuestions` 逐条 + `recallPrompts` 逐条 + `compareTable` 整表。
- 候选只**吸收变好的块**；退步的块**回退到上一版最佳**。
- 卡片没有稳定 id 时，用类型、标题、主体文本 token Jaccard 做稳定匹配；`interviewAnswer` 的正文与追问拆成不同块，避免正文合并时误吞追问。
- 候选不得在块合并阶段引入重复块：同类型同标题重复计数不能上升，同类型语义高度相似的卡片对数也不能上升。
- 对静态预选出来的变化块再跑块级判官，只落盘 verdict 为 `improved` 的块；`same/regressed/blocking` 均回退旧块。
- 拼好后**整篇复判**（重点查 explain↔interviewAnswer 讲练衔接没断、tokenJaccard 达标）；不达标则降级为"整篇接受/拒绝"。
- 因为永不写入更差的块，磁盘上始终是"历史最佳"，配合 contentHash 缓存不重判。

### 3.3 自动化口径（重要）
- 精修器**全自动跑**，keep-best 完全由算法决定，**不在精修器里加任何"这个改动接受吗"的人工确认**。维护者事后用 `git diff` 审，git 是兜底。
- 唯一人工触点 = 向导**开跑前那一次配置确认**（`confirm_execution` 的 `[Y/n]`），属于交互式入口的一部分。

---

## 4. 回路

每轮：跑一次全量静态审计（拿权威分 + 语料库 + 跨 topic 模板）。scope 内每篇：
1. **判前**（缓存优先）。
2. 已达标（静态 ≥90 且 8 维全 ≥4 且无 blocking）→ **不浪费改写**，记通过。
3. 否则：build prompt = 静态扣分 + 跨 topic 模板句 + **动态 findings**（事实/顺序/口吻/自包含/追问/清晰/覆盖）→ 改写 → `checkInvariants` → **判后** → keep-best 决定覆盖 / 保留 / 块合并。
连续 2 轮无改善 → stuck，避免死循环。

---

## 5. 交互式启动器（判官走向导，不动现有默认）

在 `choose_model_chain`（精修模型链）之后插入：
- **判官模型**：和列模型那步一样列出当前 CLI 的模型、**可多选**；回车默认 = 跟精修同一套；含 `0 = 不启用判官（纯静态快速）`。
- **判官数量**：数字 `每个判官模型跑几个判官实例 [1]`，支持"1 个模型 N 个判官"。
- `confirm_execution` 顺延；`next_step` / `previous_step` / `run_wizard_step` 对应顺延。
- **`choose_domains`（默认 0=全部领域）和 `choose_topics`（默认 0=全部 topic）的选项与默认值完全不动。**
- `build_common_refine_args` 传 `--judge-models / --judge-count / --no-judge`；`summary()` 展示判官配置。

---

## 6. 分阶段实现

- **Phase 0（小、独立、先做）**：`checkInvariants` 锁 `difficulty`（禁下调）/ `tags` / spec 列的"原样保留"字段（不得删字段、不得改元数据值）。堵掉"把难题伪装成简单题 / 改 tags 刷对齐"的刷分洞。
- **Phase 1（不挂 LLM 就拿到越跑越高）**：`content_quality_audit.mjs` 导出 `scoreTopic` / `buildCorpus`（加 main guard，CLI 行为不变）；`quality_refine.mjs` 落盘改"整篇回归向量护栏"（此阶段只有静态分：维度地板不退 + 不破硬规则 + 静态分不退；"至少一块变好"退化为静态 issue 减少或分上涨）。**直接消灭"改烂还覆盖"的 bug**。
- **Phase 2（判官进回路）**：`quality_llm_judge.mjs`（8 维 + findings + 多判官 + 缓存）；判前/判后；prompt 注入 findings；keep-best 加动态条件；batch 判分 + 缓存默认开以压成本。
- **Phase 3（块级合并 + 向导 + 报告）**：块级 keep-best + 整篇复判；向导判官两步；`summary.json` 记录每篇 静态/动态 before→after 与 接受/保留/合并。

---

## 7. 成本

397/425 篇已静态过 → 判官是大头开销。压成本手段：
- 判分比改写便宜（改写要吐整篇 JSON ~100KB、单篇约 1m40s；判分只吐 1–3KB 小 review，快数倍）。
- **batch 判分（≤10/次）**：全库判前一遍约 43 次调用而非 425 次。
- **contentHash 缓存跨次复用**：内容没变不重判，判全库是一次性成本。
- 用判分把昂贵的改写**挡在门后**：现工具第一轮无脑改写全部 425 篇（含已达标），新设计先判、判 OK 不改 → 对健康内容往往净省。
- `--no-judge` 纯静态快速模式；按域判（向导默认按域队列）。

→ 结论：日常成本可控、首跑一次性；整体往往不比现状慢甚至更快。真正多花的时间 = 大量篇动态不及格时的额外改写，那正是要的质量提升。

---

## 8. 回归验证（每阶段必须过）

- `--audit-only` / `--dry-run` 冒烟。
- mock 精修 CLI（回吐 prompt 里 `【当前 topic JSON】` 标记的 JSON）+ mock 判官 CLI（回吐固定 review）跑端到端。
- 关键断言：
  1. **候选更差 → 旧版保留、未覆盖**（Phase 1 核心保证点）。
  2. 候选**部分好部分差 → 吸收好块、回退坏块**（Phase 3）。
  3. 多判官分歧 → 中位数 / blocking 并集行为正确（Phase 2）。
  4. 事实错 → blockingFinding 拦截、不落盘（Phase 2）。
  5. 锁字段：difficulty 下调 / 删字段 / 改 tags → invariant 失败（Phase 0）。

---

## 9. 体感（改完后）

平时：`npm run quality:refine:interactive` → 判官默认开、默认跟精修同模型 → 一路回车用默认 → 等它跑完 → 内容涨一格、永不回退。
想快：`--no-judge` 纯静态。想更准：加判官模型 / 数量。
诚实的星号：① 会递减、会到顶（朝天花板的棘轮，非永动机）；② "更好"= 判官+静态认为更好，天花板 = 判官眼力，强/多判官抬高它；③ 事实正确性 = "判官没挑出错"非"保证全对"，`git diff` 仍是兜底。

---

## 10. v2.1 增量：判官健壮性 & 进度可视化（2026-06-14）

### 10.1 判官 JSON 协议补强（解决 minimax-m3 未转义引号）

**问题现场**：minimax-m3 在 `evidence` / `reason` 等字段值里直接写未转义的 ASCII 双引号（如 `"goodToHave"`），让 JSON 提前闭合，单批 16 篇判官输出全废。

**四件套修复**：
1. **prompt 硬规则**：`scripts/quality_llm_judge.mjs` 三个 `build*Prompt`（单篇 / 批量 / 块级）末尾统一注入 `JSON_STRING_RULES` 常量——明确要求字符串值内禁用裸 ASCII 双引号，必须用「」/反引号/`\\\"` 转义；多行用 `\\n`。
2. **batch 失败降级**：`runJudgeBatch` 对 `runJudgeProcessJson` 加 try/catch，整批所有 `model × count` 跑完仍拿不到任何结果时，自动降级为逐篇 `runJudges` 兜底——一篇坏 JSON 不再拖垮同批 N 篇。
3. **可用性信号兜底**：`runJudgeProcessJson` catch 块对 stdout / error.message 做 `availabilityFailureMatch`，命中 429/quota/throttl 等关键词时打 `availabilityFailure` 标签，让上层并发收敛 / 模型降级机制能识别"判官也被限流了"。
4. **重试 prompt 带定位**：`strictParseJudgeJson` 解析失败时通过 `extractJsonErrorLocation` 提取 `line / column / position` 和上下文片段，回写到 error 上；`buildJudgeFilePrompt` 的 retryBlock 在重试时把这段位置 + 上下文展开给模型，提示"这里写了未转义双引号，按硬规则改"。

cache 文件：`.quality-refine/judge-cache/outputs/*.json` 是非法 JSON 现场样本，方便回查。

### 10.2 summary 进度行加 phase 显示

**问题**：原 summary 心跳只展示 `compactRef·duration`，看不出子 agent 当前在判官还是改写阶段，对长尾 topic 卡住时无从判断该不该 kill。

**改法**：
- `refineOneTopic` 新增 `setPhase(name)` 闭包参数，在 5 个关键节点切换：`starting → judgeBefore → refineCall → blockJudge → judgeAfter → merging`。
- 池 worker 把每个 ref 的 `phase / phaseStartedAt` 写进 active map。
- `startPoolHeartbeat`：active 行展示 `compactRef·phaseLabel duration`；总体加桶计数 `运行=N/C（判官A 生成B 其他C）`。
- 总览行 `运行` 列改为 `N(judge/gen)`，一眼看出当前判官几个、生成几个。

`phaseBucket(phase)` 三桶：`judge`（judgeBefore / blockJudge / judgeAfter）、`gen`（refineCall）、`other`（starting / merging）。

### 10.3 LiveDashboard：原地刷新仪表盘（2026-06-14）

**问题**：`progress-style=summary` 模式下心跳每 N 秒打一行，长批跑下来终端被滚屏淹没，看不出"当下并发是哪几篇、各自卡在哪个 phase"。用户原话："一直刷屏模式，还是差点意思"。

**方案**：纯 ANSI 内嵌仪表盘。不引第三方 TUI 库，仅用 cursor 上移 + 清屏到结尾两个序列。

**实现要点**（`scripts/quality_refine.mjs`）：
1. `class LiveDashboard`：状态机持有 `counters / poolActive / judge / cfg / title`；render 出固定 N 行 ANSI 文本，记录 `painted` 行数。
2. **stdout/stderr hook**：`enable()` 时把 `process.stdout.write` 包成"先擦面板 → 写出原始内容 → 重画面板"。这样 `console.log` / 子进程 inherit stdio 直接写 fd1 都会自动让位给面板，事件文本仍然往上滚，仪表盘永远停留在屏幕底部。
3. **painting flag 防递归**：paint 自身要 write，不设 flag 会触发自己 hook 自己。
4. **1s 重绘 timer**：dashboard 自带 `setInterval(()=>dirty&&paint(), 1000)`，让 active workers 的 duration 字段每秒滚动；状态变更只置 `dirty=true`，避免 phase 切换抖动。
5. **active workers 全展示**：按 `phaseStartedAt` 升序排序（最久的在最前），每行 `· {compactRef}  {phaseLabel}  {duration}`。用户明确要求"全部并发都展示，下面可以滚动也可以"。
6. **非 TTY 自动降级**：`stream.isTTY` 为假时 `enable()` 直接 return，所有 `dashboard.update*` 调用均空转，refinePool / warmJudgeCacheForTargets 走原 `console.log` + heartbeat 滚屏路径。CI / 重定向到日志文件场景兼容。
7. **触发条件**：`cfg.progressStyle === "summary"` 才 enable；`topic` / `quiet` 模式不启用，保留逐条 / 静默语义。
8. **生命周期**：main 内 `targetRefs` 解析后 enable；"==== 精修完成 ===="打印前 disable；`main().catch().finally()` 兜底 disable。

**面板布局**：
```
╭─ quality_refine  scope=domain:go  cli=qwen  models=minimax-m3 ──
 进度  [████████░░] 8/12  66%
 状态  免改 1  写回 5  合并 1  保留 0  失败 1
 并发  运行 3/3 · 判官 2  生成 1  其他 0
 速度  均时 42s  剩余 2m48s  已用 5m36s
├─ active workers (3) ──
 · go.basic.maps              判官前  18s
 · go.concurrency.channel-pat 重写中  9s
 · go.concurrency.context     判官后  4s
├─ 判官批次 ──
 批次 4/6  篇 19/27  缓存 8  剩余 38s  已用 1m12s
╰──────────────────────────
```

**调用约定**：
- `refinePool` 在 `active.set / setPhase / finally(active.delete)` 三处都触发 `dashboard.updateRefine({ counters, active })`。
- `warmJudgeCacheForTargets` 每完成 batch 调 `dashboard.updateJudge(state)`，结束时 `dashboard.clearJudge()`。
- dashboard 启用时跳过 `startPoolHeartbeat / startJudgeHeartbeat`——心跳被 1s 重绘 timer 顶替。
- 启用 dashboard 时，每篇精修结束的事件行从原本的多行打印精简成一行 `[label] compactRef[error]`，配合面板使用避免抢屏。

---

## 11. v2.2 修复：判官模型/棘轮地板/全程视图/汇总/缓存（2026-06-14）

排查“跑完得看半天日志、还可能因程序设计白跑”，做了 5 处修复（回归 35/35 仍过）：

### 11.1 判官默认模型：链首一个，不是整条降级链
**问题**：向导 `choose_judge_models` 的默认项 `d=与精修同模型` 原本把整条 `MODEL_CHAIN` 传给 `--judge-models`。但精修的模型链是**降级链**（链首优先、挂了才换下一个），判官却把它当 **ensemble** 全跑——选了 3 个模型的降级链 + 默认判官，会同时用 3 个模型判分（含本只当备胎的模型），既多花开销又“用了我没指定的模型”。
**改法**（`quality_refine_interactive.sh`）：`d` 分支改成 `JUDGE_MODELS="${MODEL_CHAIN%%,*}"`（只取链首）；`.mjs` 侧默认本就是 `[modelChain[0]]`，二者一致。多判官投票仍可在该步显式多选启用。

### 11.2 keep-best 地板改棘轮（消除“保留更差旧版”）
**问题**：判官路径 `acceptByJudge` 用硬地板 `minStatic=90`，而纯静态路径 `staticRegressionVectorAccepts` 用棘轮地板 `before>=90?90:before`。默认开判官时，一个 80→85 的**真实改善**会被 90 硬地板拒绝、保留更差旧版——与“只增不减地往上挪一格”矛盾。
**改法**（`quality_refine.mjs` 两处 `acceptByJudge` 调用）：`minStatic: Math.min(90, staticBefore)`。现版 ≥90 仍守 90（候选不许掉破 90）；现版 <90 时只要候选不低于现版即可吸收改善。单测确证：80→85 由拒绝转接受；95→88 仍拒绝。

### 11.3 LiveDashboard 全程视图（看清整体 + 分阶段）
顶栏新增 `阶段 {①全量审计/②判官预热/③精修/④收尾审计} · 轮次 r/max · 全程已用 {墙钟}`，由 `dashboard.setStage()` 在四个节点切换；原“进度”行改名“本轮”，速度行改“本轮均时/本轮剩余/本轮已用”，与“全程已用”区分。`setStatic` 接 `runStartedAt`；标题 `models=` 空 bug 修复（`undefined→CLI默认`），改为 `精修=… 判官=…×N`。判官面板标题改“判官预热（判前评审，走缓存）/缓存命中”。

### 11.4 最终汇总：耗时 + 重试 + 失败分类
`==== 精修完成 ====` 增补：`本次耗时`（`runStartedAt` 起算）、`最终模型`；`重试：N 篇触发 → 重试后达标 R/保留 K/仍失败 F`（`retryStats` 跨轮累计 rounds + 单轮 maxAttempts）；`执行失败原因分类`（`classifyFailure()` 归桶：超时/限流·服务不可用/子agent未写入缓存/输出非topic契约/JSON解析失败/schema不变量/进程非零退出/其他）；失败明细带 `[分类]` 前缀。`summary.json` 同步加 `durationMs/durationLabel/retry/failureBreakdown`。

### 11.5 缓存清理
`judge-cache/outputs/`（判官失败现场样本，从不参与命中、会无限增长）启动时 `gcJudgeOutputs(..., 50)` 按 mtime 仅留最近 50 个。run 目录仍由 `gcOldRuns(keep=3)` 兜底；`judge-cache/` 的 review 缓存按 contentHash 跨次复用、刻意保留。

### 11.6 已澄清（非 bug）
- **“每次启动是否对配置 topic 全量动态判官”**：是。round 1 的 `warmJudgeCacheForTargets(ordered)` 覆盖全部目标，每篇都判（命中 `judge-cache` 或新判）；内容/判官集/口径任一变即缓存失效重判。缓存复用是刻意的省成本设计，不是漏判。日志/面板有“缓存命中 X/Y”可核对。

---

## 12. v2.3 判分依据复核 + keptOld 空跑修复（2026-06-14）

### 12.1 判分依据一致性已实测确认（之前担心的“两套打分器不一致”是误报）
keep-best 用进程内 `scoreTopic(topic, ref, corpus)`，门禁/最终用 `content_quality_audit.mjs --json`。两者其实是**同一个 `scoreTopic` 函数 + 同样从 manifest 全量 `buildCorpus`**。实测 17 篇（go 全域 + java 抽样）`scoreTopic` 与审计 CLI 分数**逐篇完全相同（0 条不一致）**。结论：判分基础是统一的，keep-best 接受的“静态改善”与门禁口径一致，不存在“keep-best 觉得过了但门禁不认”的漂移。
（先前 e2e 里看到的 89 vs 78 是“候选分 vs 被拒旧版分”——不同内容，不是同内容两套打分器打架。）

判分依据三层 = 静态 `scoreTopic`（地板、结构/模板/长度，确定性）+ 动态 8 维判官（事实/清晰/覆盖，天花板）+ keep-best 回归向量（棘轮静态地板 + 无维度退步 + 无新事实问题 + ≥1 处改善）。**天花板 = 判官眼力**：判官默认与精修同模型时，等于“模型自评”，有盲区；想抬高判分质量，最高杠杆是 `--judge-models` 指定**更强/不同的判官模型** + `--judge-count≥2`（温度>0 投票压噪声）。

### 12.2 keptOld 不再在同一次调用里用相同 prompt 空跑
**问题**：候选合法但未优于现版（keptOld）时，原代码 `continue` 进入下一个 attempt，但同一次 `refineOneTopic` 内 prompt/findings 不变 → 对确定性模型必然得到同样的“无任何改善”，纯浪费。实测 retries=1 的 keptOld 单篇会发 **2 次** REFINE 调用。
**改法**：keptOld 分支 `continue` → `break`。`retries` 语义本就是“失败重试”（向导文案如此），keptOld 不是失败。真要再 roll 交给跨轮循环（下一轮带新审计/findings）。真失败（CLI错误/坏JSON/未写入/契约/不变量/限流）仍照常重试（catch 分支不变）。实测改后 keptOld 单篇只发 1 次 REFINE。
**残留（可接受，已被 stuck 限界）**：内容未变的 keptOld 篇跨轮仍会被再 refine 一次（同 prompt），但 `noImprove≥2 → stuck` 把它限制在约 2 轮内；配合判前免改，只有“真失败但推不动”的篇才吃这点重复成本。

---

## 13. v2.4 健壮性 + 格式失败清零（2026-06-14）

诉求：跑完不用管、失败只因“内容不够好”，绝不因程序 bug / JSON 格式（少括号/逗号/裸引号/中英文标点）白跑。深查后修了 5 处：

### 13.1【崩溃级】判官协议失败会崩掉整轮 run —— 已修（且不退静态）
`runJudges` / `runBlockJudges` 原对 `judgeProtocolFailure`（判官多次重试仍写非法 JSON）`throw error` 上抛。判前 `runJudges`（refineOneTopic）**不在 try/catch 内**，worker 也只有 finally 无 catch → 一篇判官坏 JSON 直接崩掉整轮（实测复现栈：runJudges→refineOneTopic→worker→Promise.all→main）。弱国产判官模型很容易触发。

**关键设计纠正（用户反馈）**：不崩溃 ≠ 退回静态。判官启用时静态本就由审计做了，再“降级静态”就是**双静态、判官层形同虚设，那不是精修**。正确语义是 **“判官启用 = 判官必需”**：
- `runJudges`/`runBlockJudges`：协议失败只 log + 返回 null（不上抛、不崩溃）。
- **判前** `runJudges` 返回 null（判官启用）→ 不退静态，直接判该篇 **失败**：`{ ok:false, judgeFailure:true, action:"failed", error:"判官评审失败（判前…）" }`，不跑改写。
- **判后** `runJudges` 返回 null（判官启用）→ `throw`（带 `.judgeFailure=true`）→ attempt catch 重试；重试到上限仍失败 → 该篇失败。磁盘永远保留旧版。
- 块级 `mergedReview` 为 null → accept:false → 级联到整篇判后 throw。**每个写回路径都必须有成功的判官评审**，绝无 judge 启用却静态放行的口子。
- 跨轮重试：判前失败的静态 <minScore 篇下一轮重新进队列再判（judge 健康后即恢复）；retries 内的判后重试给瞬时判官问题机会。判官失败的 error 带 `judgeFailure` 标记，不喂回精修 prompt（避免误导“你 JSON 坏了”）。
- 报告：`classifyFailure` 新增 **“判官评审失败”** 分类，最终报告按原因统计 + 明细 `[判官评审失败]`。`--no-judge` 时才走纯静态（用户显式选择）。

实测：判官永远坏 JSON 时，go 12 篇全部判“判官评审失败”进报告（`执行失败原因分类：判官评审失败×12`），整轮不崩、退出干净，**不再有“保留旧版（双静态）”**。

### 13.2 worker 末端兜底 catch
worker 对 `refineOneTopic` 原本只有 finally 无 catch；而 refineOneTopic 顶部 `JSON.parse(readFileSync(ref))`、`scoreTopic` 等在 attempt-try 之外，任何意外抛错都会穿透 worker 崩整轮。**改法**：worker 包 try/catch——中断信号照常上抛（保 shutdown），其余意外错误隔离成“该篇失败（未捕获异常）”，绝不连累全局。

### 13.3 格式失败自愈：解析错误带位置喂回重试
精修原来格式失败后用**相同 prompt** 再撞一次（判官早有“错误位置回传重试”，精修没有）。**改法**：① `buildRefinePrompt` 加 `previousError` 参数，把上次的 `message + jsonLocation`（`extractJsonErrorLocation` 算的 line/col/上下文片段）拼成重试块，明确“这是格式问题不是内容问题，按硬规则修，以当前 JSON 为基底只改文字”；② `extractJson` 失败时给 error 挂 `jsonLocation`；③ attempt catch 把非可用性失败的 error 存进 `previousFormatError` 喂下一次。实测：attempt1 写未转义引号坏 JSON（报 line1 col23）→ attempt2 prompt 带反馈 → 模型写好 → 正常按内容判定，不再败在格式上。

### 13.4 精修 prompt 复用 `JSON_STRING_RULES` + “照抄结构只改文字”
`JSON_STRING_RULES`（判官那条“裸 ASCII 双引号→中文「」/反引号/\\"、换行用 \\n”硬规则）从 judge 模块 `export`，精修 prompt 末尾也拼上；并新增“【降低格式出错的关键做法】”——下面的【当前 topic JSON】本就是格式正确模板，保持字段名/括号层级/转义一致、只改文字内容。`retries` 默认 1→2（keptOld 已 break、不吃重试预算，提 retries 几乎只惠及格式/限流自愈）。

### 13.5 重试统计虚高 —— 已修
`refineOneTopic` 失败/keptOld 的底部 return 原用 `attempts`（=配置上限 retries+1），不是实际跑的次数 → keptOld 一次 break 也被报成 attempts=2、汇总“N 篇触发重试”虚高、progress.jsonl 不准。**改法**：新增 `attemptsMade`（每轮迭代记实际 attempt），底部 return 用它。实测：12 篇 attempt1 keptOld → 正确显示“本次无 topic 触发重试”。

### 13.6 评分内容是否“足够”——结论
静态 `scoreTopic` = `min(positiveScore, legacyScore, scoreCap)` 三取最小 + 8 维地板（structure/depth/expertise/clarity/visual/interview/assessment/hygiene 各有最低占比），反刷分扎实、维度间不可补偿。但**它全是启发式/正则代理，本质测不了事实正确性/代码正确性/图示语义对错**——这些只能靠 8 维判官（accuracy + factFindings）。所以“评分是否足够”取决于判官强度：判官默认=精修同模型=模型自评，有盲区。**结论与建议**：判分基础统一可靠（静态==门禁，实测 17/17 一致），但要让“失败=真不合格”更可信，应给判官配**更强/独立模型 + judge-count≥2**；静态层已足够当地板，无需再加规则（再加只会增加可被 Goodhart 的代理指标）。
