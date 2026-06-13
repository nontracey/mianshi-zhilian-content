#!/usr/bin/env bash
# 精修器回归测试：
#   - 判官纯函数单测（聚合/判通过/接受判据）。
#   - Phase 0 锁字段 + Phase 1 静态 keep-best（--no-judge）。
#   - Phase 2 判官进回路 e2e（判官接受改善 / 已达标免改 / 拦截静态查不出的事实退化）。
#   - Phase 3 块级 keep-best（部分好部分差 -> 只吸收好块，坏块回退）。
# 对一篇真实发布态 topic 跑精修器（mock CLI 做确定性变换），断言磁盘最终状态；每例结束用 git 还原。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MOCK="$ROOT/scripts/refine-tests/mock_cli.mjs"
chmod +x "$MOCK"
export MOCK_TEMPLATE_SENTENCE="建议结合实际项目理解这个知识点的价值并多加练习。"
export MOCK_FACTBUG_SENTENCE="在所有情况下该机制都会以完全相反的方式工作并保证零开销且无任何代价。"
export MOCK_SUBTLE_BAD_SENTENCE="这个问题要看具体情况，结合项目经验灵活回答即可。"

T="topics/go/goroutine-gmp.json"
PASS=0
FAIL=0

cleanup() { git checkout -- "$T" 2>/dev/null || true; }
trap cleanup EXIT
ensure_clean() { git checkout -- "$T" 2>/dev/null || true; }

# 静态模式（--no-judge）：测 Phase 0/1
run_static() {
  MOCK_MODE="$1" node scripts/quality_refine.mjs \
    --cli "$MOCK" --no-judge --scope all --topic "$T" \
    --max-rounds 1 --retries 0 --concurrency 1 --progress-style topic --min-score 90 2>&1
}
# 判官模式：测 Phase 2（判官 CLI 用同一个 mock）。$2.. 透传额外参数（如 --dynamic-skip-min）
run_judge() {
  local mode="$1"; shift
  MOCK_MODE="$mode" node scripts/quality_refine.mjs \
    --cli "$MOCK" --judge-cli "$MOCK" --scope all --topic "$T" \
    --max-rounds 1 --retries 0 --concurrency 1 --progress-style topic --min-score 90 "$@" 2>&1
}

predegrade() { # 直接给磁盘写入一句泛化语，制造低分现版
  node -e 'const fs=require("fs");const p=process.argv[1];const s=process.env.MOCK_TEMPLATE_SENTENCE;const t=JSON.parse(fs.readFileSync(p,"utf8"));const e=t.learningCards.find(c=>c.type==="explain");e.content=(e.content||"")+"\n"+s;fs.writeFileSync(p,JSON.stringify(t,null,2)+"\n");' "$T"
}

assert_no_diff() { # 文件相对 HEAD 无改动
  if git diff --quiet -- "$T"; then echo "  ✓ PASS [$1]"; PASS=$((PASS+1)); else echo "  ✗ FAIL [$1] 文件被改动"; git --no-pager diff --stat -- "$T"; FAIL=$((FAIL+1)); fi
}
assert_absent() { # 文件不包含某串（候选被拒、没写进去）
  if ! grep -qF "$2" "$T"; then echo "  ✓ PASS [$1]"; PASS=$((PASS+1)); else echo "  ✗ FAIL [$1] 不该出现的内容被写入了"; FAIL=$((FAIL+1)); fi
}
assert_contains_out() { # 输出含某日志
  if echo "$1" | grep -qF "$2"; then echo "  ✓ PASS [log:$2]"; PASS=$((PASS+1)); else echo "  ✗ FAIL [log:$2] 未见日志"; FAIL=$((FAIL+1)); fi
}

echo "########## 0) 判官纯函数单测 ##########"
if node scripts/refine-tests/judge_unit.mjs; then PASS=$((PASS+1)); echo "  ✓ PASS [judge-unit]"; else FAIL=$((FAIL+1)); echo "  ✗ FAIL [judge-unit]"; fi

echo "########## 1) Phase 0/1：静态 keep-best + 锁字段（--no-judge）##########"
echo "[1.1] inject（改烂）→ 保留旧版"
ensure_clean; out="$(run_static inject)"; assert_contains_out "$out" "保留旧版"; assert_no_diff "inject→keep"
echo "[1.2] strip（改好，先预降级）→ 写回更优版"
ensure_clean; predegrade; out="$(run_static strip)"; assert_contains_out "$out" "已写回"; assert_no_diff "strip→written"
echo "[1.3] downgrade（difficulty 下调）→ 拦截"
ensure_clean; out="$(run_static downgrade)"; assert_contains_out "$out" "difficulty 被下调"; assert_no_diff "downgrade→invariant"
echo "[1.4] droptag（删 tags，元数据锁先拦）→ 拦截"
ensure_clean; out="$(run_static droptag)"; assert_contains_out "$out" "tags 被改动"; assert_no_diff "droptag→invariant"
echo "[1.5] changetags（改元数据）→ 拦截"
ensure_clean; out="$(run_static changetags)"; assert_contains_out "$out" "tags 被改动"; assert_no_diff "changetags→invariant"
echo "[1.6] dropsummary（删非元数据字段）→ 走“字段被删除”分支拦截"
ensure_clean; out="$(run_static dropsummary)"; assert_contains_out "$out" "原有字段被删除"; assert_no_diff "dropsummary→invariant"

echo "########## 2) Phase 2：判官进回路 ##########"
rm -rf .quality-refine/judge-cache 2>/dev/null || true
echo "[2.1] 判官接受真改善（预降级→strip，judge-after 动态升）→ 写回"
ensure_clean; predegrade; out="$(run_judge strip)"; assert_contains_out "$out" "已写回"; assert_no_diff "judge:strip→written"
echo "[2.2] 已达标免改（现版干净，judge-before 通过）→ 跳过改写、不动盘"
ensure_clean; out="$(run_judge identity)"; assert_contains_out "$out" "已达标，跳过改写"; assert_no_diff "judge:alreadyGood→skip"
echo "[2.3] 拦截静态查不出的事实退化（dynamic-skip-min 99 强制改写，候选含事实错）→ 保留旧版、不写入事实错"
ensure_clean; out="$(run_judge factbug --dynamic-skip-min 99)"; assert_contains_out "$out" "保留旧版"; assert_absent "judge:factbug-blocked(absent)" "$MOCK_FACTBUG_SENTENCE"; assert_no_diff "judge:factbug→keep"

echo "########## 3) Phase 3：块级 keep-best + 整篇复判 ##########"
rm -rf .quality-refine/judge-cache 2>/dev/null || true
echo "[3.1] 候选部分好部分差（strip explain + factbug interview）→ 只吸收好块，事实错回退"
ensure_clean; predegrade; out="$(run_judge partial)"; assert_contains_out "$out" "块级合并已写回"; assert_absent "phase3:factbug-blocked(absent)" "$MOCK_FACTBUG_SENTENCE"; assert_absent "phase3:template-stripped(absent)" "$MOCK_TEMPLATE_SENTENCE"; assert_no_diff "phase3:partial→merged"
echo "[3.2] 候选改 explain 标题但内容相似 → 仍匹配旧块，不当新增重复块"
ensure_clean; predegrade; out="$(run_judge rename)"; assert_contains_out "$out" "块级合并已写回"; assert_absent "phase3:rename-template-stripped(absent)" "$MOCK_TEMPLATE_SENTENCE"; assert_absent "phase3:rename-no-duplicate-marker(absent)" "副本"; ensure_clean
echo "[3.3] 候选复制一张 explain → 重复块守卫拒绝副本，只吸收好块"
ensure_clean; predegrade; out="$(run_judge duplicate)"; assert_contains_out "$out" "块级合并已写回"; assert_absent "phase3:duplicate-marker-blocked(absent)" "副本"; assert_absent "phase3:duplicate-template-stripped(absent)" "$MOCK_TEMPLATE_SENTENCE"; assert_no_diff "phase3:duplicate→merged-without-copy"
echo "[3.4] 候选追问答案变空泛 → block-level verdict 拦截追问坏块"
ensure_clean; predegrade; out="$(run_judge subtlebad)"; assert_contains_out "$out" "块级合并已写回"; assert_absent "phase3:subtlebad-blocked(absent)" "$MOCK_SUBTLE_BAD_SENTENCE"; assert_absent "phase3:subtlebad-template-stripped(absent)" "$MOCK_TEMPLATE_SENTENCE"; assert_no_diff "phase3:subtlebad→merged"

echo
echo "########## 结果：PASS=$PASS  FAIL=$FAIL ##########"
[ "$FAIL" -eq 0 ]
