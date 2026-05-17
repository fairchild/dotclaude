#!/usr/bin/env bash
# Show what's in todo/, doing/, and done/{YYYY}/.
# Usage: status.sh [--backlog=PATH] [--brief]

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

backlog_arg=""
brief=0
for arg in "$@"; do
  case "$arg" in
    --backlog=*) backlog_arg="${arg#*=}" ;;
    --brief)     brief=1 ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) backlog_arg="$arg" ;;
  esac
done

BACKLOG=$(find_backlog "$backlog_arg")

category_of() {
  case "$1" in
    *-plan.md) echo plan ;;
    *-followup.md) echo followup ;;
    *-task-list.md) echo task-list ;;
    *-ideas.md) echo ideas ;;
    *) echo "-" ;;
  esac
}

print_pile() {
  local pile="$1"; shift
  local dir="$1"
  [[ ! -d "$dir" ]] && return 0

  local count
  count=$(find "$dir" -maxdepth 1 -type f -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
  echo ""
  printf "## %s (%d)\n" "$pile" "$count"
  [[ "$count" -eq 0 ]] && return 0
  echo ""
  printf "  %-4s %-40s %-10s %-22s %s\n" "PRI" "SLUG" "CAT" "EXTRA" "TOPIC"
  for f in "$dir"/*.md; do
    [[ -f "$f" ]] || continue
    local base slug cat prio topic extra
    base=$(basename "$f")
    slug="${base%.md}"
    cat=$(category_of "$base")
    prio=$(read_fm_scalar "$f" priority); [[ -z "$prio" ]] && prio="-"
    topic=$(read_fm_scalar "$f" topic);   [[ -z "$topic" ]] && topic="-"
    case "$pile" in
      doing)
        local cb br
        cb=$(read_fm_scalar "$f" claimed_by)
        br=$(read_fm_scalar "$f" branch)
        extra="${cb:-?}@${br:-?}"
        ;;
      todo)
        local deps
        deps=$(read_fm_dep_slugs "$f" | wc -l | tr -d ' ')
        if [[ "$deps" -gt 0 ]]; then extra="deps:$deps"; else extra=""; fi
        ;;
      *)
        extra=""
        ;;
    esac
    printf "  %-4s %-40s %-10s %-22s %s\n" "$prio" "$slug" "$cat" "$extra" "$topic"
  done
}

print_pile todo  "$BACKLOG/todo"
print_pile doing "$BACKLOG/doing"

if (( ! brief )); then
  # done is recursive (year subdirs, plus optional finer dirs and cancelled/)
  echo ""
  local_done_count=$(find "$BACKLOG/done" -type f -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
  printf "## done (%d total)\n" "$local_done_count"
  if [[ -d "$BACKLOG/done" ]]; then
    for year_dir in "$BACKLOG"/done/*/; do
      [[ -d "$year_dir" ]] || continue
      local_year=$(basename "$year_dir")
      local_year_count=$(find "$year_dir" -type f -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
      printf "  %s  (%d)\n" "$local_year" "$local_year_count"
    done
  fi
fi
