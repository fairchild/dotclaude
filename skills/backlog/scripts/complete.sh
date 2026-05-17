#!/usr/bin/env bash
# Mark a task complete: git mv doing/X.md → done/{YYYY}/X.md, append `completed`.
# Usage:
#   complete.sh [SLUG] [--pr=URL_OR_NUM] [--note="..."] [--backlog=PATH] [--commit]
# If SLUG omitted: only works when exactly one file is in doing/ on this branch.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

slug=""
pr_arg=""
note=""
backlog_arg=""
do_commit=0

for arg in "$@"; do
  case "$arg" in
    --pr=*)      pr_arg="${arg#*=}" ;;
    --note=*)    note="${arg#*=}" ;;
    --backlog=*) backlog_arg="${arg#*=}" ;;
    --commit)    do_commit=1 ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) slug="$arg" ;;
  esac
done

BACKLOG=$(find_backlog "$backlog_arg")

# ---- Find the file -------------------------------------------------------

if [[ -z "$slug" ]]; then
  branch=$(current_branch)
  matches=()
  for f in "$BACKLOG"/doing/*.md; do
    [[ -f "$f" ]] || continue
    b=$(read_fm_scalar "$f" branch)
    if [[ "$b" == "$branch" ]]; then
      matches+=("$f")
    fi
  done
  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "no doing/ task on branch '$branch' — pass a slug explicitly" >&2
    exit 1
  fi
  if [[ ${#matches[@]} -gt 1 ]]; then
    echo "multiple doing/ tasks on branch '$branch' — pass a slug:" >&2
    printf '  %s\n' "${matches[@]}" >&2
    exit 1
  fi
  slug=$(slug_of "${matches[0]}")
fi

src="$BACKLOG/doing/${slug}.md"
if [[ ! -f "$src" ]]; then
  echo "no such task in doing/: $slug" >&2
  exit 1
fi

# ---- Pick destination directory (year, respecting finer subdirs) ---------

year=$(year_now)
year_dir="$BACKLOG/done/${year}"
mkdir -p "$year_dir"

# If a finer subdir exists for the current period, use it. Heuristic:
# look for QN matching the current quarter, else MM matching the current month.
month=$(date -u +%m)
quarter="Q$(( (10#$month - 1) / 3 + 1 ))"

dst_dir="$year_dir"
if [[ -d "${year_dir}/${quarter}" ]]; then
  dst_dir="${year_dir}/${quarter}"
elif [[ -d "${year_dir}/${month}" ]]; then
  dst_dir="${year_dir}/${month}"
fi

dst="${dst_dir}/${slug}.md"

# ---- Detect PR if not provided -------------------------------------------

if [[ -z "$pr_arg" ]] && command -v gh >/dev/null 2>&1; then
  pr_arg=$(gh pr view --json url -q .url 2>/dev/null || true)
fi
[[ -n "$pr_arg" ]] && fm_set_scalar "$src" pr "$pr_arg"

# ---- Move + log -----------------------------------------------------------

rel_dst="${dst#$BACKLOG/}"
move_in_backlog "$BACKLOG" "$src" "$dst"

body="${note:-marked complete}"
[[ -n "$pr_arg" ]] && body="${body} (pr: ${pr_arg})"
append_block "$dst" "completed" "$body"

if (( do_commit )); then
  git -C "$BACKLOG" add "$rel_dst"
  git -C "$BACKLOG" commit -m "chore(backlog): complete ${slug}" >/dev/null
fi

echo "$dst"
