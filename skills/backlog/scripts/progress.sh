#!/usr/bin/env bash
# Append a progress note to a claimed task in doing/.
# Usage:
#   progress.sh [SLUG] "note text" [--backlog=PATH]
# With no SLUG, uses the single doing/ task on the current branch.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

slug=""
note=""
backlog_arg=""

for arg in "$@"; do
  case "$arg" in
    --backlog=*) backlog_arg="${arg#*=}" ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *)
      # First positional is the slug if it matches a file in doing/; otherwise it's the note.
      if [[ -z "$slug" && -z "$note" ]]; then
        # peek: is there a file in doing/ matching this name?
        if [[ -f "$(find_backlog "$backlog_arg")/doing/${arg}.md" ]]; then
          slug="$arg"
        else
          note="$arg"
        fi
      elif [[ -z "$note" ]]; then
        note="$arg"
      else
        note="$note $arg"
      fi
      ;;
  esac
done

[[ -z "$note" ]] && { echo "usage: progress.sh [SLUG] \"note\"" >&2; exit 2; }

BACKLOG=$(find_backlog "$backlog_arg")

if [[ -z "$slug" ]]; then
  found=$(find_doing_on_branch "$BACKLOG") || exit 1
  slug=$(slug_of "$found")
fi

file="$BACKLOG/doing/${slug}.md"
[[ ! -f "$file" ]] && { echo "no such task in doing/: $slug" >&2; exit 1; }

append_block "$file" "progress" "$note"
echo "$file"
