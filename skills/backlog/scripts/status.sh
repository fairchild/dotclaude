#!/usr/bin/env bash
set -euo pipefail

# Parse YAML frontmatter from backlog/*.md files
# Usage: ~/.claude/skills/backlog/scripts/status.sh [path/to/backlog]
#
# Frontmatter is optional - files without it default to:
#   status: pending, category: (from filename or unknown)

backlog_dir="${1:-backlog}"

if [[ ! -d "$backlog_dir" ]]; then
  echo "No backlog/ directory found at: $backlog_dir"
  exit 1
fi

echo "| File                                | Category   | Thread                | Status      | PR  | Modified   |"
echo "|-------------------------------------|------------|----------------------|-------------|-----|------------|"

for f in "$backlog_dir"/*.md; do
  [[ "$(basename "$f")" == "AGENTS.md" ]] && continue
  [[ ! -f "$f" ]] && continue
  [[ ! -r "$f" ]] && continue

  name=$(basename "$f")

  # Check if file starts with frontmatter delimiter
  first_line=$(head -1 "$f" 2>/dev/null)
  if [[ "$first_line" == "---" ]]; then
    fm=$(sed -n '2,/^---$/p' "$f" 2>/dev/null | sed '$d')
    status=$(echo "$fm" | grep '^status:' | cut -d: -f2 | tr -d ' ')
    category=$(echo "$fm" | grep '^category:' | cut -d: -f2 | tr -d ' ')
    thread=$(echo "$fm" | grep '^thread:' | cut -d: -f2 | tr -d ' ')
    pr=$(echo "$fm" | grep '^pr:' | cut -d: -f2 | tr -d ' ')
  else
    status=""
    category=""
    thread=""
    pr=""
  fi

  # Defaults for missing values
  [[ -z "$status" ]] && status="pending"

  # Infer category from filename pattern if missing
  if [[ -z "$category" ]]; then
    case "$name" in
      *-plan.md) category="plan" ;;
      *-followup.md) category="followup" ;;
      *-task-list.md|*_todo.md) category="task-list" ;;
      *-ideas.md) category="ideas" ;;
      *) category="unknown" ;;
    esac
  fi

  [[ "$thread" == "null" || -z "$thread" ]] && thread="-"
  [[ "$pr" == "null" || -z "$pr" ]] && pr="-"

  # Get last modified date from git (or filesystem fallback)
  modified=$(git log -1 --format=%cs -- "$f" 2>/dev/null)
  [[ -z "$modified" ]] && modified=$(stat -f %Sm -t %Y-%m-%d "$f" 2>/dev/null || echo "?")

  printf "| %-35s | %-10s | %-20s | %-11s | %-3s | %-10s |\n" \
    "$name" "$category" "$thread" "$status" "$pr" "$modified"
done | sort -t'|' -k6 -r

echo ""
done_count=$(ls "$backlog_dir"/done/*.md 2>/dev/null | grep -cv AGENTS.md || echo 0)
echo "Done: $done_count files in $backlog_dir/done/"

# Show git creation dates for context
echo ""
echo "## Provenance (git creation dates)"
for f in "$backlog_dir"/*.md; do
  [[ "$(basename "$f")" == "AGENTS.md" ]] && continue
  [[ ! -f "$f" ]] && continue
  created=$(git log --diff-filter=A --format=%cs -- "$f" 2>/dev/null | tail -1)
  [[ -n "$created" ]] && printf "  %-35s created %s\n" "$(basename "$f")" "$created"
done
