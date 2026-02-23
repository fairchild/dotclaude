#!/usr/bin/env bash
set -euo pipefail

# Summarize backlog items using kebab-case suffix categories.
# Usage: ~/.claude/skills/backlog/scripts/status.sh [path/to/backlog]
#
# Conventions:
# - Category from filename suffix: -plan, -followup, -task-list, -ideas
# - Status from location: backlog/ = pending, backlog/done/ = done
# - Frontmatter optional; only reads topic/priority when present

backlog_dir="${1:-backlog}"

if [[ ! -d "$backlog_dir" ]]; then
  echo "No backlog/ directory found at: $backlog_dir"
  exit 1
fi

category_from_name() {
  local name="$1"
  case "$name" in
    *-plan.md) echo "plan" ;;
    *-followup.md) echo "followup" ;;
    *-task-list.md) echo "task-list" ;;
    *-ideas.md) echo "ideas" ;;
    *) echo "unknown" ;;
  esac
}

fm_value() {
  local file="$1"
  local key="$2"

  local first_line
  first_line=$(head -1 "$file" 2>/dev/null || true)
  [[ "$first_line" != "---" ]] && return 0

  sed -n '2,/^---$/p' "$file" 2>/dev/null \
    | sed '$d' \
    | grep -E "^${key}:" \
    | head -1 \
    | cut -d: -f2- \
    | sed 's/^ *//; s/ *$//' || true
}

print_rows() {
  local dir="$1"
  local status="$2"

  for f in "$dir"/*.md; do
    [[ ! -f "$f" ]] && continue

    local base
    base=$(basename "$f")
    [[ "$base" == "AGENTS.md" || "$base" == "CLAUDE.md" || "$base" == "ROADMAP.md" ]] && continue

    local category topic priority modified
    category=$(category_from_name "$base")
    topic=$(fm_value "$f" "topic")
    priority=$(fm_value "$f" "priority")
    [[ -z "$topic" ]] && topic="-"
    [[ -z "$priority" ]] && priority="-"

    modified=$(git log -1 --format=%cs -- "$f" 2>/dev/null || true)
    [[ -z "$modified" ]] && modified=$(stat -f %Sm -t %Y-%m-%d "$f" 2>/dev/null || echo "?")

    printf "%s| %-35s | %-10s | %-8s | %-8s | %-18s |\n" \
      "$modified" "$base" "$category" "$status" "$priority" "$topic"
  done
}

echo "| File                                | Category   | Status   | Priority | Topic              |"
echo "|-------------------------------------|------------|----------|----------|--------------------|"
{
  print_rows "$backlog_dir" "pending"
  if [[ -d "$backlog_dir/done" ]]; then
    print_rows "$backlog_dir/done" "done"
  fi
} | sort -r | cut -d'|' -f2-

echo ""
pending_count=$(find "$backlog_dir" -maxdepth 1 -name "*.md" ! -name "AGENTS.md" ! -name "CLAUDE.md" ! -name "ROADMAP.md" | wc -l | tr -d ' ')
done_count=0
if [[ -d "$backlog_dir/done" ]]; then
  done_count=$(find "$backlog_dir/done" -maxdepth 1 -name "*.md" ! -name "AGENTS.md" ! -name "CLAUDE.md" ! -name "ROADMAP.md" | wc -l | tr -d ' ')
fi

echo "Pending: $pending_count"
echo "Done: $done_count"
