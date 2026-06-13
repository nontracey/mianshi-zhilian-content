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
MIN_SCORE=90
CONCURRENCY=3
MAX_ROUNDS=3
RETRIES=1
TIMEOUT_SECONDS=600
DEGRADE_AFTER=3
LIMIT=""
SELECTED_CLI=""
MODEL_CHAIN=""
JUDGE_ENABLED=1
JUDGE_MODELS=""   # 空 = 跟精修主模型一致
JUDGE_COUNT=1
DYNAMIC_SKIP_MIN=85
JUDGE_BATCH_SIZE=5
SELECTED_DOMAIN_IDS=()
SCOPE_ARGS=()
TOPIC_REF=""
SELECTED_TOPIC_REFS=()
TOPIC_SELECTION_LABEL="全部 topic"
ASK_VALUE=""

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
  printf '2. 测试预览：只精修单篇，写到 .quality-refine/preview/，并在终端渲染文字版\n'
  printf '3. 仅审计：不调用 agent，只列出当前待修内容\n'
  local choice
  while true; do
    printf '请选择 [1] %s: ' "$(prompt_suffix)" >&2
    IFS= read -r choice || exit 1
    check_nav_input "$choice" || return $?
    choice="${choice:-1}"
    case "$choice" in
      1) RUN_MODE="refine"; RUN_MODE_LABEL="正式精修"; return 0 ;;
      2) RUN_MODE="preview"; RUN_MODE_LABEL="测试预览"; return 0 ;;
      3) RUN_MODE="audit"; RUN_MODE_LABEL="仅审计"; return 0 ;;
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

discover_clis() {
  CLI_NAMES=()
  CLI_PATHS=()
  add_cli_candidate() {
    local candidate="$1"
    local resolved
    if [[ -z "$candidate" ]]; then
      return
    fi
    resolved="$(command -v "$candidate" 2>/dev/null || true)"
    if [[ -z "$resolved" ]]; then
      return 0
    fi
    if ! contains_value "$resolved" "${CLI_PATHS[@]}"; then
      CLI_NAMES+=("$candidate")
      CLI_PATHS+=("$resolved")
    fi
  }
  local candidates=(
    qwen
    qwen-code
    codex
    claude
    claude-code
    claudecode
    gemini
    opencode
  )
  if [[ -n "${QUALITY_REFINE_CLI_CANDIDATES:-}" ]]; then
    local extra
    for extra in ${QUALITY_REFINE_CLI_CANDIDATES}; do
      candidates+=("$extra")
    done
  fi
  local cli
  for cli in "${candidates[@]}"; do
    add_cli_candidate "$cli"
  done
  local path_dir entry name
  IFS=':' read -r -a path_dirs <<< "$PATH"
  for path_dir in "${path_dirs[@]}"; do
    [[ -d "$path_dir" ]] || continue
    for entry in "$path_dir"/*; do
      [[ -f "$entry" && -x "$entry" ]] || continue
      name="${entry##*/}"
      case "$name" in
        qwen|qwen-code|codex|claude|claude-code|claudecode|gemini|opencode)
          add_cli_candidate "$entry"
          ;;
      esac
    done
  done
}

choose_cli() {
  title "选择 CLI Agent"
  discover_clis
  local index choice custom rc
  if (( ${#CLI_NAMES[@]} )); then
    for (( index = 0; index < ${#CLI_NAMES[@]}; index += 1 )); do
      printf '%2d. %-16s %s%s%s\n' \
        "$((index + 1))" \
        "${CLI_NAMES[$index]}" \
        "$DIM" "$(command -v "${CLI_NAMES[$index]}")" "$RESET"
    done
    printf ' c. 手动输入其它 CLI 命令\n'
    while true; do
      printf '请选择 [1] %s: ' "$(prompt_suffix)" >&2
      IFS= read -r choice || exit 1
      check_nav_input "$choice" || return $?
      choice="${choice:-1}"
      if [[ "$choice" == "c" || "$choice" == "C" ]]; then
        if read_required "CLI 命令 $(prompt_suffix): "; then
          :
        else
          rc=$?; return "$rc"
        fi
        custom="$ASK_VALUE"
        if command -v "$custom" >/dev/null 2>&1; then
          SELECTED_CLI="$custom"
          MODEL_CHAIN=""
          return 0
        fi
        printf '%s\n' "${YELLOW}找不到 CLI：$custom${RESET}" >&2
      elif [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#CLI_NAMES[@]} )); then
        SELECTED_CLI="${CLI_NAMES[$((choice - 1))]}"
        MODEL_CHAIN=""
        return 0
      else
        printf '%s\n' "${YELLOW}未知 CLI 选项：$choice${RESET}" >&2
      fi
    done
  else
    info "没有在 PATH 中发现已知 agent CLI。"
    while true; do
      if read_required "请手动输入 CLI 命令 $(prompt_suffix): "; then
        :
      else
        rc=$?; return "$rc"
      fi
      custom="$ASK_VALUE"
      if command -v "$custom" >/dev/null 2>&1; then
        SELECTED_CLI="$custom"
        MODEL_CHAIN=""
        return 0
      fi
      printf '%s\n' "${YELLOW}找不到 CLI：$custom${RESET}" >&2
    done
  fi
}

discover_models() {
  local cli="$1"
  node - "$cli" <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cli = process.argv[2] || "";
const base = path.basename(cli).toLowerCase();
const home = os.homedir();
const seen = new Set();
const models = [];

function cliKind(name) {
  if (name.includes("qwen")) return "qwen";
  if (name.includes("codex")) return "codex";
  if (name.includes("claude")) return "claude";
  if (name.includes("gemini")) return "gemini";
  if (name.includes("opencode")) return "opencode";
  return "generic";
}

const kind = cliKind(base);

function hostOf(url) {
  if (!url || typeof url !== "string") return "";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function add(value, label = value, dedupeKey = value) {
  if (!value || typeof value !== "string") return;
  const item = value.trim();
  const display = String(label || item).trim();
  if (!item || item.length < 3 || item.length > 120) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]+$/.test(item)) return;
  const key = String(dedupeKey || item).trim();
  if (!seen.has(key)) {
    seen.add(key);
    models.push({ value: item, label: display });
  }
}

function visitJson(value, key = "") {
  if (typeof value === "string") {
    if (/model/i.test(key)) add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && /models?/i.test(key)) add(item);
      else visitJson(item, key);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) visitJson(childValue, childKey);
  }
}

function addProviderEntry(protocol, entry, index, objectKey = "") {
  if (typeof entry === "string") {
    add(entry, `${entry} · ${protocol}`, `${protocol}:${objectKey || index}:${entry}`);
    return;
  }
  if (!entry || typeof entry !== "object") return;
  const id = entry.id || entry.model || entry.modelId || entry.name || objectKey;
  if (!id || typeof id !== "string") return;
  const name = entry.name && entry.name !== id ? entry.name : id;
  const baseUrl = entry.baseUrl || entry.baseURL || entry.url || entry.endpoint || "";
  const host = hostOf(baseUrl);
  const label = `${name}${name !== id ? ` [${id}]` : ""} · ${protocol}${host ? ` · ${host}` : ""}`;
  add(id, label, `${protocol}:${objectKey || index}:${id}:${host}:${name}`);
}

function readQwenConfig(file) {
  const abs = file.replace(/^~/, home);
  if (!fs.existsSync(abs) || !abs.endsWith(".json")) return;
  let json;
  try {
    json = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return;
  }
  if (json.model?.name) add(json.model.name, `${json.model.name} · 当前默认 model.name`, `current:${json.model.name}`);
  for (const [protocol, entries] of Object.entries(json.modelProviders || {})) {
    if (Array.isArray(entries)) {
      entries.forEach((entry, index) => addProviderEntry(protocol, entry, index));
    } else if (entries && typeof entries === "object") {
      for (const [key, entry] of Object.entries(entries)) addProviderEntry(protocol, entry, key, key);
    }
  }
}

function readConfig(file) {
  const abs = file.replace(/^~/, home);
  if (!fs.existsSync(abs)) return;
  let text = "";
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return;
  }
  if (abs.endsWith(".json")) {
    try {
      visitJson(JSON.parse(text));
    } catch {}
  }
  const re = /(?:^|\b)(?:model|defaultModel|default_model|model_id|modelId)\s*[:=]\s*["']?([A-Za-z0-9][A-Za-z0-9._:/@+\-]{2,})/g;
  let match;
  while ((match = re.exec(text))) add(match[1]);
}

const configFilesByKind = {
  qwen: [
    "~/.qwen/settings.json",
    "~/.qwen/settings.local.json",
    "~/.qwen/config.json",
    "~/.qwen/qwenswitch-meta.json",
    "~/.qwen/source.json",
    "~/.qwen-code/settings.json",
    "~/.qwen-code/config.json",
    "~/.config/qwen-code/settings.json",
    "~/.config/qwen-code/config.json",
    "~/.config/qwen/settings.json",
    "~/.config/qwen/config.json",
  ],
  codex: [
    "~/.codex/config.toml",
    "~/.codex/config.json",
  ],
  claude: [
    "~/.claude/settings.json",
    "~/.claude/settings.local.json",
    "~/.claude.json",
  ],
  gemini: [
    "~/.gemini/settings.json",
    "~/.gemini/config.json",
  ],
  opencode: [
    "~/.config/opencode/opencode.json",
    "~/.config/opencode/config.json",
    "~/.config/opencode/oh-my-openagent.json",
    "./opencode.json",
    "./.opencode.json",
  ],
};

const fallbackModelsByKind = {
  qwen: ["qwen3-coder-plus", "qwen3-coder", "qwen-max", "qwen-plus"],
  codex: ["gpt-5-codex", "gpt-5", "gpt-5-mini"],
  claude: ["sonnet", "opus", "haiku", "claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-haiku-latest"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  opencode: ["anthropic/claude-sonnet-4-5", "openai/gpt-5-codex", "google/gemini-2.5-pro"],
};

const selectedFiles = configFilesByKind[kind] ?? Object.values(configFilesByKind).flat();
if (kind === "qwen") {
  for (const file of selectedFiles) readQwenConfig(file);
} else {
  for (const file of selectedFiles) readConfig(file);
}
if (!models.length) {
  for (const model of fallbackModelsByKind[kind] ?? []) add(model);
}

for (const model of models) console.log(`${model.value}\t${model.label}`);
NODE
}

choose_model_chain() {
  title "选择模型与降级链"
  MODEL_VALUES=()
  MODEL_LABELS=()
  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local value label
    value="${line%%$'\t'*}"
    if [[ "$line" == *$'\t'* ]]; then
      label="${line#*$'\t'}"
    else
      label="$value"
    fi
    MODEL_VALUES+=("$value")
    MODEL_LABELS+=("$label")
  done < <(discover_models "$SELECTED_CLI")

  local index choice custom selections selected idx rc
  if (( ${#MODEL_VALUES[@]} )); then
    printf '0. CLI 默认模型\n'
    for (( index = 0; index < ${#MODEL_VALUES[@]}; index += 1 )); do
      printf '%2d. %s\n' "$((index + 1))" "${MODEL_LABELS[$index]}"
    done
    printf ' c. 手动输入模型链（逗号分隔）\n'
    printf '\n可直接输入降级顺序，例如 1,2,3；第一个不可用连续达到阈值后会降到下一个。\n'
    while true; do
      printf '请选择 [1] %s: ' "$(prompt_suffix)" >&2
      IFS= read -r choice || exit 1
      check_nav_input "$choice" || return $?
      choice="${choice:-1}"
      if [[ "$choice" == "0" ]]; then
        MODEL_CHAIN=""
        return 0
      elif [[ "$choice" == "c" || "$choice" == "C" ]]; then
        if read_required "模型链（如 model-a,model-b）$(prompt_suffix): "; then
          :
        else
          rc=$?; return "$rc"
        fi
        MODEL_CHAIN="$ASK_VALUE"
        return 0
      else
        selections="$(expand_selection "$choice" "${#MODEL_VALUES[@]}")"
        if [[ -z "$selections" ]]; then
          printf '%s\n' "${YELLOW}没有选中任何有效模型。${RESET}" >&2
          continue
        fi
        MODEL_CHAIN_ITEMS=()
        while IFS= read -r selected; do
          [[ -z "$selected" ]] && continue
          idx=$((selected - 1))
          MODEL_CHAIN_ITEMS+=("${MODEL_VALUES[$idx]}")
        done <<< "$selections"
        MODEL_CHAIN="$(join_by "," "${MODEL_CHAIN_ITEMS[@]}")"
        return 0
      fi
    done
  else
    info "未能从配置中发现模型。可以留空使用 CLI 默认模型。"
    printf '模型链 [空=CLI默认] %s: ' "$(prompt_suffix)" >&2
    IFS= read -r custom || exit 1
    check_nav_input "$custom" || return $?
    MODEL_CHAIN="$custom"
  fi
}

choose_judge_models() {
  title "选择判官模型（动态语义/事实评审）"
  info "判官评“静态分查不出的”事实正确性、认知顺序、零基础可读性、面试覆盖。回车=与精修同模型；0=不启用判官（纯静态、最快）。"
  JUDGE_MODEL_VALUES=()
  JUDGE_MODEL_LABELS=()
  local line value label
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    value="${line%%$'\t'*}"
    if [[ "$line" == *$'\t'* ]]; then label="${line#*$'\t'}"; else label="$value"; fi
    JUDGE_MODEL_VALUES+=("$value")
    JUDGE_MODEL_LABELS+=("$label")
  done < <(discover_models "$SELECTED_CLI")

  local index choice selections selected idx items
  printf ' 0. 不启用判官（纯静态 keep-best，最快）\n'
  printf ' d. 与精修同模型（默认）：%s\n' "${MODEL_CHAIN:-CLI默认}"
  for (( index = 0; index < ${#JUDGE_MODEL_VALUES[@]}; index += 1 )); do
    printf '%2d. %s\n' "$((index + 1))" "${JUDGE_MODEL_LABELS[$index]}"
  done
  printf '\n可多选组成 ensemble（如 1,3）；回车=与精修同模型；0=不启用。\n'
  while true; do
    printf '请选择 [d=同精修] %s: ' "$(prompt_suffix)" >&2
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
      JUDGE_MODELS="$MODEL_CHAIN"
      return 0
    fi
    selections="$(expand_selection "$choice" "${#JUDGE_MODEL_VALUES[@]}")"
    if [[ -z "$selections" ]]; then
      printf '%s\n' "${YELLOW}没有选中有效模型。${RESET}" >&2
      continue
    fi
    items=()
    while IFS= read -r selected; do
      [[ -z "$selected" ]] && continue
      idx=$((selected - 1))
      items+=("${JUDGE_MODEL_VALUES[$idx]}")
    done <<< "$selections"
    JUDGE_ENABLED=1
    JUDGE_MODELS="$(join_by "," "${items[@]}")"
    return 0
  done
}

choose_judge_count() {
  # 未启用判官则本步无内容，直接通过（步骤跳转已据 JUDGE_ENABLED 决定是否进入本步）。
  [[ "$JUDGE_ENABLED" == "1" ]] || return 0
  title "判官数量与动态免改线"
  local rc
  if ask_number "每个判官模型跑几个判官实例（>1 用投票压方差，需模型温度>0）" "$JUDGE_COUNT" 1 8 >/dev/null; then
    :
  else
    rc=$?; return "$rc"
  fi
  JUDGE_COUNT="$ASK_VALUE"
  if ask_number "动态免改线 dynamic-skip-min（低于此分会进入改写；候选接受仍看回归向量）" "$DYNAMIC_SKIP_MIN" 1 100 >/dev/null; then
    :
  else
    rc=$?; return "$rc"
  fi
  DYNAMIC_SKIP_MIN="$ASK_VALUE"
  if ask_number "判官批量大小 judge-batch-size（首轮判前预热，失败会回退单篇）" "$JUDGE_BATCH_SIZE" 1 10 >/dev/null; then
    :
  else
    rc=$?; return "$rc"
  fi
  JUDGE_BATCH_SIZE="$ASK_VALUE"
  return 0
}

choose_quality_options() {
  title "执行参数"
  local rc
  if ask_number "合格分 min-score" "$MIN_SCORE" 1 100 >/dev/null; then
    :
  else
    rc=$?; return "$rc"
  fi
  MIN_SCORE="$ASK_VALUE"
  if [[ "$RUN_MODE" == "refine" ]]; then
    if ask_number "并发数 concurrency" "$CONCURRENCY" 1 8 >/dev/null; then
      :
    else
      rc=$?; return "$rc"
    fi
    CONCURRENCY="$ASK_VALUE"
    if ask_number "最大轮数 max-rounds" "$MAX_ROUNDS" 1 10 >/dev/null; then
      :
    else
      rc=$?; return "$rc"
    fi
    MAX_ROUNDS="$ASK_VALUE"
    if ask_optional_number "每轮最多处理篇数 limit" 1 9999 >/dev/null; then
      :
    else
      rc=$?; return "$rc"
    fi
    LIMIT="$ASK_VALUE"
  fi
  if [[ "$RUN_MODE" != "audit" ]]; then
    if ask_number "单篇失败重试次数 retries" "$RETRIES" 0 5 >/dev/null; then
      :
    else
      rc=$?; return "$rc"
    fi
    RETRIES="$ASK_VALUE"
    if ask_number "单篇超时秒数" "$TIMEOUT_SECONDS" 30 7200 >/dev/null; then
      :
    else
      rc=$?; return "$rc"
    fi
    TIMEOUT_SECONDS="$ASK_VALUE"
    if ask_number "连续多少次 CLI 不可用后降级模型" "$DEGRADE_AFTER" 1 50 >/dev/null; then
      :
    else
      rc=$?; return "$rc"
    fi
    DEGRADE_AFTER="$ASK_VALUE"
  fi
  return 0
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

  if [[ "$RUN_MODE" == "preview" ]]; then
    printf '\n测试预览只精修单篇：输入编号选择；直接回车或 r 随机一篇；m 手动输入路径。\n'
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
          printf '%s\n' "${YELLOW}测试预览一次只能选 1 篇。${RESET}" >&2
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
  COMMON_ARGS=(
    --cli "$SELECTED_CLI"
    --min-score "$MIN_SCORE"
    --retries "$RETRIES"
    --timeout-ms "$((TIMEOUT_SECONDS * 1000))"
    --degrade-after "$DEGRADE_AFTER"
  )
  if [[ -n "$MODEL_CHAIN" ]]; then
    COMMON_ARGS+=(--model-chain "$MODEL_CHAIN")
  fi
  if [[ "$JUDGE_ENABLED" == "1" ]]; then
    # 判官 CLI 默认 = 精修 CLI；判官模型空时由 .mjs 默认取精修主模型。
    [[ -n "$JUDGE_MODELS" ]] && COMMON_ARGS+=(--judge-models "$JUDGE_MODELS")
    COMMON_ARGS+=(--judge-count "$JUDGE_COUNT" --dynamic-skip-min "$DYNAMIC_SKIP_MIN" --judge-batch-size "$JUDGE_BATCH_SIZE")
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

run_preview() {
  build_common_refine_args
  [[ -n "$TOPIC_REF" ]] || die "没有选择测试预览 topic。"
  title "测试预览"
  local log_file preview_rel preview_abs
  log_file="$(mktemp "${TMPDIR:-/tmp}/quality-refine-preview.XXXXXX.log")"
  set +e
  node scripts/quality_refine.mjs \
    --preview \
    --scope all \
    --topic "$TOPIC_REF" \
    "${COMMON_ARGS[@]}" 2>&1 | tee "$log_file"
  local rc="${PIPESTATUS[0]}"
  set -e
  if (( rc != 0 )); then
    printf '%s\n' "${RED}预览失败，日志：${log_file}${RESET}" >&2
    return "$rc"
  fi
  preview_rel="$(sed -n 's/^PREVIEW_OUTPUT=//p' "$log_file" | tail -n 1)"
  [[ -n "$preview_rel" ]] || die "没有从预览输出中找到 PREVIEW_OUTPUT。日志：$log_file"
  preview_abs="$ROOT/$preview_rel"
  title "终端文字预览：$preview_rel"
  node scripts/render_topic.mjs "$preview_abs"
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
    if [[ -n "$topics_csv" ]]; then
      cmd+=(--topics "$topics_csv")
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
    node scripts/sync_environment_content.mjs "$STAGE_TARGET"
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
    printf 'CLI：%s\n' "$SELECTED_CLI"
    printf '模型链：%s\n' "${MODEL_CHAIN:-CLI默认}"
    printf '重试：%s 次，超时：%s 秒，降级阈值：%s\n' "$RETRIES" "$TIMEOUT_SECONDS" "$DEGRADE_AFTER"
  fi
  if [[ "$RUN_MODE" == "refine" ]]; then
    if [[ "$JUDGE_ENABLED" == "1" ]]; then
      printf '判官：%s × %s 实例，动态免改线 %s，batch %s\n' "${JUDGE_MODELS:-同精修模型}" "$JUDGE_COUNT" "$DYNAMIC_SKIP_MIN" "$JUDGE_BATCH_SIZE"
    else
      printf '判官：未启用（纯静态 keep-best）\n'
    fi
  fi
  if [[ "$RUN_MODE" == "preview" ]]; then
    printf '预览 Topic：%s\n' "$TOPIC_REF"
  fi
  if [[ "$RUN_MODE" == "refine" ]]; then
    if (( CONCURRENCY > 3 )); then
      printf '并发：%s（可用性失败自动降到 3），最大轮数：%s，每轮上限：%s\n' "$CONCURRENCY" "$MAX_ROUNDS" "${LIMIT:-不限}"
    else
      printf '并发：%s，最大轮数：%s，每轮上限：%s\n' "$CONCURRENCY" "$MAX_ROUNDS" "${LIMIT:-不限}"
    fi
  fi
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

# 步骤：0 阶段 1 模式 2 领域 3 (audit?参数:topic) 4 参数 5 CLI 6 模型链 7 判官模型 8 判官数量 9 确认
# audit 跳到 9；preview 走到 6 后直接 9（不判官）；refine 走 7、(启用判官?8)、9。
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
      elif [[ "$RUN_MODE" == "preview" ]]; then
        printf '6\n'
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
    preview) run_preview ;;
    refine) run_refine ;;
    *) die "未知运行模式：$RUN_MODE" ;;
  esac
}

main() {
  title "知识精修交互式启动器"
  info "正式精修始终改 production topics/；选择阶段只决定成功后同步到哪些环境。"
  load_domains
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
