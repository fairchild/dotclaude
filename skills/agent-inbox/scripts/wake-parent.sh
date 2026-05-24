#!/usr/bin/env bash
# Wake a parent agent via cmux after writing to their inbox.
#
# Usage:
#   wake-parent.sh --surface <cmux-surface-ref> [--inbox-path <path>] [--agent <name>]
#
# Logic:
#   1. Read the target surface screen to detect state
#   2. Active claude session → no-op (stop hook picks up inbox naturally)
#   3. Idle shell prompt → spawn headless claude session
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

# Detect state from screen content.
# These heuristics match Claude Code's current TUI chrome — they may need updating
# if the UI changes significantly.
is_active=false
is_idle=false

if echo "$screen" | grep -qiE '(Claude Code|Harmonizing|claude-code|thinking|Plan:|───)'; then
  is_active=true
elif echo "$screen" | grep -qE '(❯|➜|\$\s*$|%\s*$)'; then
  is_idle=true
fi

if $is_active; then
  # Don't inject keystrokes into an active session — that disrupts mid-prompt input.
  # The message is already in the inbox (caller wrote it before invoking us).
  # The check-inbox-hook (Stop hook) will surface it on the parent's next turn.
  echo "Active session on $surface — stop hook will surface inbox on next turn"

elif $is_idle; then
  # Resolve inbox root via git-common-dir (shared across worktrees), fall back to cwd.
  if common=$(git rev-parse --git-common-dir 2>/dev/null); then
    inbox_root="$(cd "$(dirname "$common")" && pwd)/.agents/inbox"
  else
    inbox_root="$PWD/.agents/inbox"
  fi

  if [[ -n "$inbox_path" ]]; then
    inbox_hint="Check your inbox at ${inbox_path} and process the messages."
  else
    inbox_hint="Check your inbox at ${inbox_root}/${agent}/new/ and process the messages."
  fi

  # NOTE: --dangerously-skip-permissions is used here because the spawned session is
  # headless (no human at the terminal to approve). This is the current pragmatic
  # approach for agent-to-agent wake. A future alternative could use a permissions
  # profile or allowlist flag if Claude Code adds one.
  cmd="echo '${inbox_hint}' | claude -p -n ${agent} --add-dir ${inbox_root} --dangerously-skip-permissions"
  cmux send --surface "$surface" "$cmd"
  cmux send-key --surface "$surface" Enter
  echo "Spawned new session on idle $surface for agent '$agent'"

else
  echo "Warning: could not determine state of $surface — screen content unrecognized" >&2
  echo "Hint: update detection patterns in wake-parent.sh if Claude Code UI has changed" >&2
  # Exit 0: the message is already in the inbox. Wake is best-effort.
fi
