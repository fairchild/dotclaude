#!/usr/bin/env bash
# Cancel a task: move from todo/ or doing/ to done/{YYYY}/cancelled/.
# Usage:
#   cancel.sh SLUG [--reason="..."] [--backlog=PATH] [--commit]

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

if [[ -z "$slug" ]]; then
  echo "usage: cancel.sh SLUG [--reason=...]" >&2
  exit 2
fi
if [[ -z "$reason" ]]; then
  echo "--reason is required (cancel without explanation rots the trail)" >&2
  exit 2
fi

BACKLOG=$(find_backlog "$backlog_arg")

src=$(resolve_slug "$BACKLOG" "$slug")
case "$(pile_of "$src")" in
  todo|doing) ;;
  done) echo "already in done/: $src" >&2; exit 1 ;;
  *) echo "unexpected location: $src" >&2; exit 1 ;;
esac

year=$(year_now)
dst_dir="$BACKLOG/done/${year}/cancelled"
mkdir -p "$dst_dir"
dst="${dst_dir}/${slug}.md"
rel_dst="${dst#$BACKLOG/}"
move_in_backlog "$BACKLOG" "$src" "$dst"

append_block "$dst" "cancelled" "$reason"

if (( do_commit )); then
  git -C "$BACKLOG" add "$rel_dst"
  git -C "$BACKLOG" commit -m "chore(backlog): cancel ${slug}" >/dev/null
fi

echo "$dst"
