#!/usr/bin/env bash
set -eo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -t 1 ]]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  CYAN="$(printf '\033[36m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  RED="$(printf '\033[31m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""
  DIM=""
  CYAN=""
  GREEN=""
  YELLOW=""
  RED=""
  RESET=""
fi

STAGE_TARGET="all"
STAGE_LABEL=""
RUN_MODE="refine"
RUN_MODE_LABEL=""
# 测试跑：走和正式精修完全一样的真实流程（审计→判官预热→keep-best→写回→validate→同步），
# 只是把目标钉成选定领域里的一篇（随机/指定），用来快速验证整条流程。RUN_MODE 仍是 refine，
# 仅靠 TEST_RUN=1 把 topic 选择强制成单篇、并打上"测试跑"标签；其余选择项与正式一致。
TEST_RUN=0
MIN_SCORE=95
CONCURRENCY=3
MAX_ROUNDS=3
RETRIES=2
TIMEOUT_SECONDS=600
DEGRADE_AFTER=3
LIMIT=""
MODEL_CHAIN=""
JUDGE_ENABLED=1
JUDGE_MODELS=""   # 空 = 跟精修主模型一致
JUDGE_COUNT=1
DYNAMIC_SKIP_MIN=95
JUDGE_BATCH_SIZE=1
JUDGE_JSON_RETRIES=2
JUDGE_WARM_CONCURRENCY=""   # 空 = 跟随 CONCURRENCY
PROGRESS_STYLE="summary"
HEARTBEAT_SECONDS=60

# v3.3 新参数（向导步骤会询问；留空=用 .env 默认）
REFINE_PROFILE=""       # quick | deep | offline
ALLOW_PAID_DIAGRAM=0
HEALTH_PORT=""
MAX_COST_PER_RUN=""
MAX_TOKENS_PER_RUN=""
STALL_TIMEOUT_SECONDS=150
RESUME_LAST=1
QUOTA_PAUSE_POLICY=""  # 空 = 用 .env QUOTA_PAUSE_DEFAULT
SELECTED_DOMAIN_IDS=()
SCOPE_ARGS=()
TOPIC_REF=""
SELECTED_TOPIC_REFS=()
TOPIC_SELECTION_LABEL="全部 topic"
ASK_VALUE=""

# --last 短路：命令行加 --last 后跳过中间所有题，仅保留 SCOPE/LIMIT/MAX_ROUNDS 让用户回车确认。
REPLAY_FLAG=0
LAST_CONFIG_FILE=".quality-refine/last-config.env"
# API 模式：CLI 模式已移除；模型 spec 为 "provider:modelId"，baseUrl/envKey 由 mjs 端
# env-config.mjs 在运行时按 spec 反查，不再持久化到 last-config。
# 旧版 last-config 不兼容（带 SELECTED_CLI / CHAIN_BASE_URLS 等已废弃字段），自动丢弃退手选。
LAST_CONFIG_VERSION=6

# 模型 chain 单平行数组：仅存 spec（"provider:modelId"），不再保留路由元数据。
MODEL_CHAIN_ITEMS=()

hr() {
  printf '%s\n' "${DIM}────────────────────────────────────────────────────────${RESET}"
}

title() {
  printf '\n%s%s%s\n' "$BOLD$CYAN" "$1" "$RESET"
  hr
}

info() {
  printf '%s\n' "${DIM}$1${RESET}"
}

die() {
  printf '%s\n' "${RED}错误：$1${RESET}" >&2
  exit 1
}

is_back_input() {
  case "$1" in
    b|B|back|BACK|prev|previous|上一步|返回) return 0 ;;
    *) return 1 ;;
  esac
}

is_quit_input() {
  case "$1" in
    q|Q|quit|QUIT|exit|EXIT|退出|取消) return 0 ;;
    *) return 1 ;;
  esac
}

check_nav_input() {
  if is_back_input "$1"; then
    return 2
  fi
  if is_quit_input "$1"; then
    return 130
  fi
  return 0
}

prompt_suffix() {
  printf '%s' "${DIM}（b=上一步，q=退出）${RESET}"
}

read_required() {
  local prompt="$1"
  local value
  while true; do
    printf '%s' "$prompt" >&2
    IFS= read -r value || exit 1
    check_nav_input "$value" || return $?
    if [[ -n "$value" ]]; then
      ASK_VALUE="$value"
      return
    fi
  done
}

ask_number() {
  local label="$1"
  local default="$2"
  local min="$3"
  local max="$4"
  local value
  while true; do
    printf '%s [%s] %s: ' "$label" "$default" "$(prompt_suffix)" >&2
    IFS= read -r value || exit 1
    check_nav_input "$value" || return $?
    value="${value:-$default}"
    if [[ "$value" =~ ^[0-9]+$ ]] && (( value >= min && value <= max )); then
      ASK_VALUE="$value"
      printf '%s\n' "$value"
      return
    fi
    printf '%s\n' "${YELLOW}请输入 ${min}-${max} 之间的整数。${RESET}" >&2
  done
}

ask_optional_number() {
  local label="$1"
  local min="$2"
  local max="$3"
  local value
  while true; do
    printf '%s [空=不限] %s: ' "$label" "$(prompt_suffix)" >&2
    IFS= read -r value || exit 1
    check_nav_input "$value" || return $?
    if [[ -z "$value" ]]; then
      ASK_VALUE=""
      printf '\n'
      return
    fi
    if [[ "$value" =~ ^[0-9]+$ ]] && (( value >= min && value <= max )); then
      ASK_VALUE="$value"
      printf '%s\n' "$value"
      return
    fi
    printf '%s\n' "${YELLOW}请输入 ${min}-${max} 之间的整数，或直接回车。${RESET}" >&2
  done
}

ask_yes_no() {
  local label="$1"
  local default="$2"
  local value suffix
  if [[ "$default" == "1" ]]; then suffix="Y/n"; else suffix="y/N"; fi
  while true; do
    printf '%s [%s] %s: ' "$label" "$suffix" "$(prompt_suffix)" >&2
    IFS= read -r value || exit 1
    check_nav_input "$value" || return $?
    value="${value:-$([[ "$default" == "1" ]] && printf y || printf n)}"
    case "$value" in
      y|Y|yes|YES|是) ASK_VALUE=1; return 0 ;;
      n|N|no|NO|否) ASK_VALUE=0; return 0 ;;
      *) printf '%s\n' "${YELLOW}请输入 y 或 n。${RESET}" >&2 ;;
    esac
  done
}

contains_value() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

join_by() {
  local IFS="$1"
  shift
  printf '%s' "$*"
}

expand_selection() {
  local raw="$1"
  local max="$2"
  local cleaned part start end number
  local selected=()
  cleaned="${raw//，/,}"
  cleaned="${cleaned//、/,}"
  cleaned="${cleaned// /,}"
  IFS=',' read -r -a parts <<< "$cleaned"
  for part in "${parts[@]}"; do
    [[ -z "$part" ]] && continue
    if [[ "$part" =~ ^[0-9]+-[0-9]+$ ]]; then
      start="${part%-*}"
      end="${part#*-}"
      if (( start > end )); then
        local tmp="$start"
        start="$end"
        end="$tmp"
      fi
      for (( number = start; number <= end; number += 1 )); do
        if (( number >= 1 && number <= max )) && ! contains_value "$number" "${selected[@]}"; then
          selected+=("$number")
        fi
      done
    elif [[ "$part" =~ ^[0-9]+$ ]]; then
      number="$part"
      if (( number >= 1 && number <= max )) && ! contains_value "$number" "${selected[@]}"; then
        selected+=("$number")
      fi
    fi
  done
  printf '%s\n' "${selected[@]}"
}

load_domains() {
  DOMAIN_IDS=()
  DOMAIN_TITLES=()
  DOMAIN_COUNTS=()
  local line id title count
  while IFS=$'\t' read -r id title count; do
    DOMAIN_IDS+=("$id")
    DOMAIN_TITLES+=("$title")
    DOMAIN_COUNTS+=("$count")
  done < <(node - <<'NODE'
const { readFileSync } = require("node:fs");
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
for (const domain of manifest.domains || []) {
  console.log(`${domain.id}\t${domain.title || domain.id}\t${domain.topicCount || 0}`);
}
NODE
)
}

choose_stage() {
  title "选择阶段"
  printf '1. 全部：精修发布 topics/，成功后同步到 staging + draft\n'
  printf '2. 仅测试：精修发布 topics/，成功后只同步到 staging\n'
  printf '3. 仅草稿：精修发布 topics/，成功后只同步到 draft\n'
  local choice
  while true; do
    printf '请选择 [1] %s: ' "$(prompt_suffix)" >&2
    IFS= read -r choice || exit 1
    check_nav_input "$choice" || return $?
    choice="${choice:-1}"
    case "$choice" in
      1) STAGE_TARGET="all"; STAGE_LABEL="全部（发布 -> 测试+草稿）"; return 0 ;;
      2) STAGE_TARGET="staging"; STAGE_LABEL="仅测试（发布 -> staging）"; return 0 ;;
      3) STAGE_TARGET="draft"; STAGE_LABEL="仅草稿（发布 -> draft）"; return 0 ;;
      *) printf '%s\n' "${YELLOW}未知阶段选项：$choice${RESET}" >&2 ;;
    esac
  done
}

choose_run_mode() {
  title "选择运行模式"
  printf '1. 正式精修：批量调用 agent，写回 topics/，完成后按阶段同步\n'
  printf '2. 测试跑：和正式精修完全相同的真实流程，但只跑选定领域里的一篇（随机/指定），用来验证流程\n'
  printf '3. 仅审计：不调用 agent，只列出当前待修内容\n'
  local choice
  while true; do
    printf '请选择 [1] %s: ' "$(prompt_suffix)" >&2
    IFS= read -r choice || exit 1
    check_nav_input "$choice" || return $?
    choice="${choice:-1}"
    case "$choice" in
      1) RUN_MODE="refine"; TEST_RUN=0; RUN_MODE_LABEL="正式精修"; return 0 ;;
      # 测试跑 = 正式精修的真实流程，只是 TEST_RUN=1 把目标钉成单篇；RUN_MODE 仍是 refine，
      # 这样选 CLI/模型/判官/参数全部自动走 refine 那套，执行也走 run_refine（含 validate+同步）。
      2) RUN_MODE="refine"; TEST_RUN=1; RUN_MODE_LABEL="测试跑（单篇·真实流程）"; return 0 ;;
      3) RUN_MODE="audit"; TEST_RUN=0; RUN_MODE_LABEL="仅审计"; return 0 ;;
      *) printf '%s\n' "${YELLOW}未知运行模式：$choice${RESET}" >&2 ;;
    esac
  done
}

choose_domains() {
  title "选择领域"
  printf '0. 全部领域\n'
  local index
  for (( index = 0; index < ${#DOMAIN_IDS[@]}; index += 1 )); do
    printf '%2d. %-18s %s%s%s  %s篇\n' \
      "$((index + 1))" \
      "${DOMAIN_IDS[$index]}" \
      "$DIM" "${DOMAIN_TITLES[$index]}" "$RESET" \
      "${DOMAIN_COUNTS[$index]}"
  done
  printf '\n可输入单个编号、多个编号（如 1,3,5）、范围（如 2-6），或 0=全部。\n'
  local choice selections selected idx id
  while true; do
    printf '请选择 [0] %s: ' "$(prompt_suffix)" >&2
    IFS= read -r choice || exit 1
    check_nav_input "$choice" || return $?
    choice="${choice:-0}"
    if [[ "$choice" == "0" || "$choice" == "*" || "$choice" == "all" ]]; then
      SELECTED_DOMAIN_IDS=("all")
      SCOPE_ARGS=("all")
      TOPIC_REF=""
      SELECTED_TOPIC_REFS=()
      TOPIC_SELECTION_LABEL="全部 topic"
      return 0
    fi
    selections="$(expand_selection "$choice" "${#DOMAIN_IDS[@]}")"
    if [[ -z "$selections" ]]; then
      printf '%s\n' "${YELLOW}没有选中任何有效领域。${RESET}" >&2
      continue
    fi
    SELECTED_DOMAIN_IDS=()
    SCOPE_ARGS=()
    while IFS= read -r selected; do
      [[ -z "$selected" ]] && continue
      idx=$((selected - 1))
      id="${DOMAIN_IDS[$idx]}"
      SELECTED_DOMAIN_IDS+=("$id")
      SCOPE_ARGS+=("domain:$id")
    done <<< "$selections"
    TOPIC_REF=""
    SELECTED_TOPIC_REFS=()
    TOPIC_SELECTION_LABEL="全部 topic"
    return 0
  done
}

choose_cli() {
  # CLI 模式已移除（精修器只走 API）。保留空函数仅因向导步骤号还占着 5；直接放行。
  return 0
}

discover_models() {
  # API 模式:直接从 scripts/llm/env-config.mjs 读当前配置可用的 OpenAI 兼容 spec。
  # 输出 4 列 TSV: spec \t label \t baseUrl \t envKey  (spec = "<provider>:<modelId>")
  # 只列 .env 里有 apiKey 的 spec(没 key 的 provider 跑不了,藏起来免误选)。
  node -e '
    import("./scripts/llm/env-config.mjs").then(({ envConfig }) => {
      const models = envConfig.listModels({ hasKey: true });
      for (const m of models) {
        const spec = `${m.provider}:${m.id}`;
        console.log(`${spec}\t${m.name}\t${m.baseUrl}\t${m.apiKeyEnv}`);
      }
    }).catch((e) => { console.error("[discover_models]", e.message); process.exit(1); });
  '
}

choose_model_chain() {
  title "选择精修模型链（默认走 .env REFINE_MODEL_CHAIN）"
  MODEL_VALUES=()
  MODEL_LABELS=()
  MODEL_BASE_URLS=()
  MODEL_ENV_KEYS=()
  CHAIN_BASE_URLS=()
  CHAIN_ENV_KEYS=()
  local line value label base_url env_key
  while IFS=$'\t' read -r value label base_url env_key; do
    [[ -z "$value" ]] && continue
    [[ -z "$label" ]] && label="$value"
    MODEL_VALUES+=("$value")
    MODEL_LABELS+=("$label")
    MODEL_BASE_URLS+=("$base_url")
    MODEL_ENV_KEYS+=("$env_key")
  done < <(discover_models)

  # 读 .env 的默认精修链作为"回车=接受"
  local env_default
  env_default="$(grep -E '^REFINE_MODEL_CHAIN=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
  env_default="${env_default:-zhipu:glm-4.7-flash,longcat:LongCat-2.0-Preview}"

  local index choice custom selections selected idx rc
  if (( ${#MODEL_VALUES[@]} )); then
    printf '0. 使用 .env REFINE_MODEL_CHAIN：%s（推荐，回车跳过）\n' "$env_default"
    for (( index = 0; index < ${#MODEL_VALUES[@]}; index += 1 )); do
      printf '%2d. %s\n' "$((index + 1))" "${MODEL_LABELS[$index]}"
    done
    printf ' c. 手动输入模型链（逗号分隔的 provider:modelId）\n'
    printf '\n可直接输入降级顺序，例如 1,2,3；第一个不可用连续达到阈值后会降到下一个。\n'
    while true; do
      printf '请选择 [0] %s: ' "$(prompt_suffix)" >&2
      IFS= read -r choice || exit 1
      check_nav_input "$choice" || return $?
      choice="${choice:-0}"
      if [[ "$choice" == "0" ]]; then
        MODEL_CHAIN=""  # 空 = 让 mjs 端读 .env 默认
        return 0
      elif [[ "$choice" == "c" || "$choice" == "C" ]]; then
        if read_required "模型链（如 zhipu:glm-4.7-flash,longcat:LongCat-2.0-Preview）$(prompt_suffix): "; then
          :
        else
          rc=$?; return "$rc"
        fi
        MODEL_CHAIN="$ASK_VALUE"
        CHAIN_BASE_URLS=()
        CHAIN_ENV_KEYS=()
        return 0
      else
        selections="$(expand_selection "$choice" "${#MODEL_VALUES[@]}")"
        if [[ -z "$selections" ]]; then
          printf '%s\n' "${YELLOW}没有选中任何有效模型。${RESET}" >&2
          continue
        fi
        MODEL_CHAIN_ITEMS=()
        CHAIN_BASE_URLS=()
        CHAIN_ENV_KEYS=()
        while IFS= read -r selected; do
          [[ -z "$selected" ]] && continue
          idx=$((selected - 1))
          MODEL_CHAIN_ITEMS+=("${MODEL_VALUES[$idx]}")
          CHAIN_BASE_URLS+=("${MODEL_BASE_URLS[$idx]}")
          CHAIN_ENV_KEYS+=("${MODEL_ENV_KEYS[$idx]}")
        done <<< "$selections"
        MODEL_CHAIN="$(join_by "," "${MODEL_CHAIN_ITEMS[@]}")"
        return 0
      fi
    done
  else
    info "未能从配置中发现模型,使用 .env REFINE_MODEL_CHAIN($env_default)。"
    MODEL_CHAIN=""
    return 0
  fi
}

choose_judge_models() {
  title "选择判官模型（默认走 .env JUDGE_MODEL_CHAIN）"
  info "判官评\"静态分查不出的\"事实正确性、认知顺序、零基础可读性、面试覆盖。回车=用 .env JUDGE_MODEL_CHAIN（默认 LongCat + GLM-4.7-Flash）；0=不启用判官（纯静态、最快，deep 严格启动会拒绝）。"
  JUDGE_MODEL_VALUES=()
  JUDGE_MODEL_LABELS=()
  JUDGE_MODEL_BASE_URLS=()
  JUDGE_MODEL_ENV_KEYS=()
  JUDGE_CHAIN_BASE_URLS=()
  JUDGE_CHAIN_ENV_KEYS=()
  local line value label base_url env_key
  while IFS=$'\t' read -r value label base_url env_key; do
    [[ -z "$value" ]] && continue
    [[ -z "$label" ]] && label="$value"
    JUDGE_MODEL_VALUES+=("$value")
    JUDGE_MODEL_LABELS+=("$label")
    JUDGE_MODEL_BASE_URLS+=("$base_url")
    JUDGE_MODEL_ENV_KEYS+=("$env_key")
  done < <(discover_models)

  # 读 .env 默认判官链
  local env_default
  env_default="$(grep -E '^JUDGE_MODEL_CHAIN=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
  env_default="${env_default:-longcat:LongCat-2.0-Preview,zhipu:glm-4.7-flash}"

  local index choice selections selected idx items
  printf ' 0. 不启用判官（纯静态 keep-best，最快）\n'
  printf ' d. 使用 .env JUDGE_MODEL_CHAIN：%s（推荐，回车跳过）\n' "$env_default"
  for (( index = 0; index < ${#JUDGE_MODEL_VALUES[@]}; index += 1 )); do
    printf '%2d. %s\n' "$((index + 1))" "${JUDGE_MODEL_LABELS[$index]}"
  done
  printf '\n可多选组成 ensemble（如 1,3）；回车=.env 默认；0=不启用。\n'
  while true; do
    printf '请选择 [d=.env 默认] %s: ' "$(prompt_suffix)" >&2
    IFS= read -r choice || exit 1
    check_nav_input "$choice" || return $?
    choice="${choice:-d}"
    if [[ "$choice" == "0" ]]; then
      JUDGE_ENABLED=0
      JUDGE_MODELS=""
      return 0
    fi
    if [[ "$choice" == "d" || "$choice" == "D" ]]; then
      JUDGE_ENABLED=1
      JUDGE_MODELS=""  # 空 = 让 mjs 端读 .env 默认
      JUDGE_CHAIN_BASE_URLS=()
      JUDGE_CHAIN_ENV_KEYS=()
      return 0
    fi
    selections="$(expand_selection "$choice" "${#JUDGE_MODEL_VALUES[@]}")"
    if [[ -z "$selections" ]]; then
      printf '%s\n' "${YELLOW}没有选中有效模型。${RESET}" >&2
      continue
    fi
    items=()
    JUDGE_CHAIN_BASE_URLS=()
    JUDGE_CHAIN_ENV_KEYS=()
    while IFS= read -r selected; do
      [[ -z "$selected" ]] && continue
      idx=$((selected - 1))
      items+=("${JUDGE_MODEL_VALUES[$idx]}")
      JUDGE_CHAIN_BASE_URLS+=("${JUDGE_MODEL_BASE_URLS[$idx]}")
      JUDGE_CHAIN_ENV_KEYS+=("${JUDGE_MODEL_ENV_KEYS[$idx]}")
    done <<< "$selections"
    JUDGE_ENABLED=1
    JUDGE_MODELS="$(join_by "," "${items[@]}")"
    return 0
  done
}

choose_judge_count() {
  # 未启用判官则本步无内容，直接通过（步骤跳转已据 JUDGE_ENABLED 决定是否进入本步）。
  [[ "$JUDGE_ENABLED" == "1" ]] || return 0
  title "判官参数（投票/免改线/批量/并发）"
  info "批量大小决定每个 qwen 子进程一次判几个 topic：批=1 最稳但 425 个 topic 要冷启 425 次；批=3-5 可省冷启时间，代价是同批挂掉会连坐。"
  local idx=0 rc warm_default
  warm_default="${JUDGE_WARM_CONCURRENCY:-$CONCURRENCY}"
  while (( idx < 4 )); do
    case "$idx" in
      0) ask_number "每个判官模型跑几个判官实例 judge-count（>1 用投票压方差，需模型温度>0）" "$JUDGE_COUNT" 1 8 >/dev/null; rc=$? ;;
      1) ask_number "动态免改线 dynamic-skip-min（低于此分进入改写；候选接受仍看回归向量）" "$DYNAMIC_SKIP_MIN" 1 100 >/dev/null; rc=$? ;;
      2) ask_number "判官批量大小 judge-batch-size（一次几个 topic 喂给一个 qwen 子进程；1=最稳，5=省冷启）" "$JUDGE_BATCH_SIZE" 1 10 >/dev/null; rc=$? ;;
      3) ask_number "判前预热并发 judge-warm-concurrency（同时跑几路 qwen 子进程；默认与精修并发一致）" "$warm_default" 1 8 >/dev/null; rc=$? ;;
    esac
    if (( rc == 0 )); then
      case "$idx" in
        0) JUDGE_COUNT="$ASK_VALUE" ;;
        1) DYNAMIC_SKIP_MIN="$ASK_VALUE" ;;
        2) JUDGE_BATCH_SIZE="$ASK_VALUE" ;;
        3) JUDGE_WARM_CONCURRENCY="$ASK_VALUE" ;;
      esac
      idx=$((idx + 1))
    elif (( rc == 2 )); then
      if (( idx == 0 )); then return 2; fi
      idx=$((idx - 1))
    else
      return "$rc"
    fi
  done
  return 0
}

choose_quality_options() {
  title "执行参数"
  # 按 RUN_MODE 动态构造题表（每题一个 id），子题 b 只回退到上一题，第一题 b 才整步退回。
  local -a fields=("min")
  if [[ "$RUN_MODE" == "refine" ]]; then
    fields+=("conc" "rounds" "limit" "resume")
  fi
  if [[ "$RUN_MODE" != "audit" ]]; then
    fields+=("retries" "timeout" "stall" "degrade" "quota")
  fi
  local total="${#fields[@]}"
  local idx=0 rc field
  local quota_default
  quota_default="$(grep -E '^QUOTA_PAUSE_DEFAULT=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
  quota_default="${quota_default:-manual}"
  while (( idx < total )); do
    field="${fields[$idx]}"
    case "$field" in
      min)     ask_number "合格分 min-score" "$MIN_SCORE" 1 100 >/dev/null; rc=$? ;;
      conc)    ask_number "并发数 concurrency" "$CONCURRENCY" 1 8 >/dev/null; rc=$? ;;
      rounds)  ask_number "最大轮数 max-rounds" "$MAX_ROUNDS" 1 10 >/dev/null; rc=$? ;;
      limit)   ask_optional_number "每轮最多处理篇数 limit" 1 9999 >/dev/null; rc=$? ;;
      resume)  ask_yes_no "自动续跑最近一次未完成精修（跳过 progress.jsonl 已完成 topic）" "$RESUME_LAST"; rc=$? ;;
      retries) ask_number "单篇失败重试次数 retries" "$RETRIES" 0 5 >/dev/null; rc=$? ;;
      timeout) ask_number "单篇超时秒数" "$TIMEOUT_SECONDS" 30 7200 >/dev/null; rc=$? ;;
      stall)   ask_number "空转看门狗秒数（0=关闭）" "$STALL_TIMEOUT_SECONDS" 0 7200 >/dev/null; rc=$? ;;
      degrade) ask_number "连续多少次 API 不可用后降级模型" "$DEGRADE_AFTER" 1 50 >/dev/null; rc=$? ;;
      quota)   ask_quota_policy "$quota_default"; rc=$? ;;
    esac
    if (( rc == 0 )); then
      case "$field" in
        min)     MIN_SCORE="$ASK_VALUE" ;;
        conc)    CONCURRENCY="$ASK_VALUE" ;;
        rounds)  MAX_ROUNDS="$ASK_VALUE" ;;
        limit)   LIMIT="$ASK_VALUE" ;;
        resume)  RESUME_LAST="$ASK_VALUE" ;;
        retries) RETRIES="$ASK_VALUE" ;;
        timeout) TIMEOUT_SECONDS="$ASK_VALUE" ;;
        stall)   STALL_TIMEOUT_SECONDS="$ASK_VALUE" ;;
        degrade) DEGRADE_AFTER="$ASK_VALUE" ;;
        quota)   QUOTA_PAUSE_POLICY="$ASK_VALUE" ;;
      esac
      idx=$((idx + 1))
    elif (( rc == 2 )); then
      if (( idx == 0 )); then return 2; fi
      idx=$((idx - 1))
    else
      return "$rc"
    fi
  done
  return 0
}


# 选择额度耗尽时的行为：manual / auto-probe / skip
ask_quota_policy() {
  local default="$1"
  local choice
  printf '\n%s额度耗尽行为%s\n' "${BOLD}" "${RESET}" >&2
  printf '  1. manual    全局暂停,等手动按 Enter 继续(默认)\n' >&2
  printf '  2. auto-probe 自动按退避周期探活,额度恢复即继续\n' >&2
  printf '  3. skip      当前篇标记 quota-skip 跳下一篇\n' >&2
  while true; do
    printf '请选择 [%s] %s: ' "$default" "$(prompt_suffix)" >&2
    IFS= read -r choice || exit 1
    check_nav_input "$choice" || return $?
    choice="${choice:-$default}"
    case "$choice" in
      1|manual)     ASK_VALUE="manual"; return 0 ;;
      2|auto-probe) ASK_VALUE="auto-probe"; return 0 ;;
      3|skip)       ASK_VALUE="skip"; return 0 ;;
      *) printf '%s\n' "${YELLOW}请输入 1/2/3 或 manual/auto-probe/skip。${RESET}" >&2 ;;
    esac
  done
}

list_scope_topics() {
  local domain_csv="$1"
  local min_score="$2"
  node - "$domain_csv" "$min_score" <<'NODE'
const { spawnSync } = require("node:child_process");

const domainCsv = process.argv[2] || "all";
const domains = domainCsv.split(",").map((item) => item.trim()).filter(Boolean);
const minScore = process.argv[3] || "90";
const allowAll = domains.length === 0 || domains.includes("all");

const child = spawnSync(process.execPath, ["scripts/content_quality_audit.mjs", "--json", `--min-score=${minScore}`], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
if (!child.stdout.trim()) {
  process.stderr.write(child.stderr || "审计没有产出。\n");
  process.exit(child.status || 1);
}
const audit = JSON.parse(child.stdout);
const rows = (audit.allTopics || [])
  .filter((topic) => allowAll || domains.includes(String(topic.ref || "").split("/")[1]))
  .sort((a, b) => String(a.ref).localeCompare(String(b.ref)));
for (const topic of rows) console.log(`${topic.score}\t${topic.ref}\t${topic.title || ""}`);
NODE
}

pick_random_topic_ref() {
  local count="$1"
  node - "$count" <<'NODE'
const count = Number(process.argv[2] || 0);
if (!Number.isInteger(count) || count <= 0) process.exit(1);
console.log(Math.floor(Math.random() * count) + 1);
NODE
}

choose_topics() {
  title "选择 Topic"
  local domain_csv
  domain_csv="$(join_by "," "${SELECTED_DOMAIN_IDS[@]}")"
  TOPIC_SCORES=()
  TOPIC_REFS=()
  TOPIC_TITLES=()
  local line score ref topic_title index choice rc selections selected idx random_index manual
  while IFS=$'\t' read -r score ref topic_title; do
    [[ -z "$ref" ]] && continue
    TOPIC_SCORES+=("$score")
    TOPIC_REFS+=("$ref")
    TOPIC_TITLES+=("$topic_title")
  done < <(list_scope_topics "$domain_csv" "$MIN_SCORE")

  if (( ${#TOPIC_REFS[@]} == 0 )); then
    info "当前领域没有可选 topic。"
    while true; do
      printf 'm. 手动输入 topic 路径\n'
      printf 'b. 上一步\n'
      printf 'q. 退出\n'
      printf '请选择 [b] %s: ' "$(prompt_suffix)" >&2
      IFS= read -r choice || exit 1
      check_nav_input "$choice" || return $?
      choice="${choice:-b}"
      case "$choice" in
        b|B|back|BACK|prev|previous|上一步|返回) return 2 ;;
        m|M)
          if read_required "topic 路径 $(prompt_suffix): "; then :; else rc=$?; return "$rc"; fi
          TOPIC_REF="$ASK_VALUE"
          SELECTED_TOPIC_REFS=("$TOPIC_REF")
          TOPIC_SELECTION_LABEL="$TOPIC_REF"
          return 0
          ;;
        *) printf '%s\n' "${YELLOW}没有可选 topic。输入 m 手动指定，或 b 返回上一层。${RESET}" >&2 ;;
      esac
    done
  fi

  info "下面列出当前领域内全部 topic。静态分只作参考，>=${MIN_SCORE} 也会送 LLM 单篇精修。"
  for (( index = 0; index < ${#TOPIC_REFS[@]}; index += 1 )); do
    printf '%3d. %3s/100  %-58s %s%s%s\n' \
      "$((index + 1))" \
      "${TOPIC_SCORES[$index]}" \
      "${TOPIC_REFS[$index]}" \
      "$DIM" "${TOPIC_TITLES[$index]}" "$RESET"
  done

  if [[ "$TEST_RUN" == "1" ]]; then
    printf '\n测试跑只跑单篇（真实流程）：输入编号选择；直接回车或 r 随机一篇；m 手动输入路径。\n'
    printf 'b. 上一步\n'
    printf 'q. 退出\n'
    while true; do
      printf '请选择 [随机] %s: ' "$(prompt_suffix)" >&2
      IFS= read -r choice || exit 1
      check_nav_input "$choice" || return $?
      choice="${choice:-r}"
      if [[ "$choice" == "r" || "$choice" == "R" || "$choice" == "random" || "$choice" == "随机" ]]; then
        random_index="$(pick_random_topic_ref "${#TOPIC_REFS[@]}")"
        TOPIC_REF="${TOPIC_REFS[$((random_index - 1))]}"
        SELECTED_TOPIC_REFS=("$TOPIC_REF")
        TOPIC_SELECTION_LABEL="随机：$TOPIC_REF"
        return 0
      elif [[ "$choice" == "m" || "$choice" == "M" ]]; then
        if read_required "topic 路径 $(prompt_suffix): "; then :; else rc=$?; return "$rc"; fi
        TOPIC_REF="$ASK_VALUE"
        SELECTED_TOPIC_REFS=("$TOPIC_REF")
        TOPIC_SELECTION_LABEL="$TOPIC_REF"
        return 0
      else
        selections="$(expand_selection "$choice" "${#TOPIC_REFS[@]}")"
        if [[ -z "$selections" ]]; then
          printf '%s\n' "${YELLOW}未知 topic 选项：$choice${RESET}" >&2
          continue
        fi
        if (( $(printf '%s\n' "$selections" | sed '/^$/d' | wc -l | tr -d ' ') != 1 )); then
          printf '%s\n' "${YELLOW}测试跑一次只能选 1 篇。${RESET}" >&2
          continue
        fi
        selected="$selections"
        idx=$((selected - 1))
        TOPIC_REF="${TOPIC_REFS[$idx]}"
        SELECTED_TOPIC_REFS=("$TOPIC_REF")
        TOPIC_SELECTION_LABEL="$TOPIC_REF"
        return 0
      fi
    done
  fi

  printf '\n正式精修：0/回车=全部；可输入多个编号（如 1,3,5）或范围（如 2-6）；r 随机一篇；m 手动输入路径。\n'
  printf 'b. 上一步\n'
  printf 'q. 退出\n'
  while true; do
    printf '请选择 [0=全部] %s: ' "$(prompt_suffix)" >&2
    IFS= read -r choice || exit 1
    check_nav_input "$choice" || return $?
    choice="${choice:-0}"
    if [[ "$choice" == "0" || "$choice" == "*" || "$choice" == "all" || "$choice" == "全部" ]]; then
      TOPIC_REF=""
      SELECTED_TOPIC_REFS=()
      TOPIC_SELECTION_LABEL="全部 topic（${#TOPIC_REFS[@]} 篇）"
      return 0
    elif [[ "$choice" == "r" || "$choice" == "R" || "$choice" == "random" || "$choice" == "随机" ]]; then
      random_index="$(pick_random_topic_ref "${#TOPIC_REFS[@]}")"
      TOPIC_REF="${TOPIC_REFS[$((random_index - 1))]}"
      SELECTED_TOPIC_REFS=("$TOPIC_REF")
      TOPIC_SELECTION_LABEL="随机：$TOPIC_REF"
      return 0
    elif [[ "$choice" == "m" || "$choice" == "M" ]]; then
      if read_required "topic 路径，多个用逗号分隔 $(prompt_suffix): "; then :; else rc=$?; return "$rc"; fi
      manual="${ASK_VALUE//，/,}"
      manual="${manual//、/,}"
      IFS=',' read -r -a SELECTED_TOPIC_REFS <<< "$manual"
      TOPIC_REF="${SELECTED_TOPIC_REFS[0]}"
      TOPIC_SELECTION_LABEL="手动选择 ${#SELECTED_TOPIC_REFS[@]} 篇"
      return 0
    else
      selections="$(expand_selection "$choice" "${#TOPIC_REFS[@]}")"
      if [[ -z "$selections" ]]; then
        printf '%s\n' "${YELLOW}没有选中任何有效 topic。${RESET}" >&2
        continue
      fi
      SELECTED_TOPIC_REFS=()
      while IFS= read -r selected; do
        [[ -z "$selected" ]] && continue
        idx=$((selected - 1))
        SELECTED_TOPIC_REFS+=("${TOPIC_REFS[$idx]}")
      done <<< "$selections"
      TOPIC_REF="${SELECTED_TOPIC_REFS[0]}"
      TOPIC_SELECTION_LABEL="选择 ${#SELECTED_TOPIC_REFS[@]} 篇"
      return 0
    fi
  done
}

build_common_refine_args() {
  # 精修器只走 OpenAI 兼容 API（CLI 模式已移除）。模型路由全由 .env / env-config.mjs 决定。
  COMMON_ARGS=(
    --min-score "$MIN_SCORE"
    --retries "$RETRIES"
    --timeout-ms "$((TIMEOUT_SECONDS * 1000))"
    --stall-timeout-ms "$((STALL_TIMEOUT_SECONDS * 1000))"
    --degrade-after "$DEGRADE_AFTER"
    --progress-style "$PROGRESS_STYLE"
    --heartbeat-seconds "$HEARTBEAT_SECONDS"
  )
  if [[ -n "$MODEL_CHAIN" ]]; then
    COMMON_ARGS+=(--model-chain "$MODEL_CHAIN")
  fi
  if [[ "$JUDGE_ENABLED" == "1" ]]; then
    # 判官模型空时由 .mjs 默认取 JUDGE_MODEL_CHAIN / 精修主模型。
    [[ -n "$JUDGE_MODELS" ]] && COMMON_ARGS+=(--judge-models "$JUDGE_MODELS")
    COMMON_ARGS+=(--judge-count "$JUDGE_COUNT" --dynamic-skip-min "$DYNAMIC_SKIP_MIN" --judge-batch-size "$JUDGE_BATCH_SIZE" --judge-json-retries "$JUDGE_JSON_RETRIES")
    [[ -n "$JUDGE_WARM_CONCURRENCY" ]] && COMMON_ARGS+=(--judge-warm-concurrency "$JUDGE_WARM_CONCURRENCY")
  else
    COMMON_ARGS+=(--no-judge)
  fi
}

run_audit() {
  local scope
  local failed=0
  for scope in "${SCOPE_ARGS[@]}"; do
    title "审计 scope=${scope}"
    if ! node scripts/quality_refine.mjs --audit-only --scope "$scope" --min-score "$MIN_SCORE"; then
      failed=1
    fi
  done
  return "$failed"
}

run_refine() {
  build_common_refine_args
  local scope
  local failed=0
  local topics_csv scope_domain topic_ref
  for scope in "${SCOPE_ARGS[@]}"; do
    topics_csv=""
    if (( ${#SELECTED_TOPIC_REFS[@]} )); then
      if [[ "$scope" == domain:* ]]; then
        scope_domain="${scope#domain:}"
        local scope_topic_refs=()
        for topic_ref in "${SELECTED_TOPIC_REFS[@]}"; do
          [[ "$topic_ref" == "topics/${scope_domain}/"* ]] && scope_topic_refs+=("$topic_ref")
        done
        if (( ${#scope_topic_refs[@]} == 0 )); then
          info "scope=${scope} 没有选中的 topic，跳过。"
          continue
        fi
        topics_csv="$(join_by "," "${scope_topic_refs[@]}")"
      else
        topics_csv="$(join_by "," "${SELECTED_TOPIC_REFS[@]}")"
      fi
    fi
    title "正式精修 scope=${scope}（并发=${CONCURRENCY}）"
    if (( CONCURRENCY > 3 )); then
      info "并发可用性失败时会自动降到 3 并重试失败项。"
    fi
    local cmd=(
      node scripts/quality_refine.mjs
      --scope "$scope"
      --concurrency "$CONCURRENCY"
      --max-rounds "$MAX_ROUNDS"
      "${COMMON_ARGS[@]}"
    )
    if [[ -n "$LIMIT" ]]; then
      cmd+=(--limit "$LIMIT")
    fi
    if [[ "$RESUME_LAST" == "1" ]]; then
      cmd+=(--resume)
    fi
    if [[ -n "$topics_csv" ]]; then
      cmd+=(--topics "$topics_csv")
    fi
    # v3.3 新参数（默认值已在 .env，向导变量留空则不覆盖）
    if [[ -n "$REFINE_PROFILE" ]]; then
      cmd+=(--profile "$REFINE_PROFILE")
    fi
    if [[ "$ALLOW_PAID_DIAGRAM" == "1" ]]; then
      cmd+=(--allow-paid-diagram)
    fi
    if [[ -n "$HEALTH_PORT" ]]; then
      cmd+=(--health-port "$HEALTH_PORT")
    fi
    if [[ -n "$MAX_COST_PER_RUN" ]]; then
      cmd+=(--max-cost-per-run "$MAX_COST_PER_RUN")
    fi
    if [[ -n "$MAX_TOKENS_PER_RUN" ]]; then
      cmd+=(--max-tokens-per-run "$MAX_TOKENS_PER_RUN")
    fi
    # 把交互选的额度策略覆盖到 .env 默认(env var > .env 值)
    if [[ -n "$QUOTA_PAUSE_POLICY" ]]; then
      export QUOTA_PAUSE_DEFAULT="$QUOTA_PAUSE_POLICY"
    fi
    printf '%s\n' "${DIM}${cmd[*]}${RESET}"
    set +e
    "${cmd[@]}"
    local rc="$?"
    set -e
    if (( rc != 0 )); then
      failed=1
      printf '%s\n' "${YELLOW}scope=${scope} 仍有未达标或失败项，本次不会自动同步该批结果。${RESET}"
    fi
  done

  if (( failed == 0 )); then
    title "发布前结构校验"
    if ! npm run validate; then
      printf '%s\n' "${YELLOW}内容结构校验未通过，已跳过 staging/draft 同步。请先修复 validate 报错后重新运行。${RESET}"
      return 1
    fi
    title "同步环境内容"
    # run_refine 内部重开了 set -e（捕获 node 退出码后），这里若不守护，sync 失败会硬中断、
    # 盖掉 main 的 set +e 优雅捕获；topics/ 此时已写好，提示可单独重跑 sync 即可。
    if ! node scripts/sync_environment_content.mjs "$STAGE_TARGET"; then
      printf '%s\n' "${YELLOW}环境同步失败：topics/ 已更新但未同步到 ${STAGE_LABEL}。可单独重跑：node scripts/sync_environment_content.mjs ${STAGE_TARGET}${RESET}"
      return 1
    fi
    printf '%s\n' "${GREEN}已同步：${STAGE_LABEL}${RESET}"
  else
    printf '%s\n' "${YELLOW}精修未完全达标，已跳过 staging/draft 同步。可以修完后重新运行。${RESET}"
  fi
  return "$failed"
}

summary() {
  title "本次配置"
  printf '阶段：%s\n' "$STAGE_LABEL"
  printf '模式：%s\n' "$RUN_MODE_LABEL"
  printf '领域：%s\n' "$(join_by "," "${SELECTED_DOMAIN_IDS[@]}")"
  printf '合格分：%s\n' "$MIN_SCORE"
  if [[ "$RUN_MODE" != "audit" ]]; then
    printf 'Topic：%s\n' "$TOPIC_SELECTION_LABEL"
    printf '模型链：%s\n' "${MODEL_CHAIN:-默认(.env)}"
    printf '重试：%s 次，超时：%s 秒，空转看门狗：%s 秒，降级阈值：%s\n' "$RETRIES" "$TIMEOUT_SECONDS" "$STALL_TIMEOUT_SECONDS" "$DEGRADE_AFTER"
    printf '进度：%s，心跳：%s 秒（每完成一篇立即刷一行）\n' "$PROGRESS_STYLE" "$HEARTBEAT_SECONDS"
  fi
  if [[ "$RUN_MODE" == "refine" ]]; then
    if [[ "$JUDGE_ENABLED" == "1" ]]; then
      printf '判官：%s × %s 实例，动态免改线 %s，batch %s，判前预热并发 %s，JSON重试 %s\n' \
        "${JUDGE_MODELS:-同精修主模型}" "$JUDGE_COUNT" "$DYNAMIC_SKIP_MIN" "$JUDGE_BATCH_SIZE" \
        "${JUDGE_WARM_CONCURRENCY:-$CONCURRENCY}" "$JUDGE_JSON_RETRIES"
    else
      printf '判官：未启用（纯静态 keep-best）\n'
    fi
  fi
  if [[ "$TEST_RUN" == "1" ]]; then
    printf '%s\n' "（测试跑：真实流程只跑这一篇，含 validate + 同步）"
  fi
  if [[ "$RUN_MODE" == "refine" ]]; then
    if (( CONCURRENCY > 3 )); then
      printf '并发：%s（可用性失败自动降到 3），最大轮数：%s，每轮上限：%s，续跑：%s\n' "$CONCURRENCY" "$MAX_ROUNDS" "${LIMIT:-不限}" "$([[ "$RESUME_LAST" == "1" ]] && printf 开 || printf 关)"
    else
      printf '并发：%s，最大轮数：%s，每轮上限：%s，续跑：%s\n' "$CONCURRENCY" "$MAX_ROUNDS" "${LIMIT:-不限}" "$([[ "$RESUME_LAST" == "1" ]] && printf 开 || printf 关)"
    fi
  fi
}

# 把当前内存里的「技术参数」（模型/判官/并发）落盘成 KV 文件，下次跑可一键复用。
# 不存 SCOPE/LIMIT/MAX_ROUNDS——这些是「本次任务范围」，每次重新问；只把当前值当 default。
# 不存任何 API key 本身，仅存 envKey 变量名。
save_last_config() {
  local dir
  dir="$(dirname "$LAST_CONFIG_FILE")"
  mkdir -p "$dir" 2>/dev/null || return 0
  {
    printf '# quality_refine_interactive last-config v%s\n' "$LAST_CONFIG_VERSION"
    printf '# saved at %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf 'LAST_CONFIG_VERSION=%s\n' "$LAST_CONFIG_VERSION"
    printf 'STAGE_TARGET=%q\n' "$STAGE_TARGET"
    printf 'STAGE_LABEL=%q\n' "$STAGE_LABEL"
    printf 'RUN_MODE=%q\n' "$RUN_MODE"
    printf 'TEST_RUN=%q\n' "$TEST_RUN"
    printf 'RUN_MODE_LABEL=%q\n' "$RUN_MODE_LABEL"
    printf 'MIN_SCORE=%q\n' "$MIN_SCORE"
    printf 'CONCURRENCY=%q\n' "$CONCURRENCY"
    printf 'MAX_ROUNDS=%q\n' "$MAX_ROUNDS"
    printf 'RETRIES=%q\n' "$RETRIES"
    printf 'TIMEOUT_SECONDS=%q\n' "$TIMEOUT_SECONDS"
    printf 'STALL_TIMEOUT_SECONDS=%q\n' "$STALL_TIMEOUT_SECONDS"
    printf 'RESUME_LAST=%q\n' "$RESUME_LAST"
    printf 'DEGRADE_AFTER=%q\n' "$DEGRADE_AFTER"
    printf 'PROGRESS_STYLE=%q\n' "$PROGRESS_STYLE"
    printf 'HEARTBEAT_SECONDS=%q\n' "$HEARTBEAT_SECONDS"
    printf 'MODEL_CHAIN=%q\n' "$MODEL_CHAIN"
    printf 'JUDGE_ENABLED=%q\n' "$JUDGE_ENABLED"
    printf 'JUDGE_MODELS=%q\n' "$JUDGE_MODELS"
    printf 'JUDGE_COUNT=%q\n' "$JUDGE_COUNT"
    printf 'DYNAMIC_SKIP_MIN=%q\n' "$DYNAMIC_SKIP_MIN"
    printf 'JUDGE_BATCH_SIZE=%q\n' "$JUDGE_BATCH_SIZE"
    printf 'JUDGE_JSON_RETRIES=%q\n' "$JUDGE_JSON_RETRIES"
    printf 'JUDGE_WARM_CONCURRENCY=%q\n' "$JUDGE_WARM_CONCURRENCY"
    # qwen 主路由：MODEL_CHAIN_ITEMS / CHAIN_BASE_URLS / CHAIN_ENV_KEYS 三平行数组按 index 平铺
    local n i
    n=${#MODEL_CHAIN_ITEMS[@]:-0}
    printf 'MODEL_CHAIN_LEN=%s\n' "$n"
    for (( i = 0; i < n; i += 1 )); do
      printf 'MODEL_CHAIN_ITEM_%s=%q\n' "$i" "${MODEL_CHAIN_ITEMS[$i]:-}"
      printf 'CHAIN_BASE_URL_%s=%q\n' "$i" "${CHAIN_BASE_URLS[$i]:-}"
      printf 'CHAIN_ENV_KEY_%s=%q\n' "$i" "${CHAIN_ENV_KEYS[$i]:-}"
    done
    # qwen 判官路由：JUDGE_CHAIN_BASE_URLS / JUDGE_CHAIN_ENV_KEYS 两平行数组（model id 已在 JUDGE_MODELS）
    n=${#JUDGE_CHAIN_BASE_URLS[@]:-0}
    printf 'JUDGE_CHAIN_LEN=%s\n' "$n"
    for (( i = 0; i < n; i += 1 )); do
      printf 'JUDGE_CHAIN_BASE_URL_%s=%q\n' "$i" "${JUDGE_CHAIN_BASE_URLS[$i]:-}"
      printf 'JUDGE_CHAIN_ENV_KEY_%s=%q\n' "$i" "${JUDGE_CHAIN_ENV_KEYS[$i]:-}"
    done
  } > "$LAST_CONFIG_FILE.tmp" 2>/dev/null && mv "$LAST_CONFIG_FILE.tmp" "$LAST_CONFIG_FILE" 2>/dev/null || true
}

# 读取上次配置文件并灌回全局变量；返回 0 表示成功，1 表示文件不存在/格式异常/版本不兼容。
load_last_config() {
  [[ -f "$LAST_CONFIG_FILE" ]] || return 1
  local expected_version="$LAST_CONFIG_VERSION"
  # shellcheck disable=SC1090
  if ! source "$LAST_CONFIG_FILE" 2>/dev/null; then
    return 1
  fi
  # source 之后 LAST_CONFIG_VERSION 已被文件里的值覆盖；用先前缓存的 expected_version 比对
  if [[ -n "${LAST_CONFIG_VERSION:-}" && "$LAST_CONFIG_VERSION" != "$expected_version" ]]; then
    LAST_CONFIG_VERSION="$expected_version"
    return 1
  fi
  LAST_CONFIG_VERSION="$expected_version"
  # 把平铺的 chain 数组还原回来
  local n i var
  MODEL_CHAIN_ITEMS=()
  CHAIN_BASE_URLS=()
  CHAIN_ENV_KEYS=()
  n="${MODEL_CHAIN_LEN:-0}"
  for (( i = 0; i < n; i += 1 )); do
    var="MODEL_CHAIN_ITEM_$i"; MODEL_CHAIN_ITEMS+=("${!var:-}")
    var="CHAIN_BASE_URL_$i";   CHAIN_BASE_URLS+=("${!var:-}")
    var="CHAIN_ENV_KEY_$i";    CHAIN_ENV_KEYS+=("${!var:-}")
  done
  JUDGE_CHAIN_BASE_URLS=()
  JUDGE_CHAIN_ENV_KEYS=()
  n="${JUDGE_CHAIN_LEN:-0}"
  for (( i = 0; i < n; i += 1 )); do
    var="JUDGE_CHAIN_BASE_URL_$i"; JUDGE_CHAIN_BASE_URLS+=("${!var:-}")
    var="JUDGE_CHAIN_ENV_KEY_$i";  JUDGE_CHAIN_ENV_KEYS+=("${!var:-}")
  done
  return 0
}

# 用 discover_models 跑一次 .env 里可用的 model 列表，校验上次记下的 model id 是否还在。
# 缺一个就返回 1 + 在 stderr 上点名缺失的 id。让上层退回到手选 step。
verify_replayed_models() {
  local available=()
  local value label base_url env_key
  while IFS=$'\t' read -r value label base_url env_key; do
    [[ -z "$value" ]] && continue
    available+=("$value")
  done < <(discover_models)
  # 空列表视为「未知列表，跳过校验」（如 .env 未配 key）。
  (( ${#available[@]} == 0 )) && return 0
  local id missing=()
  for id in "${MODEL_CHAIN_ITEMS[@]}"; do
    [[ -z "$id" ]] && continue
    local hit=0 v
    for v in "${available[@]}"; do
      [[ "$v" == "$id" ]] && { hit=1; break; }
    done
    (( hit == 0 )) && missing+=("精修:$id")
  done
  if [[ "$JUDGE_ENABLED" == "1" && -n "$JUDGE_MODELS" ]]; then
    IFS=',' read -r -a __jms <<< "$JUDGE_MODELS"
    for id in "${__jms[@]}"; do
      [[ -z "$id" ]] && continue
      local hit=0 v
      for v in "${available[@]}"; do
        [[ "$v" == "$id" ]] && { hit=1; break; }
      done
      (( hit == 0 )) && missing+=("判官:$id")
    done
  fi
  if (( ${#missing[@]} > 0 )); then
    printf '%s\n' "${YELLOW}上次配置里的模型在 $cli 当前列表里找不到：$(join_by "," "${missing[@]}")${RESET}" >&2
    printf '%s\n' "${DIM}（settings.json 改过/provider 删过/CLI 升级换 id 都可能导致；将退回手选）${RESET}" >&2
    return 1
  fi
  return 0
}

# 给 summary 用的「上次配置摘要」，单行简版，给一键复用题做提示
last_config_summary_line() {
  [[ -f "$LAST_CONFIG_FILE" ]] || { printf ''; return 0; }
  # 用子 shell 隔离，不污染当前作用域
  (
    set +e
    # shellcheck disable=SC1090
    source "$LAST_CONFIG_FILE" 2>/dev/null || exit 1
    local saved_at=""
    saved_at=$(grep -m1 '^# saved at ' "$LAST_CONFIG_FILE" 2>/dev/null | sed 's/^# saved at //')
    printf '%s · model=%s · judge=%s · batch=%s · warm=%s · concurrency=%s' \
      "${saved_at:-未知时间}" \
      "${MODEL_CHAIN:-默认}" \
      "${JUDGE_MODELS:-同精修}" \
      "${JUDGE_BATCH_SIZE:-?}" \
      "${JUDGE_WARM_CONCURRENCY:-跟随并发}" \
      "${CONCURRENCY:-?}"
  )
}

confirm_execution() {
  summary
  local choice
  while true; do
    printf '开始执行？[Y/n，回车默认 Y] %s: ' "$(prompt_suffix)" >&2
    IFS= read -r choice || exit 1
    # 去掉前后空白，避免误按空格当成无效输入
    choice="${choice#"${choice%%[![:space:]]*}"}"
    choice="${choice%"${choice##*[![:space:]]}"}"
    check_nav_input "$choice" || return $?
    choice="${choice:-y}"
    case "$choice" in
      y|Y|yes|YES|Yes|是|好|开始)
        save_last_config
        return 0
        ;;
      n|N|no|NO|No|否|不|取消)
        return 130
        ;;
      *)
        printf '%s\n' "${YELLOW}请输入 y 开始、n 取消、b 返回上一层（直接回车默认 Y）。${RESET}" >&2
        ;;
    esac
  done
}

# 步骤：0 阶段 1 模式 2 领域 3 (audit?参数:topic) 4 参数 5 (空,CLI 已废弃) 6 模型链 7 判官模型 8 判官参数 9 确认
# audit 跳到 9；refine（含测试跑）走 7、(启用判官?8)、9——测试跑只是 topic 步钉成单篇，其余完全一致。
next_step() {
  case "$1" in
    0) printf '1\n' ;;
    1) printf '2\n' ;;
    2) printf '3\n' ;;
    3)
      if [[ "$RUN_MODE" == "audit" ]]; then printf '9\n'; else printf '4\n'; fi
      ;;
    4) printf '5\n' ;;
    5) printf '6\n' ;;
    6)
      if [[ "$RUN_MODE" == "refine" ]]; then printf '7\n'; else printf '9\n'; fi
      ;;
    7)
      if [[ "$JUDGE_ENABLED" == "1" ]]; then printf '8\n'; else printf '9\n'; fi
      ;;
    8) printf '9\n' ;;
    *) printf '9\n' ;;
  esac
}

previous_step() {
  case "$1" in
    0|1) printf '0\n' ;;
    2) printf '1\n' ;;
    3) printf '2\n' ;;
    4) printf '3\n' ;;
    5) printf '4\n' ;;
    6) printf '5\n' ;;
    7) printf '6\n' ;;
    8) printf '7\n' ;;
    9)
      if [[ "$RUN_MODE" == "audit" ]]; then
        printf '3\n'
      elif [[ "$JUDGE_ENABLED" == "1" ]]; then
        printf '8\n'
      else
        printf '7\n'
      fi
      ;;
    *) printf '0\n' ;;
  esac
}

run_wizard_step() {
  if (( REPLAY_FLAG == 1 )); then
    case "$1" in
      6|7|8)
        printf '%s\n' "${DIM}（复用上次配置：跳过 $(case "$1" in 6) echo 模型链 ;; 7) echo 判官模型 ;; 8) echo 判官参数 ;; esac)）${RESET}" >&2
        return 0
        ;;
    esac
  fi
  case "$1" in
    0) choose_stage ;;
    1) choose_run_mode ;;
    2) choose_domains ;;
    3)
      if [[ "$RUN_MODE" == "audit" ]]; then
        choose_quality_options
      else
        choose_topics
      fi
      ;;
    4) choose_quality_options ;;
    5) choose_cli ;;
    6) choose_model_chain ;;
    7) choose_judge_models ;;
    8) choose_judge_count ;;
    9) confirm_execution ;;
    *) return 1 ;;
  esac
}

execute_selected_mode() {
  case "$RUN_MODE" in
    audit) run_audit ;;
    refine) run_refine ;;  # 测试跑也是 refine（TEST_RUN=1 已在 choose_topics 钉成单篇）
    *) die "未知运行模式：$RUN_MODE" ;;
  esac
}

main() {
  local force_last=0
  # P0.4：REFINE_NONINTERACTIVE=true 或 --yes 时，.env 已有值的步骤直接采用（只打印「用 .env: X」），
  # 向导精简为：选范围 → （可选）覆盖哪几项 → 确认。
  local noninteractive=0
  [[ "${REFINE_NONINTERACTIVE:-}" =~ ^(1|true|yes|on)$ ]] && noninteractive=1
  while (( $# > 0 )); do
    case "$1" in
      --last|-l)
        force_last=1
        shift
        ;;
      --yes|-y)
        noninteractive=1
        shift
        ;;
      --help|-h)
        cat <<'USAGE'
用法: quality_refine_interactive.sh [选项]
  --last, -l   直接复用上次配置（跳过 模型链/判官 询问，仍会问 stage/mode/domains/topics/参数）
  --yes, -y    非交互模式：.env 已有值的步骤直接采用，向导精简为选范围→确认（也可通过 REFINE_NONINTERACTIVE=true 启用）
  --help, -h   显示帮助
USAGE
        return 0
        ;;
      *)
        printf '未知参数：%s\n' "$1" >&2
        return 64
        ;;
    esac
  done

  title "知识精修交互式启动器"
  info "正式精修始终改 production topics/；选择阶段只决定成功后同步到哪些环境。"
  load_domains

  # P0.4：非交互模式——读取 .env 值直接采用，省去逐项询问，仅让用户选范围后确认。
  if (( noninteractive == 1 )); then
    info "非交互模式（REFINE_NONINTERACTIVE/--yes）：从 .env 读取默认配置，跳过逐项询问。"
    MODEL_CHAIN=""    # 空=读 .env REFINE_MODEL_CHAIN
    JUDGE_ENABLED=1
    JUDGE_MODELS=""   # 空=读 .env JUDGE_MODEL_CHAIN
    local env_min env_conc env_rounds env_batch env_skip
    env_min="$(grep -E '^MIN_SCORE=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
    env_conc="$(grep -E '^CONCURRENCY=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
    env_rounds="$(grep -E '^MAX_ROUNDS=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
    env_batch="$(grep -E '^JUDGE_BATCH_SIZE=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
    env_skip="$(grep -E '^DYNAMIC_SKIP_MIN=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
    [[ -n "$env_min" ]]    && { MIN_SCORE="$env_min";        printf '%s\n' "  用 .env: MIN_SCORE=${MIN_SCORE}" >&2; }
    [[ -n "$env_conc" ]]   && { CONCURRENCY="$env_conc";     printf '%s\n' "  用 .env: CONCURRENCY=${CONCURRENCY}" >&2; }
    [[ -n "$env_rounds" ]] && { MAX_ROUNDS="$env_rounds";    printf '%s\n' "  用 .env: MAX_ROUNDS=${MAX_ROUNDS}" >&2; }
    [[ -n "$env_batch" ]]  && { JUDGE_BATCH_SIZE="$env_batch"; printf '%s\n' "  用 .env: JUDGE_BATCH_SIZE=${JUDGE_BATCH_SIZE}" >&2; }
    [[ -n "$env_skip" ]]   && { DYNAMIC_SKIP_MIN="$env_skip"; printf '%s\n' "  用 .env: DYNAMIC_SKIP_MIN=${DYNAMIC_SKIP_MIN}" >&2; }
    # 非交互模式：只走 阶段→模式→领域→Topic→确认，跳过 模型/判官 步骤
    local step=0 rc
    while true; do
      case "$step" in
        0) choose_stage || { rc=$?; [[ "$rc" == 130 ]] && { printf '%s\n' "${DIM}已退出。${RESET}"; return 0; }; }
           step=1 ;;
        1) choose_run_mode || { rc=$?; [[ "$rc" == 130 ]] && { printf '%s\n' "${DIM}已退出。${RESET}"; return 0; }; [[ "$rc" == 2 ]] && { step=0; continue; } }
           step=2 ;;
        2) choose_domains || { rc=$?; [[ "$rc" == 130 ]] && { printf '%s\n' "${DIM}已退出。${RESET}"; return 0; }; [[ "$rc" == 2 ]] && { step=1; continue; } }
           step=3 ;;
        3)
          if [[ "$RUN_MODE" == "audit" ]]; then
            choose_quality_options || { rc=$?; [[ "$rc" == 130 ]] && { printf '%s\n' "${DIM}已退出。${RESET}"; return 0; }; [[ "$rc" == 2 ]] && { step=2; continue; } }
          else
            choose_topics || { rc=$?; [[ "$rc" == 130 ]] && { printf '%s\n' "${DIM}已退出。${RESET}"; return 0; }; [[ "$rc" == 2 ]] && { step=2; continue; } }
          fi
          step=4 ;;
        4)
          if confirm_execution; then
            set +e
            execute_selected_mode
            rc=$?
            set -e
            return "$rc"
          else
            rc=$?
            [[ "$rc" == 130 ]] && { printf '%s\n' "${DIM}已退出。${RESET}"; return 0; }
            [[ "$rc" == 2 ]] && { step=3; continue; }
          fi
          ;;
      esac
    done
    return 0
  fi

  if [[ -f "$LAST_CONFIG_FILE" ]]; then
    local summary
    summary="$(last_config_summary_line || true)"
    if (( force_last == 1 )); then
      info "检测到上次配置（--last），尝试复用：${summary}"
      if load_last_config; then
        if verify_replayed_models; then
          REPLAY_FLAG=1
          info "✓ 上次配置已复用，将跳过 模型链/判官 步骤。"
        else
          printf '%s\n' "${YELLOW}警告：上次配置中的模型已不可用（详见上方提示），退回手选模式。${RESET}" >&2
          REPLAY_FLAG=0
        fi
      else
        printf '%s\n' "${YELLOW}警告：上次配置文件读取失败或版本不兼容，退回手选模式。${RESET}" >&2
        REPLAY_FLAG=0
      fi
    else
      printf '\n%s\n' "${BOLD}检测到上次配置：${RESET}${summary}" >&2
      printf '是否复用？[Y/n] %s: ' "$(prompt_suffix)" >&2
      local ans
      IFS= read -r ans || true
      ans="${ans:-y}"
      case "$ans" in
        y|Y|yes|YES|Yes|是|好)
          if load_last_config; then
            if verify_replayed_models; then
              REPLAY_FLAG=1
              info "✓ 已复用上次配置，将跳过 模型链/判官 步骤（仍会问阶段/模式/领域/topic/参数）。"
            else
              printf '%s\n' "${YELLOW}警告：上次配置中的模型已不可用（详见上方提示），退回手选模式。${RESET}" >&2
              REPLAY_FLAG=0
            fi
          else
            printf '%s\n' "${YELLOW}警告：上次配置文件读取失败或版本不兼容，退回手选模式。${RESET}" >&2
            REPLAY_FLAG=0
          fi
          ;;
        *)
          REPLAY_FLAG=0
          ;;
      esac
    fi
  elif (( force_last == 1 )); then
    printf '%s\n' "${YELLOW}警告：未找到上次配置文件 ${LAST_CONFIG_FILE}，将走完整流程。${RESET}" >&2
  fi

  local step=0
  local rc
  while true; do
    if run_wizard_step "$step"; then
      if [[ "$step" == "9" ]]; then
        set +e
        execute_selected_mode
        rc=$?
        set -e
        return "$rc"
      fi
      step="$(next_step "$step")"
      continue
    else
      rc=$?
    fi
    case "$rc" in
      2)
        if (( step == 0 )); then
          printf '%s\n' "${YELLOW}已经是第一步；输入 q 可以退出。${RESET}" >&2
        else
          step="$(previous_step "$step")"
        fi
        ;;
      130)
        printf '%s\n' "${DIM}已退出。${RESET}"
        return 0
        ;;
      *)
        return "$rc"
        ;;
    esac
  done
}

main "$@"
