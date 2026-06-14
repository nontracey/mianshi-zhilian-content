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
RETRIES=2
TIMEOUT_SECONDS=600
DEGRADE_AFTER=3
LIMIT=""
SELECTED_CLI=""
MODEL_CHAIN=""
JUDGE_ENABLED=1
JUDGE_MODELS=""   # 空 = 跟精修主模型一致
JUDGE_COUNT=1
DYNAMIC_SKIP_MIN=85
JUDGE_BATCH_SIZE=1
JUDGE_JSON_RETRIES=2
JUDGE_WARM_CONCURRENCY=""   # 空 = 跟随 CONCURRENCY
PROGRESS_STYLE="summary"
HEARTBEAT_SECONDS=60
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

function add(value, label = value, dedupeKey = value, meta = {}) {
  if (!value || typeof value !== "string") return;
  const item = value.trim();
  const display = String(label || item).trim();
  if (!item || item.length < 3 || item.length > 120) return;
  if (/[\x00-\x1f\t\n\r"'`\\]/.test(item)) return;
  const key = String(dedupeKey || item).trim();
  if (!seen.has(key)) {
    seen.add(key);
    // baseUrl/envKey：仅 qwen 显式路由用——交互层据此为选中的模型生成 --qwen-routes，让“火山 minimax-m3”等
    // 重复 id 模型经 --bare + 显式凭据精确路由到对的 provider（裸值不含 tab，安全拼进 TSV）。
    models.push({ value: item, label: display, baseUrl: meta.baseUrl || "", envKey: meta.envKey || "" });
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
  // ~/.qwen/settings.json 字段是 envKey；mjs 端 --qwen-routes 期望 apiKeyEnv——映射在 bash 拼 inline JSON 时再做。
  const envKey = entry.envKey || entry.apiKeyEnv || entry.apiKeyEnvName || "";
  const label = `${name}${name !== id ? ` [${id}]` : ""} · ${protocol}${host ? ` · ${host}` : ""}`;
  if (kind === "qwen") {
    // qwen：value 必须是 provider 端真正认的 model id（不是 settings.json 的 name 友好昵称）。
    // 之前用 name 当 value 是为了让“火山 minimax-m3 / 通义 minimax-m3”同 id 不同 provider 共存，
    // 但碰上 LongCat 这种 id="LongCat-2.0-Preview" / name="LongCat 2.0 Preview"，端点会 400 拒掉
    // （LongCat 不接受带空格的 model 字段）。现在 value 改回 id，重复 id 靠 dedupeKey 里的 host 区分共存；
    // label 仍展示 name 让用户认得出，baseUrl/envKey 透传到 TSV 供后续拼 --qwen-routes 精确路由。
    add(id, label, `${protocol}:${objectKey || index}:${id}:${host}`, { baseUrl, envKey });
    return;
  }
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

// 输出 4 列 TSV：value \t label \t baseUrl \t envKey
// baseUrl/envKey 仅 qwen 显式路由要用；其它 CLI 这两列为空。bash 端按 IFS=$'\t' 读 4 列即可，
// 列数变化不会破坏旧行为：未带路由的模型行第三/第四列直接是空字符串。
for (const model of models) console.log(`${model.value}\t${model.label}\t${model.baseUrl}\t${model.envKey}`);
NODE
}

choose_model_chain() {
  title "选择模型与降级链"
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
        # 手动输入的模型不在 TSV 表内，无法自动配路由；如需精确路由请回到列表选择。
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
    info "未能从配置中发现模型。可以留空使用 CLI 默认模型。"
    printf '模型链 [空=CLI默认] %s: ' "$(prompt_suffix)" >&2
    IFS= read -r custom || exit 1
    check_nav_input "$custom" || return $?
    MODEL_CHAIN="$custom"
    CHAIN_BASE_URLS=()
    CHAIN_ENV_KEYS=()
  fi
}

choose_judge_models() {
  title "选择判官模型（动态语义/事实评审）"
  info "判官评“静态分查不出的”事实正确性、认知顺序、零基础可读性、面试覆盖。回车=与精修主模型一致（只用链首一个）；0=不启用判官（纯静态、最快）。"
  info "提示：精修模型链是“降级链”（链首优先、挂了才换下一个）；判官默认只用链首，避免把备用模型也当判官多花一倍开销。要做多判官投票请在下面显式多选。"
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
  done < <(discover_models "$SELECTED_CLI")

  local index choice selections selected idx items
  printf ' 0. 不启用判官（纯静态 keep-best，最快）\n'
  local judge_default_model="${MODEL_CHAIN%%,*}"
  printf ' d. 与精修主模型一致（默认，只用链首一个）：%s\n' "${judge_default_model:-CLI默认}"
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
      # 只取精修链首一个模型当判官，不把整条“降级链”当 ensemble 全跑（那会用上备用模型、多花开销）。
      # 留空时由 quality_refine.mjs 默认取 modelChain[0]；这里显式取链首让 summary/日志更透明。
      JUDGE_MODELS="${MODEL_CHAIN%%,*}"
      # 路由也直接借精修链首：保证“同模型”意味着“同 provider”，否则火山/通义同名 id 又会被 qwen 静默回落。
      if (( ${#CHAIN_BASE_URLS[@]} )); then
        JUDGE_CHAIN_BASE_URLS=("${CHAIN_BASE_URLS[0]}")
        JUDGE_CHAIN_ENV_KEYS=("${CHAIN_ENV_KEYS[0]}")
      fi
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
  title "判官数量与动态免改线"
  local idx=0 rc warm_default
  warm_default="${JUDGE_WARM_CONCURRENCY:-$CONCURRENCY}"
  while (( idx < 4 )); do
    case "$idx" in
      0) ask_number "每个判官模型跑几个判官实例（>1 用投票压方差，需模型温度>0）" "$JUDGE_COUNT" 1 8 >/dev/null; rc=$? ;;
      1) ask_number "动态免改线 dynamic-skip-min（低于此分会进入改写；候选接受仍看回归向量）" "$DYNAMIC_SKIP_MIN" 1 100 >/dev/null; rc=$? ;;
      2) ask_number "判官批量大小 judge-batch-size（首轮判前预热；默认单篇，避免大批量长时间无进度）" "$JUDGE_BATCH_SIZE" 1 10 >/dev/null; rc=$? ;;
      3) ask_number "判前预热并发 judge-warm-concurrency（默认与精修并发一致）" "$warm_default" 1 8 >/dev/null; rc=$? ;;
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
    fields+=("conc" "rounds" "limit")
  fi
  if [[ "$RUN_MODE" != "audit" ]]; then
    fields+=("retries" "timeout" "degrade")
  fi
  local total="${#fields[@]}"
  local idx=0 rc field
  while (( idx < total )); do
    field="${fields[$idx]}"
    case "$field" in
      min)     ask_number "合格分 min-score" "$MIN_SCORE" 1 100 >/dev/null; rc=$? ;;
      conc)    ask_number "并发数 concurrency" "$CONCURRENCY" 1 8 >/dev/null; rc=$? ;;
      rounds)  ask_number "最大轮数 max-rounds" "$MAX_ROUNDS" 1 10 >/dev/null; rc=$? ;;
      limit)   ask_optional_number "每轮最多处理篇数 limit" 1 9999 >/dev/null; rc=$? ;;
      retries) ask_number "单篇失败重试次数 retries" "$RETRIES" 0 5 >/dev/null; rc=$? ;;
      timeout) ask_number "单篇超时秒数" "$TIMEOUT_SECONDS" 30 7200 >/dev/null; rc=$? ;;
      degrade) ask_number "连续多少次 CLI 不可用后降级模型" "$DEGRADE_AFTER" 1 50 >/dev/null; rc=$? ;;
    esac
    if (( rc == 0 )); then
      case "$field" in
        min)     MIN_SCORE="$ASK_VALUE" ;;
        conc)    CONCURRENCY="$ASK_VALUE" ;;
        rounds)  MAX_ROUNDS="$ASK_VALUE" ;;
        limit)   LIMIT="$ASK_VALUE" ;;
        retries) RETRIES="$ASK_VALUE" ;;
        timeout) TIMEOUT_SECONDS="$ASK_VALUE" ;;
        degrade) DEGRADE_AFTER="$ASK_VALUE" ;;
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

build_qwen_routes_json() {
  # 把 (model, baseUrl, envKey) 三元组合并成一份 inline JSON，给 mjs --qwen-routes 用。
  # 仅当 SELECTED_CLI 是 qwen/qwen-code 且至少一项带 baseUrl 时才返回非空字符串。
  # 实现走 node：bash 拼 JSON 容易踩 \"、$、`、引号嵌套；node 端调 JSON.stringify 一劳永逸，
  # 同时把 ~/.qwen/settings.json 字段名 envKey 重命名成 mjs 期望的 apiKeyEnv。
  local cli_base
  cli_base="${SELECTED_CLI##*/}"
  case "$cli_base" in
    qwen|qwen-code) ;;
    *) printf ''; return 0 ;;
  esac
  local -a models=("$@")
  local count=$(( ${#models[@]} / 3 ))
  (( count > 0 )) || { printf ''; return 0; }
  local has_route=0 i base_url
  for (( i = 0; i < count; i += 1 )); do
    base_url="${models[$((i * 3 + 1))]}"
    [[ -n "$base_url" ]] && { has_route=1; break; }
  done
  (( has_route == 1 )) || { printf ''; return 0; }
  /usr/local/bin/node - "$@" <<'NODE'
const out = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 3) {
  const model = argv[i];
  const baseUrl = argv[i + 1] || "";
  const envKey = argv[i + 2] || "";
  if (!model || !baseUrl) continue;
  // 同一 model 多次出现（精修主链 + 判官选了同一条）按后写入覆盖即可，三元组本身一致。
  out[model] = { baseUrl, apiKeyEnv: envKey || undefined };
  if (!envKey) delete out[model].apiKeyEnv;
}
process.stdout.write(JSON.stringify(out));
NODE
}

build_common_refine_args() {
  COMMON_ARGS=(
    --cli "$SELECTED_CLI"
    --min-score "$MIN_SCORE"
    --retries "$RETRIES"
    --timeout-ms "$((TIMEOUT_SECONDS * 1000))"
    --degrade-after "$DEGRADE_AFTER"
    --progress-style "$PROGRESS_STYLE"
    --heartbeat-seconds "$HEARTBEAT_SECONDS"
  )
  if [[ -n "$MODEL_CHAIN" ]]; then
    COMMON_ARGS+=(--model-chain "$MODEL_CHAIN")
  fi
  if [[ "$JUDGE_ENABLED" == "1" ]]; then
    # 判官 CLI 默认 = 精修 CLI；判官模型空时由 .mjs 默认取精修主模型。
    [[ -n "$JUDGE_MODELS" ]] && COMMON_ARGS+=(--judge-models "$JUDGE_MODELS")
    COMMON_ARGS+=(--judge-count "$JUDGE_COUNT" --dynamic-skip-min "$DYNAMIC_SKIP_MIN" --judge-batch-size "$JUDGE_BATCH_SIZE" --judge-json-retries "$JUDGE_JSON_RETRIES")
    [[ -n "$JUDGE_WARM_CONCURRENCY" ]] && COMMON_ARGS+=(--judge-warm-concurrency "$JUDGE_WARM_CONCURRENCY")
  else
    COMMON_ARGS+=(--no-judge)
  fi

  # qwen/qwen-code 显式路由：把精修链 + 判官多选模型的 (model, baseUrl, envKey) 全收齐写成 inline JSON
  # 交给 mjs。这是解决 “同 modelId 不同 provider 被 qwen 静默回落到第一条 openai entry → 402” 的关键。
  # apiKey 不进命令行（防 ps 泄露），mjs 端读 envKey 指向的环境变量或 ~/.qwen/settings.json 的 env 段。
  local -a route_triples=()
  local i n
  n=${#MODEL_CHAIN_ITEMS[@]:-0}
  if (( n > 0 )); then
    for (( i = 0; i < n; i += 1 )); do
      route_triples+=("${MODEL_CHAIN_ITEMS[$i]}" "${CHAIN_BASE_URLS[$i]:-}" "${CHAIN_ENV_KEYS[$i]:-}")
    done
  fi
  if [[ "$JUDGE_ENABLED" == "1" && -n "$JUDGE_MODELS" ]]; then
    local judge_count=${#JUDGE_CHAIN_BASE_URLS[@]:-0}
    if (( judge_count > 0 )); then
      local -a judge_items=()
      IFS=',' read -r -a judge_items <<< "$JUDGE_MODELS"
      local jn=${#judge_items[@]}
      (( jn < judge_count )) && judge_count=$jn
      for (( i = 0; i < judge_count; i += 1 )); do
        route_triples+=("${judge_items[$i]}" "${JUDGE_CHAIN_BASE_URLS[$i]:-}" "${JUDGE_CHAIN_ENV_KEYS[$i]:-}")
      done
    fi
  fi
  if (( ${#route_triples[@]} > 0 )); then
    local routes_json
    routes_json="$(build_qwen_routes_json "${route_triples[@]}")"
    # 当返回空串（CLI 不是 qwen 系，或全部模型都没有 baseUrl）时跳过追加。
    if [[ -n "$routes_json" && "$routes_json" != "{}" ]]; then
      COMMON_ARGS+=(--qwen-routes "$routes_json")
    fi
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
    print_qwen_route_summary
    printf '重试：%s 次，超时：%s 秒，降级阈值：%s\n' "$RETRIES" "$TIMEOUT_SECONDS" "$DEGRADE_AFTER"
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

print_qwen_route_summary() {
  # 把已绑定的 (model → host · envKey) 一行行打出来；列表空就一行 “未绑定”。
  # 让用户当场识破“忘选/选错 provider”——尤其是火山/通义同名 id 的场景。
  local cli_base
  cli_base="${SELECTED_CLI##*/}"
  case "$cli_base" in
    qwen|qwen-code) ;;
    *) return 0 ;;
  esac
  local n=${#MODEL_CHAIN_ITEMS[@]:-0}
  if (( n == 0 )); then
    printf 'qwen 路由：未绑定（用 CLI 默认/手动模型链）\n'
    return 0
  fi
  local i model base_url env_key host any=0
  for (( i = 0; i < n; i += 1 )); do
    model="${MODEL_CHAIN_ITEMS[$i]}"
    base_url="${CHAIN_BASE_URLS[$i]:-}"
    env_key="${CHAIN_ENV_KEYS[$i]:-}"
    [[ -z "$base_url" ]] && continue
    any=1
    host="${base_url#*://}"; host="${host%%/*}"
    if (( i == 0 )); then
      printf 'qwen 路由：\n'
    fi
    printf '  - %s → %s · %s\n' "$model" "$host" "${env_key:-（无 envKey）}"
  done
  (( any == 0 )) && printf 'qwen 路由：选中模型未携带 baseUrl（不会传 --qwen-routes）\n'
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
