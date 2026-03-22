#!/usr/bin/env bash
# SessionStart hook: deploy latest main to ~/.claude.
# Delegates to scripts/deploy.sh — must never block session start.
exec ~/.claude/scripts/deploy.sh 2>/dev/null || true
