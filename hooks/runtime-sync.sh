#!/usr/bin/env bash
# Sync runtime worktree with latest main.
# Runs first in SessionStart — must never block.
# Errors silenced so offline sessions start normally.

before=$(git -C ~/.claude rev-parse HEAD 2>/dev/null) || exit 0
if ! git -C ~/.claude merge main --ff-only --quiet 2>/dev/null; then
  echo "⚠ ~/.claude runtime has diverged from main — auto-sync skipped"
  echo "  Fix with: git -C ~/.claude reset --hard main"
  exit 0
fi
after=$(git -C ~/.claude rev-parse HEAD 2>/dev/null)

if [[ "$before" != "$after" ]]; then
  count=$(git -C ~/.claude rev-list --count "$before..$after")
  echo "~/.claude synced: ${count} new commit(s)"
  git -C ~/.claude log --oneline "$before..$after"
fi
