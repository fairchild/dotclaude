#!/bin/bash
# Launch Claude Code with a persistent AI teammate personality and memory.
# Usage:
#   launch.sh                        # use active teammate
#   launch.sh --persona bertram      # use specific teammate
#   launch.sh --persona bertram ~/code/project  # teammate + project dir
set -euo pipefail

MEMORY_DIR="${AI_MEMORY_DIR:-$HOME/.ai-memory}"
PERSONA=""

# Parse --persona flag
if [[ "${1:-}" == "--persona" ]]; then
  PERSONA="${2:-}"
  [ -z "$PERSONA" ] && { echo "Error: --persona requires a name"; exit 1; }
  shift 2
elif [[ -L "$MEMORY_DIR/active" ]]; then
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
CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 \
  exec claude --add-dir "$PERSONA_DIR" "$@"
