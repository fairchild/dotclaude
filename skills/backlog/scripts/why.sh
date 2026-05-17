#!/usr/bin/env bash
# Explain why a task isn't takeable. Walks the dep graph one level.
# Usage: why.sh SLUG [--backlog=PATH]

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

slug=""
backlog_arg=""
for arg in "$@"; do
  case "$arg" in
    --backlog=*) backlog_arg="${arg#*=}" ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) slug="$arg" ;;
  esac
done

[[ -z "$slug" ]] && { echo "usage: why.sh SLUG" >&2; exit 2; }

BACKLOG=$(find_backlog "$backlog_arg")
file=$(resolve_slug "$BACKLOG" "$slug")

pile=$(pile_of "$file")
echo "## $slug"
echo "  location: $pile/"
echo ""

deps=$(read_fm_dep_slugs "$file")
if [[ -z "$deps" ]]; then
  echo "  no declared dependencies"
  case "$pile" in
    todo) echo "  takeable: yes" ;;
    doing) echo "  already claimed" ;;
    done) echo "  already done" ;;
  esac
  exit 0
fi

echo "  dependencies:"
all_done=1
while IFS= read -r dep; do
  [[ -z "$dep" ]] && continue
  hit=$(find "$BACKLOG/todo" "$BACKLOG/doing" "$BACKLOG/done" -name "${dep}.md" -type f 2>/dev/null | head -1)
  if [[ -z "$hit" ]]; then
    printf "    %-40s [MISSING — unresolvable slug]\n" "$dep"
    all_done=0
    continue
  fi
  dep_pile=$(pile_of "$hit")
  case "$dep_pile" in
    done) printf "    %-40s done\n" "$dep" ;;
    todo) printf "    %-40s todo — not started\n" "$dep"; all_done=0 ;;
    doing) printf "    %-40s doing — in flight\n" "$dep"; all_done=0 ;;
    *) printf "    %-40s ? (%s)\n" "$dep" "$dep_pile"; all_done=0 ;;
  esac
done <<< "$deps"

echo ""
if [[ "$pile" != "todo" ]]; then
  echo "  takeable: n/a (not in todo/)"
elif (( all_done )); then
  echo "  takeable: yes (all deps done)"
else
  echo "  takeable: no (deps above marked todo/doing/MISSING)"
fi
