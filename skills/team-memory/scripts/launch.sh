#!/bin/bash
# Launch Claude Code with a persistent AI teammate personality and memory.
# Usage:
#   launch.sh                        # use active teammate
#   launch.sh --persona bertram      # use specific teammate
#   launch.sh --safe                 # require permission prompts
#   launch.sh --persona bertram ~/code/project
set -euo pipefail

MEMORY_DIR="${AI_MEMORY_DIR:-$HOME/.ai-memory}"
PERSONA=""
SKIP_PERMS="--dangerously-skip-permissions"

is_valid_hex_color() {
  [[ "$1" =~ ^#[0-9A-Fa-f]{6}$ ]]
}

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --persona)
      PERSONA="${2:-}"
      [ -z "$PERSONA" ] && { echo "Error: --persona requires a name"; exit 1; }
      shift 2
      ;;
    --safe)
      SKIP_PERMS=""
      shift
      ;;
    *) break ;;
  esac
done

if [[ -z "$PERSONA" ]] && [[ -L "$MEMORY_DIR/active" ]]; then
  PERSONA=$(basename "$(readlink "$MEMORY_DIR/active")")
fi

if [ -z "$PERSONA" ]; then
  echo "Error: No persona specified and no active teammate set."
  echo "Usage: $0 --persona <name>"
  echo ""
  if [ -d "$MEMORY_DIR" ]; then
    echo "Available teammates:"
    ls -1 "$MEMORY_DIR" 2>/dev/null | grep -v shared | grep -v active || echo "  (none)"
  else
    echo "Run 'team-memory init <name>' to create your first teammate."
  fi
  exit 1
fi

PERSONA_DIR="$MEMORY_DIR/$PERSONA"

if [ ! -d "$PERSONA_DIR" ]; then
  echo "Error: Unknown teammate '$PERSONA'"
  echo "Available:"
  ls -1 "$MEMORY_DIR" 2>/dev/null | grep -v shared | grep -v active || echo "  (none)"
  exit 1
fi

export AI_MEMORY_PERSONA="$PERSONA"
export AI_MEMORY_DIR="$MEMORY_DIR"

# Print entry banner from theme
theme_file="$PERSONA_DIR/theme.json"
if [[ -f "$theme_file" ]] && command -v jq &>/dev/null; then
  icon=$(jq -r '.icon // ""' "$theme_file")
  color=$(jq -r '.color // ""' "$theme_file")
  tagline=$(jq -r '.tagline // ""' "$theme_file")
  if [[ -n "$color" ]] && is_valid_hex_color "$color"; then
    hex="${color#\#}"
    r=$((16#${hex:0:2})); g=$((16#${hex:2:2})); b=$((16#${hex:4:2}))
    C=$(printf '\033[38;2;%d;%d;%dm' "$r" "$g" "$b")
    R='\033[0m'
  else
    C='\033[36m'; R='\033[0m'
  fi
  printf "\n${C}%s %s %s${R}\n\n" "$icon" "$PERSONA" "$tagline"
fi

CLAUDE_ARGS=(--add-dir "$PERSONA_DIR")
[[ -n "$SKIP_PERMS" ]] && CLAUDE_ARGS+=("$SKIP_PERMS")

CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 \
  exec claude "${CLAUDE_ARGS[@]}" "$@"
