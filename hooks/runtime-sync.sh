#!/usr/bin/env bash
# Sync runtime worktree with latest main.
# Runs first in SessionStart — must never block.
# Errors silenced so offline sessions start normally.

git -C ~/.claude merge main --ff-only --quiet 2>/dev/null
exit 0
