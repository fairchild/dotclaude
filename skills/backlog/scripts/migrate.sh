#!/usr/bin/env bash
# One-time migration from flat backlog/*.md layout to maildir todo/doing/done/{YYYY}/.
#   - Pending items at backlog/*.md → backlog/todo/*.md
#   - Items at backlog/done/*.md → backlog/done/{year-from-git-log}/*.md
#   - Leaves AGENTS.md, CLAUDE.md, ROADMAP.md in place
# Usage: migrate.sh [--backlog=PATH] [--dry-run]

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

backlog_arg=""
dry=0
for arg in "$@"; do
  case "$arg" in
    --backlog=*) backlog_arg="${arg#*=}" ;;
    --dry-run)   dry=1 ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) backlog_arg="$arg" ;;
  esac
done

BACKLOG=$(find_backlog "$backlog_arg")
echo "migrating: $BACKLOG"

# Use git mv when possible; preserves history.
is_git=0
git -C "$BACKLOG" rev-parse --git-dir >/dev/null 2>&1 && is_git=1

mv_op() {
  local from="$1" to="$2"
  if (( dry )); then
    echo "  would move: ${from#$BACKLOG/} → ${to#$BACKLOG/}"
    return
  fi
  move_in_backlog "$BACKLOG" "$from" "$to"
  echo "  moved: ${from#$BACKLOG/} → ${to#$BACKLOG/}"
}

mkdir -p "$BACKLOG/todo" "$BACKLOG/doing" "$BACKLOG/done"

# ---- Pass 1: flat pending items → todo/ ---------------------------------

echo ""
echo "## flat → todo/"
for f in "$BACKLOG"/*.md; do
  [[ -f "$f" ]] || continue
  base=$(basename "$f")
  case "$base" in
    AGENTS.md|CLAUDE.md|ROADMAP.md) continue ;;
  esac
  mv_op "$f" "$BACKLOG/todo/$base"
done

# ---- Pass 2: backlog/done/*.md → backlog/done/{year}/ -------------------

echo ""
echo "## done/ → done/{year}/"
if [[ -d "$BACKLOG/done" ]]; then
  for f in "$BACKLOG"/done/*.md; do
    [[ -f "$f" ]] || continue
    base=$(basename "$f")
    # Derive year from last git commit touching the file; fall back to file mtime; final fallback is current year.
    year=""
    if (( is_git )); then
      year=$(git -C "$BACKLOG" log -1 --format=%cs -- "done/$base" 2>/dev/null | cut -d- -f1)
    fi
    if [[ -z "$year" ]]; then
      year=$(stat -f %Sm -t %Y "$f" 2>/dev/null || stat -c %y "$f" 2>/dev/null | cut -d- -f1 || true)
    fi
    [[ -z "$year" ]] && year=$(year_now)
    mv_op "$f" "$BACKLOG/done/$year/$base"
  done
fi

echo ""
if (( dry )); then
  echo "dry run complete — re-run without --dry-run to apply"
else
  echo "migration complete. Review with: ~/.claude/skills/backlog/scripts/status.sh"
fi
