#!/usr/bin/env bash
# Shared path and identity helpers for agent-inbox hooks.

agent_inbox_root() {
  local common_dir
  if [[ -n "${AGENT_INBOX_ROOT:-}" ]]; then
    case "$AGENT_INBOX_ROOT" in
      /*) printf '%s\n' "$AGENT_INBOX_ROOT" ;;
      *) echo 'AGENT_INBOX_ROOT must be an absolute path' >&2; return 1 ;;
    esac
  elif common_dir=$(git rev-parse --git-common-dir 2>/dev/null); then
    # Git returns relative paths from the current directory, not the repo root.
    common_dir=$(cd "$common_dir" && pwd -P) || return 1
    printf '%s/.agents/inbox\n' "$(dirname "$common_dir")"
  else
    printf '%s/.agents/inbox\n' "$PWD"
  fi
}

agent_inbox_name() {
  local agent="${AGENT_INBOX_NAME:-${CLAUDE_SESSION_NAME:-}}"
  case "$agent" in
    '') ;;
    *[!a-z0-9-]*|-*)
      echo 'Inbox name must be a lowercase kebab-case slug' >&2
      return 1 ;;
  esac
  printf '%s\n' "$agent"
}
