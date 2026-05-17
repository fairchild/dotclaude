#!/usr/bin/env bash
# Claim a task: git mv todo/X.md → doing/X.md, stamp claim fields, append `started` block.
# Usage:
#   take.sh [SLUG] [--branch=NAME] [--claimer=ID] [--backlog=PATH] [--commit]
# With no SLUG, picks the highest-priority takeable task whose deps are all done.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

slug=""
branch_arg=""
claimer_arg=""
backlog_arg=""
do_commit=0

for arg in "$@"; do
  case "$arg" in
    --branch=*)  branch_arg="${arg#*=}" ;;
    --claimer=*) claimer_arg="${arg#*=}" ;;
    --backlog=*) backlog_arg="${arg#*=}" ;;
    --commit)    do_commit=1 ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) slug="$arg" ;;
  esac
done

BACKLOG=$(find_backlog "$backlog_arg")
ensure_dirs "$BACKLOG"

# ---- Pick a slug if not given ---------------------------------------------

is_takeable() {
  # A todo/ file is takeable iff every dep slug resolves under done/**.
  local file="$1"
  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    local hits
    hits=$(find "$BACKLOG/done" -name "${dep}.md" -type f 2>/dev/null | head -1)
    if [[ -z "$hits" ]]; then
      return 1
    fi
  done < <(read_fm_dep_slugs "$file")
  return 0
}

pick_auto() {
  # Print one slug or nothing.
  local best_file=""
  local best_prio=999999
  local best_mtime=99999999999
  for f in "$BACKLOG"/todo/*.md; do
    [[ -f "$f" ]] || continue
    is_takeable "$f" || continue
    local p mt
    p=$(read_fm_scalar "$f" priority)
    [[ -z "$p" ]] && p=999
    mt=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
    if (( p < best_prio )) || (( p == best_prio && mt < best_mtime )); then
      best_prio=$p
      best_mtime=$mt
      best_file="$f"
    fi
  done
  [[ -n "$best_file" ]] && slug_of "$best_file"
}

if [[ -z "$slug" ]]; then
  slug=$(pick_auto)
  if [[ -z "$slug" ]]; then
    echo "no takeable task in todo/ (all blocked by deps, or todo/ is empty)" >&2
    exit 1
  fi
fi

# ---- Locate the file ------------------------------------------------------

src="$BACKLOG/todo/${slug}.md"
if [[ ! -f "$src" ]]; then
  # Maybe the user passed a fully qualified slug already in doing/ or done/.
  found=$(resolve_slug "$BACKLOG" "$slug" 2>/dev/null || true)
  if [[ -n "$found" ]]; then
    case "$(pile_of "$found")" in
      doing) echo "already claimed: $found" >&2; exit 1 ;;
      done)  echo "already done: $found"    >&2; exit 1 ;;
    esac
  fi
  echo "no such task in todo/: $slug" >&2
  exit 1
fi

# ---- Compute claim fields -------------------------------------------------

claimer="${claimer_arg:-$(default_claim_id)}"
branch="${branch_arg:-$(current_branch)}"
[[ -z "$branch" ]] && branch="(no-branch)"

# ---- Mutate frontmatter in place, then move ------------------------------

fm_set_scalar "$src" claimed_at "$(iso_now)"
fm_set_scalar "$src" claimed_by "$claimer"
fm_set_scalar "$src" branch     "$branch"
fm_set_scalar "$src" pr         "null"

dst="$BACKLOG/doing/${slug}.md"
move_in_backlog "$BACKLOG" "$src" "$dst"

append_block "$dst" "started" "claimed by ${claimer} on branch ${branch}"

if (( do_commit )); then
  git -C "$BACKLOG" add "doing/${slug}.md"
  git -C "$BACKLOG" commit -m "chore(backlog): take ${slug}" >/dev/null
fi

echo "$dst"
