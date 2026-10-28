#!/usr/bin/env bash
# 源码仓库内交互启动新版 TUI；无源码的 curl | bash 场景保留旧部署流程。
# 如需强制使用旧部署菜单：ERI_LEGACY_INSTALL=1 bash install-eri.sh
if [[ "${ERI_LEGACY_INSTALL:-0}" != "1" && $# -eq 0 && -t 0 && -t 1 ]]; then
  _ERI_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$_ERI_SCRIPT_DIR/index.js" && -f "$_ERI_SCRIPT_DIR/lib/tui.js" ]] && command -v node >/dev/null 2>&1; then
    exec node "$_ERI_SCRIPT_DIR/index.js"
  fi
fi
# ============================================================
# install-eri.sh - 绘里酱人格 · 交互式/一键部署 (Linux/macOS/Termux/WSL/Git-Bash)
# 用法: bash install-eri.sh [RAW_URL]
# 交互模式: 选择工具 -> 查找本地路径 -> 已装则部署人格 /
#           未装则按官网方式安装 -> 检查确认安装完成后部署人格
#           菜单 0 = OpenCode 深度集成（skill + 5 子智慧体 + personality 插件 + mood）
# 非交互模式 (curl | bash 一键): 自动部署已装工具;
#           默认不擅自安装第三方工具；如需安装 OpenCode，显式设置 ERI_INSTALL_DEFAULT=opencode;
#           本地存在深度资源(仓库克隆或 AUR 安装)时自动追加深度集成
# 深度资源(skill/personality/子智慧体)查找: /usr/share/eri-ai-debug (pacman) > 脚本所在目录 (仓库克隆)
# 人格文件(eri.md)查找: 脚本所在目录 > RAW_URL 下载
# 附: 部署完成后会注册独立可执行命令 `eri-ai-debug`,
#     用 `eri-ai-debug update` 刷新人格, `eri-ai-debug uninstall` 整体卸载
#     (见文件末尾)
# ============================================================
set -uo pipefail

INTERACTIVE=1
[ -t 0 ] || INTERACTIVE=0

DEFAULT_URL="https://raw.githubusercontent.com/nino-natsume/eri-ai-debug/main/eri.md"
RAW_URL="${1:-$DEFAULT_URL}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="${HOME:-}"
PKG_DIR="/usr/share/eri-ai-debug"

if [ -z "$HOME_DIR" ] || [ ! -d "$HOME_DIR" ]; then
  echo "==> 错误：HOME 未设置或不是有效目录，无法安全安装。" >&2
  exit 1
fi

if command -v mktemp >/dev/null 2>&1; then
  DL_CACHE="$(mktemp "${TMPDIR:-/tmp}/eri.XXXXXX")" || {
    echo "==> 错误：无法创建临时文件。" >&2
    exit 1
  }
else
  DL_CACHE="${TMPDIR:-/tmp}/eri.$$.$RANDOM.tmp"
  (umask 077 && : > "$DL_CACHE") || {
    echo "==> 错误：无法创建临时文件：$DL_CACHE" >&2
    exit 1
  }
fi

cleanup() { [ -n "${DL_CACHE:-}" ] && rm -f -- "$DL_CACHE"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

TOOLS=(
  "opencode|OpenCode|opencode|npm install -g opencode-ai|https://opencode.ai|$HOME_DIR/.config/opencode/agents|eri.md|"
  "claude|Claude Code|claude|npm install -g @anthropic-ai/claude-code|https://code.claude.com|$HOME_DIR/.claude|CLAUDE.md|"
  "codex|Codex CLI (OpenAI)|codex|npm install -g @openai/codex|https://developers.openai.com/codex|$HOME_DIR/.codex|AGENTS.md|"
  "gemini|Gemini CLI (Google)|gemini|npm install -g @google/gemini-cli|https://github.com/google-gemini/gemini-cli|$HOME_DIR/.gemini|GEMINI.md|"
  "qwen|Qwen Code (Alibaba)|qwen|npm install -g @qwen-code/qwen-code@latest|https://github.com/QwenLM/qwen-code|$HOME_DIR/.qwen|GEMINI.md|"
  "aider|Aider|aider|python -m pip install -U aider-chat|https://aider.chat|$HOME_DIR/.config/aider|eri.md|aider"
  "cursor|Cursor CLI|cursor-agent||https://cursor.com/docs/cli/installation|$HOME_DIR/.cursor|AGENTS.md|"
  "windsurf|Windsurf CLI|windsurf||https://docs.windsurf.com|$HOME_DIR/.windsurf|AGENTS.md|"
  "amp|Amp|amp||https://ampcode.com|$HOME_DIR/.amp|AGENTS.md|"
  "goose|Goose (Block)|goose||https://block.github.io/goose/|$HOME_DIR/.config/goose|AGENTS.md|"
  "copilot|GitHub Copilot CLI|copilot|npm install -g @github/copilot|https://github.com/github/copilot-cli|$HOME_DIR/.github/copilot|AGENTS.md|"
  "plandex|Plandex|plandex|npm install -g plandex|https://plandex.ai|$HOME_DIR/.plandex|AGENTS.md|"
  "tabby|Tabby|tabby-agent|npm install -g tabby-agent|https://tabbyml.com|$HOME_DIR/.tabby|AGENTS.md|"
  "fabric|Fabric|fabric|go install github.com/danielmiessler/fabric@latest|https://github.com/danielmiessler/fabric|$HOME_DIR/.config/fabric|AGENTS.md|"
  "openhands|OpenHands|openhands|python -m pip install -U openhands-ai|https://docs.all-hands.dev|$HOME_DIR/.openhands|AGENTS.md|"
  "crush|Crush|crush||https://crush.chat|$HOME_DIR/.crush|AGENTS.md|"
  "devin|Devin CLI|devin||https://devin.ai|$HOME_DIR/.devin|AGENTS.md|"
  "continue|Continue|continue||https://continue.dev|$HOME_DIR/.continue|AGENTS.md|"
)

get_persona_source() {
  if [ -f "$SCRIPT_DIR/eri.md" ]; then
    echo "==> 使用本地人格文件: $SCRIPT_DIR/eri.md" >&2
    echo "$SCRIPT_DIR/eri.md"
    return 0
  fi
  if [ -s "$DL_CACHE" ]; then
    echo "==> 复用已下载人格文件: $DL_CACHE" >&2
    echo "$DL_CACHE"
    return 0
  fi
  echo "==> 下载人格文件: $RAW_URL" >&2
  if ! curl -fsSL "$RAW_URL" -o "$DL_CACHE"; then
    rm -f "$DL_CACHE"
    echo "==> 下载失败: $RAW_URL" >&2
    return 1
  fi
  echo "$DL_CACHE"
}

# ---------- 深度部署资源查找: 包内(pacman) > 脚本同目录(仓库克隆) ----------
# 注意: 提示信息走 stderr, stdout 只输出路径供命令替换捕获
find_deep_src() {
  local d
  for d in "$PKG_DIR" "$SCRIPT_DIR"; do
    [ -f "$d/personality.json" ] || continue
    echo "==> 使用深度部署资源: $d" >&2
    echo "$d"
    return 0
  done
  return 1
}

# 在资源目录中定位文件: 兼容 仓库扁平布局($dir/SKILL.md) 与 打包布局($dir/skill/eri/SKILL.md)
deep_pick() {
  local dir="$1" rel="$2" flat="$3"
  if [ -f "$dir/$rel" ]; then echo "$dir/$rel"; return 0; fi
  if [ -f "$dir/$flat" ]; then echo "$dir/$flat"; return 0; fi
  return 1
}

# ---------- 菜单 0：OpenCode 深度集成（skill + 5 子智慧体 + personality 插件 + mood） ----------
deploy_opencode_deep() {
  local src
  if ! src="$(find_deep_src)"; then
    echo "==> 错误：未找到深度部署资源(personality.json)" >&2
    echo "    请在仓库根目录运行本脚本，或先通过包管理器安装 eri-ai-debug" >&2
    return 1
  fi

  # 与轻量部署/eri CLI/uninstall 保持一致, 固定使用 $HOME/.config (不引入 XDG 分裂)
  local cfg="$HOME_DIR/.config/opencode"
  mkdir -p "$cfg/agent" "$cfg/skill/eri"

  copy_with_backup "$src/personality.json" "$cfg/personality.json" || return 1
  echo "==> personality.json -> $cfg/personality.json"

  local a f
  for a in erotic-chan code-monkey debug-san architect-sama test-chan; do
    if f="$(deep_pick "$src" "agent/$a.md" "$a.md")"; then
      copy_with_backup "$f" "$cfg/agent/$a.md" || return 1
      echo "==> agent/$a.md -> $cfg/agent/$a.md"
    else
      echo "==> 警告：缺少子智慧体 $a.md,已跳过" >&2
    fi
  done

  if f="$(deep_pick "$src" "skill/eri/SKILL.md" "SKILL.md")"; then
    copy_with_backup "$f" "$cfg/skill/eri/SKILL.md" || return 1
    echo "==> SKILL.md -> $cfg/skill/eri/SKILL.md"
  else
    echo "==> 警告：缺少 SKILL.md,skill 不可用" >&2
  fi

  # opencode 配置处理: 无配置 -> 直接写模板;
  # 已有配置含 plugin 字段 -> 已深度集成, 跳过(幂等);
  # 已有配置缺深度字段(如轻量部署只写了 default_agent) -> 交互确认后备份覆盖, 并保留原 default_agent
  local oc="$cfg/opencode.jsonc" write_tpl=0 old_da=""
  [ -f "$cfg/opencode.json" ] && [ ! -f "$oc" ] && oc="$cfg/opencode.json"
  if [ ! -f "$oc" ]; then
    copy_with_backup "$src/opencode.json" "$cfg/opencode.jsonc" || return 1
    echo "==> opencode.json -> $cfg/opencode.jsonc"
  elif grep -q '"plugin"' "$oc"; then
    echo "==> 已有 opencode 配置含深度集成字段,跳过模板写入: $oc"
  else
    old_da="$(jsonc_get_root_string "$oc" "default_agent" 2>/dev/null || true)"
    if [ "$INTERACTIVE" -eq 1 ]; then
      local ans
      if read -rp "已有 opencode 配置缺少 plugin/skills 等深度字段,是否备份后用模板覆盖? [y/N] " ans; then
        case "$ans" in y|Y|yes|YES) write_tpl=1 ;; *) write_tpl=0 ;; esac
      else
        write_tpl=0
      fi
    else
      echo "==> 非交互模式：保留现有 OpenCode 配置，不自动覆盖。" >&2
      echo "    如需深度集成，请在交互模式下明确确认，或手动合并模板字段。" >&2
      write_tpl=0
    fi
    if [ "$write_tpl" -eq 1 ] && ! jsonc_parser_available; then
      echo "==> 无法安全合并/恢复 default_agent：未检测到 jsonc-parser。" >&2
      echo "    为保护现有配置，已取消模板覆盖；请在仓库目录安装依赖，或手动合并配置。" >&2
      write_tpl=0
    fi
    if [ "$write_tpl" -eq 1 ]; then
      # 覆盖前保存当前版本；已存在 .bak 时再保存带时间戳的副本。
      copy_with_backup "$src/opencode.json" "$oc" || return 1
      echo "==> 深度配置已写入: $oc (旧配置备份已保留)"
      if [ -n "$old_da" ]; then
        if jsonc_set_key "$oc" "default_agent" "$old_da"; then
          echo "==> 已保留原 default_agent = $old_da"
        else
          echo "==> 警告：无法安全恢复 default_agent；原配置备份仍保留在 $oc.bak" >&2
        fi
      fi
    else
      echo "注意：请手动合并 $src/opencode.json 中的 plugin/agent/skills/command 字段到 $oc"
    fi
  fi

  # 选装依赖: 仅在选中/检测到 OpenCode 深度集成时, 才从独立清单安装 personality 插件依赖
  if [[ -f "$src/opencode-package.json" && ! -f "$cfg/package.json" ]]; then
    cp -f "$src/opencode-package.json" "$cfg/package.json"
    echo "==> package.json (OpenCode 依赖清单) -> $cfg/package.json"
  fi

  # 一并带上 lock 文件, 让 npm install 复用清单锁定的依赖版本 (可复现构建)
  if [[ -f "$src/opencode-package-lock.json" && ! -f "$cfg/package-lock.json" ]]; then
    cp -f "$src/opencode-package-lock.json" "$cfg/package-lock.json"
    echo "==> package-lock.json -> $cfg/package-lock.json"
  fi

  if command -v npm >/dev/null 2>&1; then
    (cd "$cfg" && npm install --no-audit --no-fund) || {
      echo "==> 错误：npm install 失败,请检查网络后在 $cfg 下重试" >&2
      return 1
    }
  else
    echo "==> 错误：未找到 npm。请先安装 npm 后重试本步骤 (Arch: sudo pacman -S npm)" >&2
    return 1
  fi

  echo "==> OpenCode 深度部署完成！重启 opencode 生效。"
  echo "    之后可用 /personality 管理人格, /force-chat 与 /force-work 切换模式, /mood 设置心情。"
}

# ---------- 安全文件与 JSONC 操作 ----------
# 有原文件时先保留 .bak；若 .bak 已存在，再保存带时间戳的副本。
backup_existing_file() {
  local target backup stamp
  target="${1:-}"
  [ -f "$target" ] || return 0
  if [ ! -e "$target.bak" ]; then
    backup="$target.bak"
  else
    stamp="$(date +%Y%m%d-%H%M%S)-$$"
    backup="$target.eri-backup-$stamp"
  fi
  cp -p "$target" "$backup" || {
    echo "==> 错误：无法备份文件 $target；拒绝覆盖。" >&2
    return 1
  }
  echo "==> 已备份: $backup"
}

copy_with_backup() {
  local src target tmp
  src="${1:-}"
  target="${2:-}"
  [ -f "$src" ] || { echo "==> 错误：源文件不存在：$src" >&2; return 1; }
  mkdir -p "$(dirname "$target")" || return 1
  if [ -L "$target" ]; then
    echo "==> 错误：目标是符号链接，为避免覆盖链接目标，拒绝写入：$target" >&2
    return 1
  fi
  if [ -f "$target" ] && ! cmp -s "$src" "$target"; then
    backup_existing_file "$target" || return 1
  fi
  if [ ! -f "$target" ] || ! cmp -s "$src" "$target"; then
    tmp="${target}.eri-tmp.$$"
    cp "$src" "$tmp" || { rm -f -- "$tmp"; return 1; }
    mv -f "$tmp" "$target" || { rm -f -- "$tmp"; return 1; }
  fi
}

jsonc_parser_available() {
  command -v node >/dev/null 2>&1 || return 1
  ERI_JSONC_MODULE_DIR="${SCRIPT_DIR:-}" node -e '
    const path = require("path");
    const base = process.env.ERI_JSONC_MODULE_DIR;
    const candidates = [];
    if (base) candidates.push(path.join(base, "lib", "jsonc-lite"));
    if (base) candidates.push(path.join(base, "node_modules", "jsonc-parser"));
    candidates.push(path.join("/usr/share/eri-ai-debug", "lib", "jsonc-lite"));
    candidates.push("jsonc-parser");
    for (const candidate of candidates) {
      try { require(candidate); process.exit(0); } catch (_) {}
    }
    process.exit(1);
  ' >/dev/null 2>&1
}

# 只读取 JSONC 根对象中的字符串属性，不用 grep 猜测嵌套字段或注释。
jsonc_get_root_string() {
  local file key
  file="${1:-}"
  key="${2:-}"
  [ -n "$file" ] && [ -f "$file" ] || return 1
  command -v node >/dev/null 2>&1 || return 1
  ERI_JSONC_FILE="$file" ERI_JSONC_KEY="$key" ERI_JSONC_MODULE_DIR="${SCRIPT_DIR:-}" node <<'ERI_JSONC_GET'
const path = require('path');
function loadParser() {
  const candidates = [];
  const base = process.env.ERI_JSONC_MODULE_DIR;
  if (base) candidates.push(path.join(base, 'lib', 'jsonc-lite'));
  if (base) candidates.push(path.join(base, 'node_modules', 'jsonc-parser'));
  candidates.push(path.join('/usr/share/eri-ai-debug', 'lib', 'jsonc-lite'));
  candidates.push('jsonc-parser');
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) {}
  }
  throw new Error('jsonc-parser unavailable');
}
try {
  const { parse } = loadParser();
  const text = require('fs').readFileSync(process.env.ERI_JSONC_FILE, 'utf8');
  const errors = [];
  const root = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !root || typeof root !== 'object' || Array.isArray(root)) process.exit(2);
  const value = root[process.env.ERI_JSONC_KEY];
  if (typeof value === 'string') process.stdout.write(value);
} catch (_) { process.exit(1); }
ERI_JSONC_GET
}

# 只通过 jsonc-parser 修改 JSONC；缺少解析器或配置非法时拒绝写入，绝不回退为正则替换。
jsonc_set_key() {
  local file key val
  file="${1:-}"
  key="${2:-}"
  val="${3:-}"
  [ -n "$file" ] && [ -f "$file" ] || return 1
  command -v node >/dev/null 2>&1 || {
    echo "==> 警告：未找到 Node.js，无法安全修改 $file；请手动合并配置。" >&2
    return 1
  }

  ERI_JSONC_FILE="$file" ERI_JSONC_KEY="$key" ERI_JSONC_VALUE="$val" \
  ERI_JSONC_MODULE_DIR="${SCRIPT_DIR:-}" node <<'ERI_JSONC_NODE'
const fs = require('fs');
const path = require('path');

function loadParser() {
  const candidates = [];
  const base = process.env.ERI_JSONC_MODULE_DIR;
  if (base) candidates.push(path.join(base, 'lib', 'jsonc-lite'));
  if (base) candidates.push(path.join(base, 'node_modules', 'jsonc-parser'));
  candidates.push(path.join('/usr/share/eri-ai-debug', 'lib', 'jsonc-lite'));
  candidates.push('jsonc-parser');
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) { /* try next */ }
  }
  throw new Error('未找到 jsonc-parser。请在仓库目录执行 npm install，或手动修改配置。');
}

let tmp;
try {
  const { parse, modify, applyEdits } = loadParser();
  const file = process.env.ERI_JSONC_FILE;
  const key = process.env.ERI_JSONC_KEY;
  const value = process.env.ERI_JSONC_VALUE;
  const before = fs.readFileSync(file, 'utf8');
  const errors = [];
  const root = parse(before, errors, { allowTrailingComma: true });
  if (errors.length || !root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('配置不是合法的 JSONC 根对象；原文件未修改。');
  }
  const edits = modify(before, [key], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: before.includes('\r\n') ? '\r\n' : '\n' },
  });
  const after = applyEdits(before, edits);
  const errorsAfter = [];
  const rootAfter = parse(after, errorsAfter, { allowTrailingComma: true });
  if (errorsAfter.length || !rootAfter || typeof rootAfter !== 'object' || Array.isArray(rootAfter)) {
    throw new Error('修改结果未通过 JSONC 校验；原文件未修改。');
  }
  if (after === before) process.exit(0);
  const firstBackup = `${file}.bak`;
  const backup = fs.existsSync(firstBackup)
    ? `${file}.eri-backup-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${process.pid}`
    : firstBackup;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  console.error(`==> 已备份: ${backup}`);
  const stat = fs.statSync(file);
  tmp = `${file}.eri-tmp-${process.pid}`;
  fs.writeFileSync(tmp, after, { encoding: 'utf8', mode: stat.mode & 0o777 });
  if (process.platform === 'win32') {
    const old = `${tmp}.old`;
    fs.renameSync(file, old);
    try {
      fs.renameSync(tmp, file);
    } catch (err) {
      if (!fs.existsSync(file) && fs.existsSync(old)) fs.renameSync(old, file);
      throw err;
    }
    fs.rmSync(old, { force: true });
  } else {
    fs.renameSync(tmp, file);
  }
} catch (err) {
  if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch (_) {} }
  console.error(`==> JSONC 修改失败：${err.message}`);
  process.exitCode = 1;
}
ERI_JSONC_NODE
}

enable_tool_config() {
  local id="$1" pdir="$2" pfile="$3"
  case "$id" in
    opencode)
      local opcfg_dir opcfg agent_name
      opcfg_dir="$(dirname "$pdir")"
      opcfg="$opcfg_dir/opencode.jsonc"
      agent_name="${pfile%.md}"
      if [ -f "$opcfg" ]; then
        if jsonc_set_key "$opcfg" "default_agent" "$agent_name"; then
          echo "==> OpenCode 配置已更新: $opcfg (default_agent = $agent_name)"
        else
          echo "==> 警告：未能安全修改 OpenCode 配置；请手动设置 default_agent = $agent_name" >&2
        fi
      else
        printf '{\n  "$schema": "https://opencode.ai/config.json",\n  "default_agent": "%s"\n}\n' "$agent_name" > "$opcfg" || return 1
        echo "==> OpenCode 配置已创建: $opcfg (default_agent = $agent_name)"
      fi
      ;;
  esac
}

deploy_persona() {
  local id="$1" pdir="$2" pfile="$3" mode="$4" src="$5"

  if [ "$mode" = "aider" ]; then
    mkdir -p "$pdir"
    local persona_file="$pdir/$pfile"
    copy_with_backup "$src" "$persona_file" || return 1
    local cfg="$HOME_DIR/.aider.conf.yml"
    if [ -f "$cfg" ]; then
      if grep -qF "$persona_file" "$cfg"; then
        echo "==> aider read 已包含本路径,无需修改"
      elif grep -Eq '^read:[[:space:]]*$|^read:[[:space:]]*\[.*\][[:space:]]*$' "$cfg"; then
        # 只自动处理空的多行 read 列表或单行方括号列表。
        backup_existing_file "$cfg" || return 1
        local tmpcfg="${cfg}.tmp.$$"
        awk -v p="$persona_file" '
          /^read:[[:space:]]*$/ && !done { print; print "  - " p; done=1; next }
          /^read:/ && !done {
            sub(/^[[:space:]]*read:[[:space:]]*/, "")
            if ($0 ~ /^\[.*\][[:space:]]*$/) {
              inner=$0
              sub(/^\[/, "", inner); sub(/\][[:space:]]*$/, "", inner)
              gsub(/^[[:space:]]+|[[:space:]]+$/, "", inner)
              if (inner == "") print "read: [" p "]"
              else print "read: [" inner ", " p "]"
            } else {
              print "read: " $0 " " p
            }
            done=1; next
          }
          { print }
        ' "$cfg" > "$tmpcfg" && mv "$tmpcfg" "$cfg"
        echo "==> 已追加到 aider read: $persona_file"
      elif grep -q '^read:' "$cfg"; then
        echo "==> 警告：Aider read 使用了无法安全识别的格式；未修改 $cfg。请手动添加：$persona_file" >&2
      else
        backup_existing_file "$cfg" || return 1
        printf '\nread: "%s"\n' "$persona_file" >> "$cfg"
      fi
    else
      printf 'read: "%s"\n' "$persona_file" > "$cfg"
    fi
    echo "==> 人格已部署: $persona_file (aider 已配置 read)"
    return
  fi

  mkdir -p "$pdir"
  local target="$pdir/$pfile"
  copy_with_backup "$src" "$target" || return 1
  echo "==> 人格已部署: $target"
  enable_tool_config "$id" "$pdir" "$pfile"
}

deploy_one() {
  local line="$1"
  IFS='|' read -ra F <<< "$line"
  while [ "${#F[@]}" -lt 8 ]; do F+=(""); done
  local id="${F[0]}" name="${F[1]}" cmd="${F[2]}" install="${F[3]}" site="${F[4]}" pdir="${F[5]}" pfile="${F[6]}" mode="${F[7]}"
  local ans
  echo ""
  echo "==== 部署: $name (检查命令: $cmd) ===="
  if type -P "$cmd" >/dev/null 2>&1; then
    echo "==> 已检测到本地安装: $(type -P "$cmd")"
    local src; src="$(get_persona_source)" || { echo "==> 无法获取人格文件,跳过 $name" >&2; return 1; }
    deploy_persona "$id" "$pdir" "$pfile" "$mode" "$src"
    echo "==> 完成!重启 $name 生效"
    return
  fi
  echo "==> 未检测到 $name,开始按官方方式安装..."
  if [ -n "$install" ]; then
    if [ "$INTERACTIVE" -eq 1 ]; then
      if ! read -rp "是否执行官方安装命令? [Y/n]  $install " ans; then ans="n"; fi
    else
      ans="n"
    fi
    if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
      echo "==> 执行: $install"
      eval "$install"
    fi
  else
    echo "==> 请按官网指引安装: $site"
    if [ "$INTERACTIVE" -eq 1 ]; then
      if ! read -rp "是否用浏览器打开官网? [Y/n] " open; then open="n"; fi
    else
      open="n"
    fi
    if [ "$open" != "n" ] && [ "$open" != "N" ]; then
      if command -v xdg-open >/dev/null 2>&1; then xdg-open "$site"
      elif type -P open >/dev/null 2>&1; then open "$site"
      else echo "==> 请手动访问: $site"; fi
    fi
  fi
  while true; do
    if type -P "$cmd" >/dev/null 2>&1; then
      echo "==> 安装确认成功: $(type -P "$cmd")"
      local src2; src2="$(get_persona_source)" || { echo "==> 无法获取人格文件,跳过 $name" >&2; return 1; }
      deploy_persona "$id" "$pdir" "$pfile" "$mode" "$src2"
      echo "==> 完成!重启 $name 生效"
      return
    fi
    if [ "$INTERACTIVE" -eq 0 ]; then
      echo "==> 非交互模式,未检测到 $cmd,跳过 $name 的人格部署"
      return
    fi
    if ! read -rp "尚未检测到 $cmd。安装完成了吗? 回车重新检查 / 输入 n 跳过 " ans; then
      echo "==> 已跳过 $name 的人格部署"
      return
    fi
    if [ "$ans" = "n" ] || [ "$ans" = "N" ]; then
      echo "==> 已跳过 $name 的人格部署"
      return
    fi
  done
}

echo ""
echo "=============================================="
echo "  绘里酱 (eri) 人格 · 交互式部署"
echo "=============================================="
echo ""
echo "  0. OpenCode 深度集成            （skill+子智慧体+personality 插件+mood）"
echo "支持的终端编程工具（轻量人格部署）:"
for i in "${!TOOLS[@]}"; do
  IFS='|' read -ra F <<< "${TOOLS[$i]}"
  printf "  %2d. %-24s 检查命令: %s\n" "$((i + 1))" "${F[1]}" "${F[2]}"
done

if [ "$INTERACTIVE" -eq 1 ]; then
  while true; do
    echo ""
    if ! read -rp "请选择工具编号(0=OpenCode深度集成,支持逗号多选,如 0,1,5; 输入 q 退出): " choice; then
      break
    fi
    case "${choice//[[:space:]]/}" in
      q|Q) break ;;
    esac
    ok=0
    IFS=',， ' read -ra NUMS <<< "$choice"
    for n in "${NUMS[@]}"; do
      if [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -eq 0 ]; then
        deploy_opencode_deep
        ok=1
      elif [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le "${#TOOLS[@]}" ]; then
        deploy_one "${TOOLS[$((n - 1))]}"
        ok=1
      fi
    done
    [ "$ok" -eq 0 ] && echo "==> 输入无效,请重新选择"
  done
else
  echo ""
  echo "==> 检测到非交互模式(stdin 非终端),自动部署所有已安装的工具..."
  # 仅当检测到 OpenCode 已安装时才执行深度集成(会安装 opencode-personality 等选装依赖)
  if type -P opencode >/dev/null 2>&1; then
    if deep_src="$(find_deep_src)"; then
      echo "==> 检测到 OpenCode,执行深度集成(安装 opencode-personality 等选装依赖)..."
      deploy_opencode_deep || echo "==> 深度集成未完全成功(不影响轻量人格部署)"
    fi
  fi
  deployed=0
  for i in "${!TOOLS[@]}"; do
    IFS='|' read -ra F <<< "${TOOLS[$i]}"
    while [ "${#F[@]}" -lt 8 ]; do F+=(""); done
    if type -P "${F[2]}" >/dev/null 2>&1; then
      if deploy_one "${TOOLS[$i]}"; then
        deployed=1
      fi
    fi
  done
  if [ "$deployed" -eq 0 ]; then
    if [ "${ERI_INSTALL_DEFAULT:-}" = "opencode" ]; then
      echo "==> ERI_INSTALL_DEFAULT=opencode：按显式请求安装 OpenCode ..."
      IFS='|' read -ra FF <<< "${TOOLS[0]}"
      while [ "${#FF[@]}" -lt 8 ]; do FF+=(""); done
      if command -v npm >/dev/null 2>&1 && [ -n "${FF[3]}" ]; then
        echo "==> 执行: ${FF[3]}"
        eval "${FF[3]}"
        if type -P "${FF[2]}" >/dev/null 2>&1; then
          if deploy_one "${TOOLS[0]}"; then deployed=1; fi
        else
          echo "==> OpenCode 安装未成功，请手动安装: ${FF[3]}" >&2
        fi
      else
        echo "==> 未找到 npm，无法自动安装 OpenCode。" >&2
      fi
    else
      echo "==> 未检测到任何已安装的终端工具；为避免未经确认地安装第三方软件，本次不自动安装 OpenCode。"
      echo "    手动安装 OpenCode 后重新运行，或明确设置 ERI_INSTALL_DEFAULT=opencode。"
    fi
  fi
  if [ "$deployed" -eq 0 ]; then
    echo "==> 仍未部署任何工具(安装失败,或人格文件获取失败)"
    echo "    请用交互模式选择并安装工具: bash install-eri.sh"
  fi
fi
echo ""
echo "==> 部署完成!记得重启对应工具,让绘里酱人格生效♡"

# ============================================================
# 注册更新短命令 (eri-ai-debug update / eri-ai-debug uninstall)
# ============================================================
BIN_DIR="$HOME_DIR/.local/bin"
ERI_BIN="$BIN_DIR/eri-ai-debug"
mkdir -p "$BIN_DIR"

if [ -L "$ERI_BIN" ]; then
  echo "==> 错误：$ERI_BIN 是符号链接；为避免覆盖链接目标，已停止注册 eri-ai-debug 命令。" >&2
  exit 1
fi
if [ -e "$ERI_BIN" ] && [ ! -f "$ERI_BIN" ]; then
  echo "==> 错误：$ERI_BIN 已存在且不是普通文件；拒绝覆盖。" >&2
  exit 1
fi
if [ -f "$ERI_BIN" ]; then
  if grep -qF '# 由 install-eri.sh 生成; 可独立运行' "$ERI_BIN"; then
    : # 已有 Eri 管理脚本，允许更新。
  elif [ -e "$ERI_BIN.bak" ]; then
    echo "==> 错误：$ERI_BIN 是其他程序，且备份路径 $ERI_BIN.bak 已存在。为保护两个文件，未覆盖。" >&2
    exit 1
  else
    cp -p "$ERI_BIN" "$ERI_BIN.bak" || {
      echo "==> 错误：无法备份现有命令 $ERI_BIN；拒绝覆盖。" >&2
      exit 1
    }
    echo "==> 已备份现有 eri-ai-debug 命令: $ERI_BIN.bak"
  fi
fi

cat > "$ERI_BIN" <<'ERI_EOF'
#!/usr/bin/env bash
# eri-ai-debug - 绘里酱人格管理工具
# 由 install-eri.sh 生成; 可独立运行
#
# 用法:
#   eri-ai-debug update [RAW_URL]    更新人格到所有已安装的终端工具 (默认命令)
#   eri-ai-debug uninstall [--yes]   卸载所有已部署的人格和 eri-ai-debug 命令
#   eri-ai-debug version             显示版本
#   eri-ai-debug help                显示帮助
#   eri-ai-debug <RAW_URL>           兼容简写, 等价于 eri-ai-debug update <RAW_URL>
#
# 环境变量:
#   ERI_URL                 自定义人格文件 URL
set -uo pipefail

DEFAULT_URL="https://raw.githubusercontent.com/nino-natsume/eri-ai-debug/main/eri.md"
HOME_DIR="${HOME:-}"
if [ -z "$HOME_DIR" ] || [ ! -d "$HOME_DIR" ]; then
  echo "==> 错误：HOME 未设置或不是有效目录。" >&2
  exit 1
fi
BIN_DIR="$HOME_DIR/.local/bin"
ERI_BIN="$BIN_DIR/eri-ai-debug"
ERI_VERSION="__ERI_VERSION__"   # 由 install-eri.sh 从同目录 package.json 自动注入

show_help() {
  cat <<'HELP'
eri-ai-debug - 绘里酱人格管理工具

用法:
  eri-ai-debug update [RAW_URL]    更新人格到所有已安装的终端工具 (默认命令)
  eri-ai-debug uninstall [--yes]   卸载所有已部署的人格文件和 eri-ai-debug 命令
                          (不带 --yes 时会在交互式终端里二次确认)
  eri-ai-debug help                显示帮助
  eri-ai-debug version             显示版本
  eri-ai-debug <RAW_URL>           兼容简写, 等价于 eri-ai-debug update <RAW_URL>

环境变量:
  ERI_URL                 自定义人格文件 URL

常见问题:
  若提示 'eri-ai-debug: command not found', 请执行:
    export PATH="$HOME/.local/bin:$PATH"
  或打开一个新终端窗口。
HELP
}

do_uninstall() {
  local yes_flag="${1:-}"
  echo "==> 绘里酱人格卸载"
  echo ""
  echo "将执行以下操作:"
  echo "  • 删除/恢复各工具的人格文件 (如 .bak 存在则恢复备份)"
  echo "  • 清理 OpenCode default_agent 与 aider read 配置"
  echo "  • 删除命令: $ERI_BIN"
  echo "  • 从 shell 配置中移除本脚本添加的 PATH 行"
  echo ""

  if [ "$yes_flag" != "--yes" ] && [ "$yes_flag" != "-y" ]; then
    if [ -t 0 ]; then
      local ans
      if ! read -rp "确认卸载? [y/N] " ans; then ans="n"; fi
      if [ "$ans" != "y" ] && [ "$ans" != "Y" ]; then
        echo "==> 已取消"
        return 0
      fi
    else
      echo "==> 非交互模式, 如需静默卸载请加 --yes (eri-ai-debug uninstall --yes)" >&2
      return 1
    fi
  fi

  local TOOLS=(
    "opencode|opencode|$HOME_DIR/.config/opencode/agents|eri.md|"
    "claude|claude|$HOME_DIR/.claude|CLAUDE.md|"
    "codex|codex|$HOME_DIR/.codex|AGENTS.md|"
    "gemini|gemini|$HOME_DIR/.gemini|GEMINI.md|"
    "qwen|qwen|$HOME_DIR/.qwen|GEMINI.md|"
    "aider|aider|$HOME_DIR/.config/aider|eri.md|aider"
    "cursor|cursor-agent|$HOME_DIR/.cursor|AGENTS.md|"
    "windsurf|windsurf|$HOME_DIR/.windsurf|AGENTS.md|"
    "amp|amp|$HOME_DIR/.amp|AGENTS.md|"
    "goose|goose|$HOME_DIR/.config/goose|AGENTS.md|"
    "copilot|copilot|$HOME_DIR/.github/copilot|AGENTS.md|"
    "plandex|plandex|$HOME_DIR/.plandex|AGENTS.md|"
    "tabby|tabby-agent|$HOME_DIR/.tabby|AGENTS.md|"
    "fabric|fabric|$HOME_DIR/.config/fabric|AGENTS.md|"
    "openhands|openhands|$HOME_DIR/.openhands|AGENTS.md|"
    "crush|crush|$HOME_DIR/.crush|AGENTS.md|"
    "devin|devin|$HOME_DIR/.devin|AGENTS.md|"
    "continue|continue|$HOME_DIR/.continue|AGENTS.md|"
  )

  local entry id cmd pdir pfile mode target
  for entry in "${TOOLS[@]}"; do
    IFS='|' read -r id cmd pdir pfile mode <<< "$entry"
    target="$pdir/$pfile"
    [ -e "$target" ] || [ -e "$target.bak" ] || continue
    if [ -e "$target.bak" ]; then
      if [ -e "$target" ]; then
        stamp="$(date +%Y%m%d-%H%M%S)"
        cp -p "$target" "$target.eri-uninstall-current-$stamp" 2>/dev/null || {
          echo "  警告：未能保存卸载前文件：$target" >&2
        }
      fi
      mv -f "$target.bak" "$target" || { echo "  恢复失败: $target" >&2; continue; }
      echo "  已恢复: $target (来自备份)"
    elif [ -e "$target" ]; then
      stamp="$(date +%Y%m%d-%H%M%S)"
      cp -p "$target" "$target.eri-uninstalled-$stamp" 2>/dev/null || {
        echo "  警告：未能保存卸载前文件：$target；保留原文件不删除。" >&2
        continue
      }
      rm -f "$target"
      echo "  已删除: $target (卸载前副本保留在 .eri-uninstalled-$stamp)"
    fi
  done

  local aider_cfg="$HOME_DIR/.aider.conf.yml"
  local my_aider_path="$HOME_DIR/.config/aider/eri.md"
  local aider_config_restored=0
  if [ -f "$aider_cfg.bak" ]; then
    if [ -f "$aider_cfg" ]; then
      stamp="$(date +%Y%m%d-%H%M%S)"
      cp -p "$aider_cfg" "$aider_cfg.eri-uninstall-current-$stamp" 2>/dev/null || {
        echo "  警告：无法保存卸载前 Aider 配置：$aider_cfg" >&2
      }
    fi
    mv -f "$aider_cfg.bak" "$aider_cfg" || { echo "  恢复 Aider 配置失败: $aider_cfg" >&2; }
    if [ -f "$aider_cfg" ]; then
      aider_config_restored=1
      echo "  已恢复: $aider_cfg (来自备份)"
    fi
  fi
  # 只有没有恢复原始备份时，才清理旧版本遗留的 read 路径。
  if [ "$aider_config_restored" -eq 0 ] && [ -f "$aider_cfg" ]; then
    if grep -qF "$my_aider_path" "$aider_cfg" 2>/dev/null; then
      local tmp1="${aider_cfg}.eri_uninst.$$"
      awk -v p="$my_aider_path" '
        /^[[:space:]]*-[[:space:]]/ && index($0, p) { next }
        /^read:/ {
          line = $0
          sub(/^[[:space:]]*read:[[:space:]]*/, "", line)
          if (line == "") { print; next }
          if (line ~ /^\[.*\][[:space:]]*$/) {
            inner = line
            sub(/^\[/, "", inner); sub(/\][[:space:]]*$/, "", inner)
            n = split(inner, arr, ",")
            out = ""
            for (i = 1; i <= n; i++) {
              t = arr[i]; gsub(/^[[:space:]]+|[[:space:]]+$/, "", t)
              if (t == "" || t == p) continue
              out = (out == "") ? t : out ", " t
            }
            print "read: [" out "]"
            next
          }
          n = split(line, arr, /[[:space:]]+/)
          out = ""
          for (i = 1; i <= n; i++) {
            if (arr[i] == "" || arr[i] == p) continue
            out = (out == "") ? arr[i] : out " " arr[i]
          }
          if (out == "") next
          print "read: " out
          next
        }
        { print }
      ' "$aider_cfg" > "$tmp1" && mv "$tmp1" "$aider_cfg"
      echo "  已清理: $aider_cfg (移除本工具的 read 路径)"
    fi
  fi

  # 恢复备份后再清理一次 default_agent (重复部署会把 eri 配置刷进 .bak), 含尾逗号修正
  local opcfg
  for opcfg in "$HOME_DIR/.config/opencode/opencode.jsonc" "$HOME_DIR/.config/opencode/opencode.json"; do
    if [ -f "$opcfg.bak" ]; then
      if [ -f "$opcfg" ]; then
        stamp="$(date +%Y%m%d-%H%M%S)"
        cp -p "$opcfg" "$opcfg.eri-uninstall-current-$stamp" 2>/dev/null || {
          echo "  警告：无法保存卸载前配置：$opcfg" >&2
        }
      fi
      mv -f "$opcfg.bak" "$opcfg" || { echo "  恢复失败: $opcfg" >&2; continue; }
      echo "  已恢复: $opcfg (来自备份)"
      continue  # 不要再改写恢复后的用户配置
    fi
    [ -f "$opcfg" ] || continue
    if grep -q '"default_agent"[[:space:]]*:[[:space:]]*"eri"' "$opcfg" 2>/dev/null; then
      local tmp2="${opcfg}.eri_uninst.$$"
      awk '
        {
          if ($0 ~ /"default_agent"[[:space:]]*:[[:space:]]*"eri"/) {
            if ($0 ~ /^[[:space:]]*"default_agent"[[:space:]]*:[[:space:]]*"[^"]*"[[:space:]]*,?[[:space:]]*$/) next
            sub(/"default_agent"[[:space:]]*:[[:space:]]*"eri"[[:space:]]*,?/, "")
            sub(/\{[[:space:]]*,/, "{")
            sub(/,[[:space:]]*\}/, "}")
          }
          buf[++n] = $0
        }
        END {
          L = n
          while (L > 0 && buf[L] ~ /^[[:space:]]*$/) L--
          if (L > 1 && buf[L] ~ /^[[:space:]]*}/) {
            j = L - 1
            while (j > 1 && buf[j] ~ /^[[:space:]]*$/) j--
            if (buf[j] ~ /,[[:space:]]*$/) sub(/,[[:space:]]*$/, "", buf[j])
          }
          for (i = 1; i <= n; i++) print buf[i]
        }
      ' "$opcfg" > "$tmp2" && mv "$tmp2" "$opcfg"
      echo "  已清理: $opcfg (移除 default_agent)"
    fi
  done

  local rc
  for rc in \
    "$HOME_DIR/.bashrc" "$HOME_DIR/.bash_profile" "$HOME_DIR/.zshrc" \
    "$HOME_DIR/.profile" "$HOME_DIR/.zprofile" "$HOME_DIR/.kshrc" \
    "$HOME_DIR/.config/fish/config.fish" \
    "$HOME_DIR/.tcshrc" "$HOME_DIR/.cshrc"
  do
    [ -f "$rc" ] || continue
    if grep -qF '# eri-ai-debug: ensure ~/.local/bin in PATH' "$rc" 2>/dev/null; then
      local tmp3="${rc}.eri_uninst.$$"
      awk '
        /^# eri-ai-debug: ensure ~\/\.local\/bin in PATH$/ { getline; next }
        { print }
      ' "$rc" > "$tmp3" && mv "$tmp3" "$rc"
      echo "  已清理 PATH: $rc"
    fi
  done

  if [ -f "$ERI_BIN.bak" ]; then
    rm -f "$ERI_BIN"
    if mv -f "$ERI_BIN.bak" "$ERI_BIN"; then
      echo "  已恢复安装前的 eri-ai-debug 命令: $ERI_BIN"
    else
      echo "  错误：无法恢复原 eri-ai-debug 命令，请手动检查 $ERI_BIN.bak" >&2
      return 1
    fi
  elif [ -f "$ERI_BIN" ]; then
    rm -f "$ERI_BIN"
    echo "  已删除: $ERI_BIN"
  fi

  # 还原安装时被遮蔽(重命名为 *.eri-disabled)的冲突命令
  local bdir state
  bdir="$(dirname "$ERI_BIN")"
  state="$bdir/.eri-ai-debug-disabled.list"
  if [ -f "$state" ]; then
    while IFS= read -r disabled; do
      [ -z "$disabled" ] && continue
      local orig="${disabled%.eri-ai-debug-disabled}"
      if [ -e "$disabled" ] && [ ! -e "$orig" ]; then
        if mv "$disabled" "$orig" 2>/dev/null; then
          echo "  已恢复被遮蔽的命令: $orig"
        else
          echo "  无法恢复(权限不足): $orig"
        fi
      fi
    done < "$state"
    rm -f "$state"
  fi
  [ -d "$bdir" ] && rmdir "$bdir" 2>/dev/null || true

  local deepcfg="$HOME_DIR/.config/opencode"
  if [ -f "$deepcfg/personality.json" ]; then
    echo ""
    echo "  提示: OpenCode 深度集成文件仍保留, 未自动移除:"
    echo "    $deepcfg/personality.json"
    echo "    $deepcfg/skill/eri/  $deepcfg/agent/  $deepcfg/package.json"
    echo "    如需彻底移除, 删除上述文件/目录, 并从 opencode.jsonc 中移除 plugin/skills/agent/command 字段"
  fi

  echo ""
  echo "==> 卸载完成! 新开终端生效♡"
}

sub="${1:-update}"
case "$sub" in
  update) shift ;;
  uninstall|remove|rm)
    shift
    do_uninstall "${1:-}"
    exit $?
    ;;
  version|-v|-V|--version) echo "$ERI_VERSION"; exit 0 ;;
  help|-h|--help) show_help; exit 0 ;;
  *) : ;;
esac

case "$sub" in
  update)  RAW_URL="${1:-${ERI_URL:-$DEFAULT_URL}}" ;;
  http://*|https://*) RAW_URL="$sub" ;;
  *) show_help; exit 0 ;;
esac

if command -v mktemp >/dev/null 2>&1; then
  DL="$(mktemp "${TMPDIR:-/tmp}/eri.XXXXXX" 2>/dev/null)" || DL="${TMPDIR:-/tmp}/eri.$$.md"
else
  DL="${TMPDIR:-/tmp}/eri.$$.md"
fi
(umask 077 && : > "$DL") || { echo "==> 错误：无法创建临时文件：$DL" >&2; exit 1; }
cleanup() { [ -n "${DL:-}" ] && rm -f -- "$DL"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> 下载人格文件: $RAW_URL"
if ! curl -fsSL "$RAW_URL" -o "$DL"; then
  echo "==> 下载失败: $RAW_URL" >&2
  exit 1
fi

# ---------- 安全文件与 JSONC 操作 ----------
# 有原文件时先保留 .bak；若 .bak 已存在，再保存带时间戳的副本。
backup_existing_file() {
  local target backup stamp
  target="${1:-}"
  [ -f "$target" ] || return 0
  if [ ! -e "$target.bak" ]; then
    backup="$target.bak"
  else
    stamp="$(date +%Y%m%d-%H%M%S)-$$"
    backup="$target.eri-backup-$stamp"
  fi
  cp -p "$target" "$backup" || {
    echo "==> 错误：无法备份文件 $target；拒绝覆盖。" >&2
    return 1
  }
  echo "==> 已备份: $backup"
}

copy_with_backup() {
  local src target tmp
  src="${1:-}"
  target="${2:-}"
  [ -f "$src" ] || { echo "==> 错误：源文件不存在：$src" >&2; return 1; }
  mkdir -p "$(dirname "$target")" || return 1
  if [ -L "$target" ]; then
    echo "==> 错误：目标是符号链接，为避免覆盖链接目标，拒绝写入：$target" >&2
    return 1
  fi
  if [ -f "$target" ] && ! cmp -s "$src" "$target"; then
    backup_existing_file "$target" || return 1
  fi
  if [ ! -f "$target" ] || ! cmp -s "$src" "$target"; then
    tmp="${target}.eri-tmp.$$"
    cp "$src" "$tmp" || { rm -f -- "$tmp"; return 1; }
    mv -f "$tmp" "$target" || { rm -f -- "$tmp"; return 1; }
  fi
}

jsonc_parser_available() {
  command -v node >/dev/null 2>&1 || return 1
  ERI_JSONC_MODULE_DIR="__ERI_MODULE_DIR__" node -e '
    const path = require("path");
    const base = process.env.ERI_JSONC_MODULE_DIR;
    const candidates = [];
    if (base) candidates.push(path.join(base, "lib", "jsonc-lite"));
    if (base) candidates.push(path.join(base, "node_modules", "jsonc-parser"));
    candidates.push(path.join("/usr/share/eri-ai-debug", "lib", "jsonc-lite"));
    candidates.push("jsonc-parser");
    for (const candidate of candidates) {
      try { require(candidate); process.exit(0); } catch (_) {}
    }
    process.exit(1);
  ' >/dev/null 2>&1
}

# 只读取 JSONC 根对象中的字符串属性，不用 grep 猜测嵌套字段或注释。
jsonc_get_root_string() {
  local file key
  file="${1:-}"
  key="${2:-}"
  [ -n "$file" ] && [ -f "$file" ] || return 1
  command -v node >/dev/null 2>&1 || return 1
  ERI_JSONC_FILE="$file" ERI_JSONC_KEY="$key" ERI_JSONC_MODULE_DIR="__ERI_MODULE_DIR__" node <<'ERI_JSONC_GET'
const path = require('path');
function loadParser() {
  const candidates = [];
  const base = process.env.ERI_JSONC_MODULE_DIR;
  if (base) candidates.push(path.join(base, 'lib', 'jsonc-lite'));
  if (base) candidates.push(path.join(base, 'node_modules', 'jsonc-parser'));
  candidates.push(path.join('/usr/share/eri-ai-debug', 'lib', 'jsonc-lite'));
  candidates.push('jsonc-parser');
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) {}
  }
  throw new Error('jsonc-parser unavailable');
}
try {
  const { parse } = loadParser();
  const text = require('fs').readFileSync(process.env.ERI_JSONC_FILE, 'utf8');
  const errors = [];
  const root = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !root || typeof root !== 'object' || Array.isArray(root)) process.exit(2);
  const value = root[process.env.ERI_JSONC_KEY];
  if (typeof value === 'string') process.stdout.write(value);
} catch (_) { process.exit(1); }
ERI_JSONC_GET
}

# 只通过 jsonc-parser 修改 JSONC；缺少解析器或配置非法时拒绝写入，绝不回退为正则替换。
jsonc_set_key() {
  local file key val
  file="${1:-}"
  key="${2:-}"
  val="${3:-}"
  [ -n "$file" ] && [ -f "$file" ] || return 1
  command -v node >/dev/null 2>&1 || {
    echo "==> 警告：未找到 Node.js，无法安全修改 $file；请手动合并配置。" >&2
    return 1
  }

  ERI_JSONC_FILE="$file" ERI_JSONC_KEY="$key" ERI_JSONC_VALUE="$val" \
  ERI_JSONC_MODULE_DIR="__ERI_MODULE_DIR__" node <<'ERI_JSONC_NODE'
const fs = require('fs');
const path = require('path');

function loadParser() {
  const candidates = [];
  const base = process.env.ERI_JSONC_MODULE_DIR;
  if (base) candidates.push(path.join(base, 'lib', 'jsonc-lite'));
  if (base) candidates.push(path.join(base, 'node_modules', 'jsonc-parser'));
  candidates.push(path.join('/usr/share/eri-ai-debug', 'lib', 'jsonc-lite'));
  candidates.push('jsonc-parser');
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) { /* try next */ }
  }
  throw new Error('未找到 jsonc-parser。请在仓库目录执行 npm install，或手动修改配置。');
}

let tmp;
try {
  const { parse, modify, applyEdits } = loadParser();
  const file = process.env.ERI_JSONC_FILE;
  const key = process.env.ERI_JSONC_KEY;
  const value = process.env.ERI_JSONC_VALUE;
  const before = fs.readFileSync(file, 'utf8');
  const errors = [];
  const root = parse(before, errors, { allowTrailingComma: true });
  if (errors.length || !root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('配置不是合法的 JSONC 根对象；原文件未修改。');
  }
  const edits = modify(before, [key], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: before.includes('\r\n') ? '\r\n' : '\n' },
  });
  const after = applyEdits(before, edits);
  const errorsAfter = [];
  const rootAfter = parse(after, errorsAfter, { allowTrailingComma: true });
  if (errorsAfter.length || !rootAfter || typeof rootAfter !== 'object' || Array.isArray(rootAfter)) {
    throw new Error('修改结果未通过 JSONC 校验；原文件未修改。');
  }
  if (after === before) process.exit(0);
  const firstBackup = `${file}.bak`;
  const backup = fs.existsSync(firstBackup)
    ? `${file}.eri-backup-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${process.pid}`
    : firstBackup;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  console.error(`==> 已备份: ${backup}`);
  const stat = fs.statSync(file);
  tmp = `${file}.eri-tmp-${process.pid}`;
  fs.writeFileSync(tmp, after, { encoding: 'utf8', mode: stat.mode & 0o777 });
  if (process.platform === 'win32') {
    const old = `${tmp}.old`;
    fs.renameSync(file, old);
    try {
      fs.renameSync(tmp, file);
    } catch (err) {
      if (!fs.existsSync(file) && fs.existsSync(old)) fs.renameSync(old, file);
      throw err;
    }
    fs.rmSync(old, { force: true });
  } else {
    fs.renameSync(tmp, file);
  }
} catch (err) {
  if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch (_) {} }
  console.error(`==> JSONC 修改失败：${err.message}`);
  process.exitCode = 1;
}
ERI_JSONC_NODE
}

enable_tool_config() {
  local id="$1" pdir="$2" pfile="$3"
  case "$id" in
    opencode)
      local opcfg_dir opcfg agent_name
      opcfg_dir="$(dirname "$pdir")"
      opcfg="$opcfg_dir/opencode.jsonc"
      agent_name="${pfile%.md}"
      if [ -f "$opcfg" ]; then
        if jsonc_set_key "$opcfg" "default_agent" "$agent_name"; then
          echo "    OpenCode 配置已更新: $opcfg (default_agent = $agent_name)"
        else
          echo "==> 警告：未能安全修改 OpenCode 配置；请手动设置 default_agent = $agent_name" >&2
        fi
      else
        printf '{\n  "$schema": "https://opencode.ai/config.json",\n  "default_agent": "%s"\n}\n' "$agent_name" > "$opcfg" || return 1
        echo "    OpenCode 配置已创建: $opcfg (default_agent = $agent_name)"
      fi
      ;;
  esac
}

TOOLS=(
  "opencode|opencode|$HOME_DIR/.config/opencode/agents|eri.md|"
  "claude|claude|$HOME_DIR/.claude|CLAUDE.md|"
  "codex|codex|$HOME_DIR/.codex|AGENTS.md|"
  "gemini|gemini|$HOME_DIR/.gemini|GEMINI.md|"
  "qwen|qwen|$HOME_DIR/.qwen|GEMINI.md|"
  "aider|aider|$HOME_DIR/.config/aider|eri.md|aider"
  "cursor|cursor-agent|$HOME_DIR/.cursor|AGENTS.md|"
  "windsurf|windsurf|$HOME_DIR/.windsurf|AGENTS.md|"
  "amp|amp|$HOME_DIR/.amp|AGENTS.md|"
  "goose|goose|$HOME_DIR/.config/goose|AGENTS.md|"
  "copilot|copilot|$HOME_DIR/.github/copilot|AGENTS.md|"
  "plandex|plandex|$HOME_DIR/.plandex|AGENTS.md|"
  "tabby|tabby-agent|$HOME_DIR/.tabby|AGENTS.md|"
  "fabric|fabric|$HOME_DIR/.config/fabric|AGENTS.md|"
  "openhands|openhands|$HOME_DIR/.openhands|AGENTS.md|"
  "crush|crush|$HOME_DIR/.crush|AGENTS.md|"
  "devin|devin|$HOME_DIR/.devin|AGENTS.md|"
  "continue|continue|$HOME_DIR/.continue|AGENTS.md|"
)

count=0
for entry in "${TOOLS[@]}"; do
  IFS='|' read -r id cmd pdir pfile mode <<< "$entry"
  if ! type -P "$cmd" >/dev/null 2>&1; then continue; fi
  copy_with_backup "$DL" "$pdir/$pfile" || continue
  echo "  updated: $pdir/$pfile"

  if [ "$mode" = "aider" ]; then
    cfg="$HOME_DIR/.aider.conf.yml"
    persona_file="$pdir/$pfile"
    if grep -qF "$persona_file" "$cfg" 2>/dev/null; then
      : # 已包含, 不重复追加
    elif [ -f "$cfg" ] && grep -q '^read:[[:space:]]*$' "$cfg"; then
      backup_existing_file "$cfg" || continue
      tmpcfg="${cfg}.tmp.$$"
      awk -v p="$persona_file" '
        /^read:[[:space:]]*$/ && !done { print; print "  - " p; done=1; next }
        { print }
      ' "$cfg" > "$tmpcfg" && mv "$tmpcfg" "$cfg"
    elif [ -f "$cfg" ] && grep -q '^read:' "$cfg"; then
      echo "==> 警告：Aider 的 read 字段不是空列表；为避免破坏 YAML，未自动修改 $cfg。请手动添加：$persona_file" >&2
    elif [ -f "$cfg" ]; then
      backup_existing_file "$cfg" || continue
      printf '\nread: "%s"\n' "$persona_file" >> "$cfg"
    else
      printf 'read: "%s"\n' "$persona_file" > "$cfg"
    fi
  fi

  enable_tool_config "$id" "$pdir" "$pfile"
  count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
  echo "==> 未检测到任何已安装的终端工具, 请先运行 install-eri.sh" >&2
  exit 1
fi
echo "==> 已更新 $count 个工具的人格文件, 重启对应工具生效♡"
ERI_EOF

# 版本单一真源: 取同目录 package.json 的 version 注入生成的 eri
eri_ver="$(grep -m1 -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$SCRIPT_DIR/package.json" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/')"
[ -n "$eri_ver" ] || eri_ver="0.0.0"
eri_tmp="${ERI_BIN}.tmp.$$"
# 将源码目录写入生成的独立命令，确保不依赖全局安装 jsonc-parser。
eri_module_dir="$(printf '%s' "$SCRIPT_DIR" | sed 's/[\\&|]/\\&/g')"
sed -e "s/__ERI_VERSION__/$eri_ver/g" -e "s|__ERI_MODULE_DIR__|$eri_module_dir|g" "$ERI_BIN" > "$eri_tmp" && mv "$eri_tmp" "$ERI_BIN"

chmod +x "$ERI_BIN"
echo "==> 已创建可执行命令: $ERI_BIN"

remove_old_eri_func() {
  local rc="$1"
  [ -f "$rc" ] || return 0
  grep -q '^eri-ai-debug()' "$rc" 2>/dev/null || return 0
  local tmp="${rc}.eri_tmp.$$"
  awk '
    /^# eri-ai-debug persona updater/ { skip=1; next }
    skip && /^\}/ { skip=0; next }
    !skip
  ' "$rc" > "$tmp" && mv "$tmp" "$rc"
  echo "==> 已移除旧的 eri-ai-debug() shell 函数: $rc"
}

for rc in \
  "$HOME_DIR/.bashrc" "$HOME_DIR/.bash_profile" "$HOME_DIR/.zshrc" \
  "$HOME_DIR/.profile" "$HOME_DIR/.zprofile" "$HOME_DIR/.kshrc" \
  "$HOME_DIR/.config/fish/config.fish" \
  "$HOME_DIR/.tcshrc" "$HOME_DIR/.cshrc"
do
  remove_old_eri_func "$rc"
done

ensure_path_posix() {
  local rc="$1" line="$2"
  [ -f "$rc" ] || return 0
  if grep -qF '# eri-ai-debug: ensure ~/.local/bin in PATH' "$rc" 2>/dev/null; then
    return 0
  fi
  printf '\n# eri-ai-debug: ensure ~/.local/bin in PATH\n%s\n' "$line" >> "$rc"
  echo "==> 已添加 PATH 到: $rc"
}

PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
FISH_LINE='fish_add_path $HOME/.local/bin'
TCSH_LINE='setenv PATH "$HOME/.local/bin:$PATH"'

any_rc=0
for rc in \
  "$HOME_DIR/.bashrc" "$HOME_DIR/.bash_profile" "$HOME_DIR/.zshrc" \
  "$HOME_DIR/.profile" "$HOME_DIR/.zprofile" "$HOME_DIR/.kshrc" \
  "$HOME_DIR/.config/fish/config.fish" \
  "$HOME_DIR/.tcshrc" "$HOME_DIR/.cshrc"
do
  [ -f "$rc" ] && any_rc=1
done
[ "$any_rc" -eq 0 ] && : > "$HOME_DIR/.profile"

for rc in \
  "$HOME_DIR/.profile" "$HOME_DIR/.bashrc" "$HOME_DIR/.bash_profile" \
  "$HOME_DIR/.zshrc" "$HOME_DIR/.zprofile" "$HOME_DIR/.kshrc"
do
  ensure_path_posix "$rc" "$PATH_LINE"
done
[ -d "$HOME_DIR/.config/fish" ] && ensure_path_posix "$HOME_DIR/.config/fish/config.fish" "$FISH_LINE"
[ -f "$HOME_DIR/.tcshrc" ] && ensure_path_posix "$HOME_DIR/.tcshrc" "$TCSH_LINE"
[ -f "$HOME_DIR/.cshrc" ]  && ensure_path_posix "$HOME_DIR/.cshrc"  "$TCSH_LINE"

echo "==> 短命令 'eri-ai-debug update' / 'eri-ai-debug uninstall' 已就绪"

conflicts=""
ERI_BIN_DIR="$(dirname "$ERI_BIN")"
IFS=':' read -ra _dirs <<< "$PATH"
for d in "${_dirs[@]}"; do
  [ -n "$d" ] || continue
  for f in "$d/eri-ai-debug" "$d/eri-ai-debug.exe" "$d/eri-ai-debug.cmd" "$d/eri-ai-debug.ps1" "$d/eri-ai-debug.bat"; do
    [ -e "$f" ] || continue
    [ "$f" = "$ERI_BIN" ] && continue
    conflicts="${conflicts}${f}"$'\n'
  done
done

if [ -n "$conflicts" ]; then
  echo ""
  echo "==> 提示：PATH 中还存在其他名为 eri-ai-debug 的命令："
  printf '%s' "$conflicts" | sed 's/^/    - /'
  echo "    安装器不会自动重命名或卸载其他程序，请确认归属后再调整 PATH。"
else
  echo "==> 未检测到其他 eri-ai-debug 命令冲突"
fi

echo ""
echo "==> 验证 'eri-ai-debug' 命令..."
if command -v eri-ai-debug >/dev/null 2>&1; then
  RESOLVED="$(command -v eri-ai-debug)"
  if [ "$RESOLVED" = "$ERI_BIN" ]; then
    echo "    ✓ 'eri-ai-debug' 已正确解析到: $RESOLVED"
    echo "      可以立即执行: eri-ai-debug help / eri-ai-debug update / eri-ai-debug uninstall"
  else
    echo "    ⚠ 'eri-ai-debug' 当前解析到: $RESOLVED (期望 $ERI_BIN)"
    echo "      请执行: hash -r; exec \$SHELL"
  fi
else
  echo "    ⚠ 当前 shell 尚未识别 'eri-ai-debug' 命令"
  echo "      任选其一立即生效:"
  echo "        - 打开新终端窗口"
  echo "        - 执行: export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo "        - 执行: hash -r; exec \$SHELL"
fi