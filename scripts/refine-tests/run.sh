#!/usr/bin/env bash
# 精修器回归测试（纯函数单测）。
# 精修器现为 API 模式（CLI 模式已移除）；端到端测试需另起 OpenAI-compatible mock server，暂未提供。
#   - judge_unit：判官聚合/判通过/接受判据（含互证 corroborated）。
#   - refine_unit：互证交集 / remove 块操作 / headroom 提取 / 外部信号。
#   - pool_visual_unit：池化与视觉 QA、内置 web 工具 / 搜索解析。
#   - diagram_candidates_unit：图候选选优。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# 把判官缓存 / runDir / fact-cache / visual-cache 等产物隔离到临时目录，绝不碰仓库里真实的 .quality-refine。
export QUALITY_REFINE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/refine-tests.XXXXXX")"
cleanup() { rm -rf "$QUALITY_REFINE_DIR" 2>/dev/null || true; }
trap cleanup EXIT

PASS=0
FAIL=0
run_unit() { # $1=文件 $2=标签
  if node "$1"; then PASS=$((PASS + 1)); echo "  ✓ PASS [$2]"; else FAIL=$((FAIL + 1)); echo "  ✗ FAIL [$2]"; fi
}

echo "########## 0) 判官纯函数单测 ##########"
run_unit scripts/refine-tests/judge_unit.mjs judge-unit

echo
echo "########## 0.05) 精修器纯函数单测（互证/remove/headroom/外部信号）##########"
run_unit scripts/refine-tests/refine_unit.mjs refine-unit

echo
echo "########## 0.1) 池化与视觉 QA 单测 ##########"
run_unit scripts/refine-tests/pool_visual_unit.mjs pool-visual-unit

echo
echo "########## 0.2) 图候选选优单测 ##########"
run_unit scripts/refine-tests/diagram_candidates_unit.mjs diagram-candidates-unit

echo
echo "########## 结果：PASS=$PASS  FAIL=$FAIL ##########"
[ "$FAIL" -eq 0 ]
