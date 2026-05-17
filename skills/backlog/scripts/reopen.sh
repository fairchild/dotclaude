#!/usr/bin/env bash
# Reopen a done task: move from done/** back to todo/, strip claim, append `reopened`.
# Usage:
#   reopen.sh SLUG [--reason="..."] [--backlog=PATH] [--commit]

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

slug=""
reason=""
backlog_arg=""
do_commit=0

for arg in "$@"; do
  case "$arg" in
    --reason=*)  reason="${arg#*=}" ;;
    --backlog=*) backlog_arg="${arg#*=}" ;;
    --commit)    do_commit=1 ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) slug="$arg" ;;
  esac
done

[[ -z "$slug" ]] && { echo "usage: reopen.sh SLUG [--reason=...]" >&2; exit 2; }
[[ -z "$reason" ]] && { echo "--reason is required" >&2; exit 2; }

BACKLOG=$(find_backlog "$backlog_arg")

src=$(resolve_slug "$BACKLOG" "$slug")
if [[ "$(pile_of "$src")" != "done" ]]; then
  echo "not in done/: $src" >&2
  exit 1
fi

dst="$BACKLOG/todo/${slug}.md"
[[ -e "$dst" ]] && { echo "todo/${slug}.md already exists" >&2; exit 1; }

# Strip claim fields so the next take.sh starts clean.
fm_clear_scalar "$src" claimed_at
fm_clear_scalar "$src" claimed_by
fm_clear_scalar "$src" branch
fm_clear_scalar "$src" pr

rel_dst="${dst#$BACKLOG/}"
move_in_backlog "$BACKLOG" "$src" "$dst"

append_block "$dst" "reopened" "$reason"

if (( do_commit )); then
  git -C "$BACKLOG" add "$rel_dst"
  git -C "$BACKLOG" commit -m "chore(backlog): reopen ${slug}" >/dev/null
fi

echo "$dst"
