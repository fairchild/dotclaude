#!/usr/bin/env bash
# Deploy dotclaude to ~/.claude runtime.
#
# Safe to run anytime — idempotent.
# Used by SessionStart hook (silent on no-op) and manually after merging PRs.
#
# What it does:
#   1. Removes dev symlinks (~/code/dotclaude → ~/.claude/skills/) before pull
#   2. Guards ~/.claude against commits and reports changes made there in place
#   3. Fetches and fast-forwards ~/.claude to origin/main
#   4. Reports what changed (silent when nothing did)

set -euo pipefail

RUNTIME="$HOME/.claude"
DEV_REPO="$HOME/code/dotclaude"
LOG="$RUNTIME/deploy.log"

# --- Logging: tee all output to deploy.log with timestamps ---
# Rotate if > 100 KB
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 102400 ] && mv "$LOG" "$LOG.1"
exec > >(while IFS= read -r line; do printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$line"; done | tee -a "$LOG") 2>&1

# --- Preflight ---

if [ ! -d "$RUNTIME/.git" ]; then
  echo "session start: $RUNTIME is not a git repo — cannot deploy"
  exit 1
fi

echo "session start: HEAD=$(git -C "$RUNTIME" rev-parse --short HEAD)"

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

# --- Guard: ~/.claude is deploy-only ---
# A local commit leaves HEAD ahead of origin/main, where `merge --ff-only`
# succeeds as a no-op, so nothing below would ever notice it.

guard=$(git -C "$RUNTIME" rev-parse --git-path hooks/pre-commit 2>/dev/null) || guard=".git/hooks/pre-commit"
[[ "$guard" = /* ]] || guard="$RUNTIME/$guard"
if [ ! -e "$guard" ]; then
  {
    mkdir -p "$(dirname "$guard")"
    printf '#!/bin/sh\n# Installed by scripts/deploy.sh\necho "~/.claude is deploy-only; commit in ~/code/dotclaude" >&2\nexit 1\n' > "$guard"
    chmod +x "$guard"
  } 2>/dev/null || true
fi

ahead=$(git -C "$RUNTIME" rev-list --count origin/main..HEAD 2>/dev/null) || ahead=0
if [ "$ahead" -gt 0 ]; then
  echo "⚠ ~/.claude has ${ahead} local commit(s) not on origin/main: $(git -C "$RUNTIME" log --format=%h origin/main..HEAD | paste -sd' ' -)"
fi

edited=$(git -C "$RUNTIME" diff --name-only HEAD 2>/dev/null | paste -sd' ' -) || edited=""
if [ -n "$edited" ]; then
  echo "⚠ ~/.claude has tracked files edited in place: ${edited}"
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

if ! merge_err=$(git -C "$RUNTIME" merge --ff-only origin/main --quiet 2>&1); then
  echo "⚠ ~/.claude could not fast-forward to origin/main — auto-sync skipped"
  # git already names the exact blocking path; a guess here sends people the wrong way.
  [ -n "$merge_err" ] && printf '%s\n' "$merge_err" | sed 's/^/  /'
  echo "  Resolve the above, then: ~/.claude/scripts/deploy.sh"
  echo "  Runtime drift worth keeping gets codified via a PR from ~/code/dotclaude."
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
