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

is_takeable() {
  local file="$1"
  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    local hits
    hits=$(find "$BACKLOG/done" -name "${dep}.md" -type f 2>/dev/null | head -1)
    [[ -z "$hits" ]] && return 1
  done < <(read_fm_dep_slugs "$file")
  return 0
}

# Emit "priority mtime path takeable" rows so we can sort uniformly.
rows=$(mktemp)
trap 'rm -f "$rows"' EXIT
for f in "$BACKLOG"/todo/*.md; do
  [[ -f "$f" ]] || continue
  p=$(read_fm_scalar "$f" priority); [[ -z "$p" ]] && p=999
  mt=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
  if is_takeable "$f"; then takeable=1; else takeable=0; fi
  printf "%06d %015d %d %s\n" "$p" "$mt" "$takeable" "$f"
done > "$rows"

if [[ ! -s "$rows" ]]; then
  echo "todo/ is empty"
  exit 0
fi

takeable_sorted=$(sort -k1,1n -k2,2n "$rows" | awk '$3==1')
blocked_sorted=$(sort -k1,1n -k2,2n "$rows" | awk '$3==0')

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
    missing=()
    while IFS= read -r dep; do
      [[ -z "$dep" ]] && continue
      hits=$(find "$BACKLOG/done" -name "${dep}.md" -type f 2>/dev/null | head -1)
      [[ -z "$hits" ]] && missing+=("$dep")
    done < <(read_fm_dep_slugs "$file")
    printf "  %s — waiting on: %s\n" "$base" "$(IFS=,; echo "${missing[*]}")"
  done <<< "$blocked_sorted"
fi
