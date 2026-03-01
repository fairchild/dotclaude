#!/usr/bin/env bash
set -euo pipefail

AI_MEMORY_HOME="${AI_MEMORY_HOME:-$HOME/.ai-memory}"
AI_MEMORY_PROFILE="${AI_MEMORY_PROFILE:-default}"
AI_MEMORY_MAX_CONTEXT="${AI_MEMORY_MAX_CONTEXT:-2200}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
AI_MEMORY_NOW="${AI_MEMORY_NOW:-}"

passthrough_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --memory-home)
      if [[ $# -lt 2 ]]; then
        echo "persona-memory: --memory-home requires a value" >&2
        exit 1
      fi
      AI_MEMORY_HOME="$2"
      shift 2
      ;;
    --now)
      if [[ $# -lt 2 ]]; then
        echo "persona-memory: --now requires a value" >&2
        exit 1
      fi
      AI_MEMORY_NOW="$2"
      shift 2
      ;;
    --profile)
      if [[ $# -lt 2 ]]; then
        echo "persona-memory: --profile requires a value" >&2
        exit 1
      fi
      AI_MEMORY_PROFILE="$2"
      shift 2
      ;;
    *)
      passthrough_args+=("$1")
      shift
      ;;
  esac
done

export AI_MEMORY_HOME
export AI_MEMORY_PROFILE
if [[ -n "${AI_MEMORY_NOW}" ]]; then
  export AI_MEMORY_NOW
fi

resolve_skill_dir() {
  if [[ -n "${AI_MEMORY_SKILL_DIR:-}" && -d "${AI_MEMORY_SKILL_DIR}" ]]; then
    echo "${AI_MEMORY_SKILL_DIR}"
    return 0
  fi

  local source_dir
  source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${source_dir}/recall.ts" ]]; then
    echo "$(cd "${source_dir}/.." && pwd)"
    return 0
  fi

  local candidates=(
    "$HOME/.claude/skills/persona-memory"
    "$HOME/.agents/skills/persona-memory"
    "$HOME/.codex/skills/persona-memory"
  )

  local path
  for path in "${candidates[@]}"; do
    if [[ -f "${path}/scripts/recall.ts" ]]; then
      echo "${path}"
      return 0
    fi
  done

  return 1
}

if ! command -v "${CLAUDE_BIN}" >/dev/null 2>&1; then
  echo "persona-memory: '${CLAUDE_BIN}' not found in PATH" >&2
  exit 1
fi

skill_dir="$(resolve_skill_dir || true)"
scripts_dir=""
if [[ -n "${skill_dir}" ]]; then
  scripts_dir="${skill_dir}/scripts"
fi

personality_file="${AI_MEMORY_HOME}/profiles/${AI_MEMORY_PROFILE}/personality.md"
personality_text=""
if [[ -f "${personality_file}" ]]; then
  personality_text="$(cat "${personality_file}")"
else
  echo "persona-memory: warning - personality file missing at ${personality_file}" >&2
fi

memory_context=""
if [[ -n "${scripts_dir}" && -f "${scripts_dir}/recall.ts" ]]; then
  if command -v bun >/dev/null 2>&1; then
    recall_cmd=(bun "${scripts_dir}/recall.ts" --memory-home "${AI_MEMORY_HOME}" --profile "${AI_MEMORY_PROFILE}" --cwd "$PWD" --format prompt --max-chars "${AI_MEMORY_MAX_CONTEXT}")
    if [[ -n "${AI_MEMORY_NOW}" ]]; then
      recall_cmd+=(--now "${AI_MEMORY_NOW}")
    fi
    memory_context="$("${recall_cmd[@]}" 2>/dev/null || true)"
  else
    echo "persona-memory: warning - bun not found, skipping recall context" >&2
  fi
fi

appended_prompt="${personality_text}"
if [[ -n "${memory_context}" ]]; then
  if [[ -n "${appended_prompt}" ]]; then
    appended_prompt="${appended_prompt}

---

${memory_context}"
  else
    appended_prompt="${memory_context}"
  fi
fi

cmd=("${CLAUDE_BIN}" "--add-dir" "${AI_MEMORY_HOME}")
if [[ -n "${appended_prompt}" ]]; then
  cmd+=("--append-system-prompt" "${appended_prompt}")
fi
cmd+=("${passthrough_args[@]}")

exec "${cmd[@]}"
