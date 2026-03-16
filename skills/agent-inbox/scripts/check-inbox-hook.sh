#!/usr/bin/env bash
# Stop hook: notify agent of unread inbox messages.
# Finds repo root via git, scans .agents/inbox/*/new/. Silent when empty.

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
count=$(find "$root/.agents/inbox"/*/new -name '*.md' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
[[ "$count" -eq 0 ]] && exit 0

echo "📬 ${count} unread in .agents/inbox/ — cat to read, mv to archive/ when done"
