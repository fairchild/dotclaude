#!/usr/bin/env bash
# Deploy dotclaude to ~/.claude runtime.
#
# Safe to run anytime — idempotent.
# Used by SessionStart hook (silent on no-op) and manually after merging PRs.
#
# What it does:
#   1. Removes dev symlinks (~/code/dotclaude → ~/.claude/skills/) before pull
#   2. Fetches and fast-forwards ~/.claude to origin/main
#   3. Reports what changed (silent when nothing did)

set -euo pipefail

RUNTIME="$HOME/.claude"
DEV_REPO="$HOME/code/dotclaude"

# --- Preflight ---

if [ ! -d "$RUNTIME/.git" ]; then
  echo "error: $RUNTIME is not a git repo — cannot deploy"
  exit 1
fi

# --- Remove dev symlinks ---

cleaned=()
for link in "$RUNTIME"/skills/*; do
  [ -L "$link" ] || continue
  target=$(readlink "$link")
  if [[ "$target" == *"$DEV_REPO"* ]]; then
    name=$(basename "$link")
    rm "$link"
    cleaned+=("$name")
  fi
done

if [ ${#cleaned[@]} -gt 0 ]; then
  echo "cleaned dev symlinks: ${cleaned[*]}"
fi

# --- Fetch and fast-forward ---

before=$(git -C "$RUNTIME" rev-parse HEAD 2>/dev/null) || exit 0

if ! git -C "$RUNTIME" fetch --quiet origin main 2>/dev/null; then
  # Offline — skip silently
  exit 0
fi

local_main=$(git -C "$RUNTIME" rev-parse HEAD 2>/dev/null)
remote_main=$(git -C "$RUNTIME" rev-parse origin/main 2>/dev/null)

if [ "$local_main" = "$remote_main" ]; then
  # Already up to date — nothing to report
  exit 0
fi

if ! git -C "$RUNTIME" merge --ff-only origin/main --quiet 2>/dev/null; then
  echo "⚠ ~/.claude has local commits that aren't on origin/main — auto-sync skipped"
  echo "  To inspect: git -C ~/.claude log --oneline origin/main..HEAD"
  echo "  To fix: git -C ~/.claude push origin main"
  exit 0
fi

after=$(git -C "$RUNTIME" rev-parse HEAD 2>/dev/null)

if [ "$before" != "$after" ]; then
  count=$(git -C "$RUNTIME" rev-list --count "$before..$after")
  echo "~/.claude synced: ${count} new commit(s)"
  git -C "$RUNTIME" log --oneline "$before..$after"
fi

# --- Detect untracked skills ---

untracked=()
for dir in "$RUNTIME"/skills/*/; do
  [ -f "$dir/SKILL.md" ] || continue
  name=$(basename "$dir")
  git -C "$RUNTIME" check-ignore -q "skills/$name" 2>/dev/null && continue
  git -C "$RUNTIME" ls-files --error-unmatch "$dir/SKILL.md" &>/dev/null && continue
  untracked+=("$name")
done

if [ ${#untracked[@]} -gt 0 ]; then
  echo "${#untracked[@]} untracked skill(s): ${untracked[*]}"
fi
