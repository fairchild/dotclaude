#!/usr/bin/env bash
# Wake a parent agent via cmux after writing to their inbox.
#
# Usage:
#   wake-parent.sh --surface <cmux-surface-ref> [--inbox-path <path>] [--agent <name>]
#
# Logic:
#   1. Read the target surface screen to detect state
#   2. Active claude session → send notification hint
#   3. Idle shell prompt → optionally spawn new claude session
#   4. Surface doesn't exist → warn and exit

set -euo pipefail

surface=""
inbox_path=""
agent="orchestrator"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --surface)  surface="$2"; shift 2 ;;
    --inbox-path) inbox_path="$2"; shift 2 ;;
    --agent)    agent="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: wake-parent.sh --surface <ref> [--inbox-path <path>] [--agent <name>]"
      echo ""
      echo "Options:"
      echo "  --surface     cmux surface ref (e.g., surface:167)"
      echo "  --inbox-path  path to check for messages (auto-detected if omitted)"
      echo "  --agent       agent name for spawned session (default: orchestrator)"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$surface" ]]; then
  echo "Error: --surface is required" >&2
  exit 1
fi

# Validate surface exists via cmux tree
if ! cmux tree --all 2>/dev/null | grep -q "$surface"; then
  echo "Warning: surface $surface not found (workspace may be closed)" >&2
  exit 1
fi

# Read the screen to detect state
screen=$(cmux read-screen --surface "$surface" --lines 30 2>&1) || {
  echo "Warning: surface $surface not accessible" >&2
  exit 1
}

# Detect state from screen content
is_active=false
is_idle=false

# Active claude session patterns
if echo "$screen" | grep -qiE '(Claude Code|Harmonizing|claude-code|thinking|Plan:|───)'; then
  is_active=true
# Idle shell prompt patterns
elif echo "$screen" | grep -qE '(❯|➜|\$\s*$|%\s*$)'; then
  is_idle=true
fi

if $is_active; then
  # Send a notification hint to the active session
  cmux send --surface "$surface" ""
  cmux send-key --surface "$surface" Enter
  # The text will appear as input — the agent's stop hook will pick up the inbox
  echo "Notified active session on $surface"

elif $is_idle; then
  # Build the inbox check command
  inbox_hint=""
  if [[ -n "$inbox_path" ]]; then
    inbox_hint="Check your inbox at ${inbox_path} and process the messages."
  else
    inbox_hint="Check your inbox at .agents/inbox/${agent}/new/ and process the messages."
  fi

  cmd="echo '${inbox_hint}' | claude -p -n ${agent} --add-dir .agents/inbox --dangerously-skip-permissions"
  cmux send --surface "$surface" "$cmd"
  cmux send-key --surface "$surface" Enter
  echo "Spawned new session on idle $surface for agent '$agent'"

else
  echo "Warning: could not determine state of $surface — screen content unrecognized" >&2
  # Still try sending a notification as a fallback
  cmux send --surface "$surface" "# 📬 New message in your inbox"
  cmux send-key --surface "$surface" Enter
  echo "Sent fallback notification to $surface"
fi
