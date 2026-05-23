#!/usr/bin/env bash
# Dry-run of take --auto. Prints what would be picked and a runner-up, without claiming.
# Usage: next.sh [--backlog=PATH]

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

backlog_arg=""
for arg in "$@"; do
  case "$arg" in
    --backlog=*) backlog_arg="${arg#*=}" ;;
    *) backlog_arg="$arg" ;;
  esac
done

BACKLOG=$(find_backlog "$backlog_arg")

# Build a newline-delimited set of done-slugs once. Membership test is a
# fixed-string grep — works on bash 3.2 without associative arrays.
done_slugs=$(find "$BACKLOG/done" -type f -name "*.md" 2>/dev/null \
  | xargs -n1 basename 2>/dev/null | sed 's/\.md$//')

dep_is_done() {
  echo "$done_slugs" | grep -Fxq "$1"
}

rows=$(mktemp)
missing_per_file=$(mktemp)
trap 'rm -f "$rows" "$missing_per_file"' EXIT

for f in "$BACKLOG"/todo/*.md; do
  [[ -f "$f" ]] || continue
  slug=$(slug_of "$f")
  p=$(read_fm_scalar "$f" priority); [[ -z "$p" ]] && p=999
  mt=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
  missing=()
  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    dep_is_done "$dep" || missing+=("$dep")
  done < <(read_fm_dep_slugs "$f")
  takeable=$([[ ${#missing[@]} -eq 0 ]] && echo 1 || echo 0)
  printf "%06d %015d %d %s\n" "$p" "$mt" "$takeable" "$f" >> "$rows"
  if (( ${#missing[@]} > 0 )); then
    printf "%s\t%s\n" "$slug" "$(IFS=,; echo "${missing[*]}")" >> "$missing_per_file"
  fi
done

if [[ ! -s "$rows" ]]; then
  echo "todo/ is empty"
  exit 0
fi

sorted=$(sort -k1,1n -k2,2n "$rows")
takeable_sorted=$(echo "$sorted" | awk '$3==1')
blocked_sorted=$(echo "$sorted" | awk '$3==0')

echo "## next up"
if [[ -z "$takeable_sorted" ]]; then
  echo "  (nothing takeable — everything in todo/ is blocked by deps)"
else
  first=$(echo "$takeable_sorted" | head -1 | awk '{print $4}')
  second=$(echo "$takeable_sorted" | sed -n '2p' | awk '{print $4}')
  echo "  pick:    $(basename "$first")"
  [[ -n "$second" ]] && echo "  runner:  $(basename "$second")"
fi

if [[ -n "$blocked_sorted" ]]; then
  echo ""
  echo "## blocked by deps"
  while read -r line; do
    file=$(echo "$line" | awk '{print $4}')
    base=$(basename "$file")
    slug=$(slug_of "$file")
    missing=$(awk -F '\t' -v s="$slug" '$1==s{print $2; exit}' "$missing_per_file")
    printf "  %s — waiting on: %s\n" "$base" "$missing"
  done <<< "$blocked_sorted"
fi
