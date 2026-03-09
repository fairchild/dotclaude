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

# Detect untracked ecosystem skills (respects .gitignore)
untracked=()
for dir in ~/.claude/skills/*/; do
  [[ -f "$dir/SKILL.md" ]] || continue
  name=$(basename "$dir")
  # Skip if git-ignored (managed by dotagents.toml) or already tracked
  git -C ~/.claude check-ignore -q "skills/$name" 2>/dev/null && continue
  git -C ~/.claude ls-files --error-unmatch "$dir/SKILL.md" &>/dev/null && continue
  untracked+=("$name")
done
if [[ ${#untracked[@]} -gt 0 ]]; then
  echo "${#untracked[@]} untracked skill(s): ${untracked[*]}"
  echo "  To track: copy to ~/code/dotclaude/skills/ and commit"
  echo "  To manage via manifest: add to dotagents.toml and .gitignore"
fi
