#!/usr/bin/env bash
# Stop hook: notify agent of unread inbox messages.
# Resolves inbox via git-common-dir (shared across worktrees), falls back to cwd when not in a repo.
# Scans .agents/inbox/*/new/. Silent when empty.

if common=$(git rev-parse --git-common-dir 2>/dev/null); then
  inbox_root="$(cd "$(dirname "$common")" && pwd)/.agents/inbox"
else
  inbox_root="$PWD/.agents/inbox"
fi
count=$(find "$inbox_root"/*/new -name '*.md' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
[[ "$count" -eq 0 ]] && exit 0

echo "📬 ${count} unread in ${inbox_root}/ — cat to read, mv to archive/ when done"
