#!/usr/bin/env bash
# Release a claimed task back to todo/. Strips claim fields, appends `released`.
# Usage:
#   release.sh [SLUG] --reason="..." [--backlog=PATH] [--commit]
# With no SLUG, looks for a single doing/ task on the current branch.

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

[[ -z "$reason" ]] && { echo "--reason is required" >&2; exit 2; }

BACKLOG=$(find_backlog "$backlog_arg")

if [[ -z "$slug" ]]; then
  branch=$(current_branch)
  matches=()
  for f in "$BACKLOG"/doing/*.md; do
    [[ -f "$f" ]] || continue
    b=$(read_fm_scalar "$f" branch)
    [[ "$b" == "$branch" ]] && matches+=("$f")
  done
  [[ ${#matches[@]} -eq 0 ]] && { echo "no doing/ task on branch '$branch' — pass a slug" >&2; exit 1; }
  [[ ${#matches[@]} -gt 1 ]] && {
    echo "multiple doing/ tasks on branch '$branch' — pass a slug:" >&2
    printf '  %s\n' "${matches[@]}" >&2
    exit 1
  }
  slug=$(slug_of "${matches[0]}")
fi

src="$BACKLOG/doing/${slug}.md"
[[ ! -f "$src" ]] && { echo "no such task in doing/: $slug" >&2; exit 1; }

# Capture the prior claim for the release entry, then strip.
prior_by=$(read_fm_scalar "$src" claimed_by)
prior_branch=$(read_fm_scalar "$src" branch)
fm_clear_scalar "$src" claimed_at
fm_clear_scalar "$src" claimed_by
fm_clear_scalar "$src" branch
fm_clear_scalar "$src" pr

move_in_backlog "$BACKLOG" "$src" "$BACKLOG/todo/${slug}.md"

body="released by ${prior_by:-unknown} (was on ${prior_branch:-no-branch}): ${reason}"
append_block "$BACKLOG/todo/${slug}.md" "released" "$body"

if (( do_commit )); then
  git -C "$BACKLOG" add "todo/${slug}.md"
  git -C "$BACKLOG" commit -m "chore(backlog): release ${slug}" >/dev/null
fi

echo "$BACKLOG/todo/${slug}.md"
