#!/usr/bin/env bash
# Create a new task in backlog/todo/.
# Usage:
#   add.sh SLUG [--category=plan|followup|task-list|ideas]
#                [--topic=...] [--priority=N]
#                [--timeout=DUR] [--description=...]
#                [--backlog=PATH]
# Echoes the path of the created file (so callers can open it for editing).

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

slug=""
category="plan"
topic=""
priority=""
timeout=""
description=""
backlog_arg=""

for arg in "$@"; do
  case "$arg" in
    --category=*)    category="${arg#*=}" ;;
    --topic=*)       topic="${arg#*=}" ;;
    --priority=*)    priority="${arg#*=}" ;;
    --timeout=*)     timeout="${arg#*=}" ;;
    --description=*) description="${arg#*=}" ;;
    --backlog=*)     backlog_arg="${arg#*=}" ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) slug="$arg" ;;
  esac
done

if [[ -z "$slug" ]]; then
  echo "usage: add.sh SLUG [--category=...] [--topic=...] [--priority=N] [--timeout=DUR] [--description=...]" >&2
  exit 2
fi

case "$category" in
  plan|followup|task-list|ideas) ;;
  *) echo "category must be one of: plan, followup, task-list, ideas" >&2; exit 2 ;;
esac

# Slugs should be kebab-case; complain if they aren't.
if [[ ! "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "slug must be kebab-case: $slug" >&2
  exit 2
fi

BACKLOG=$(find_backlog "$backlog_arg")
ensure_dirs "$BACKLOG"

filename="${slug}-${category}.md"
target="$BACKLOG/todo/$filename"

if [[ -e "$target" ]]; then
  echo "already exists: $target" >&2
  exit 1
fi

# Also bail if a same-slug exists anywhere in the tree.
if existing=$(resolve_slug "$BACKLOG" "${slug}-${category}" 2>/dev/null); then
  echo "slug already in use: $existing" >&2
  exit 1
fi

{
  echo "---"
  [[ -n "$topic" ]]       && echo "topic: $topic"
  [[ -n "$description" ]] && echo "description: $description"
  [[ -n "$priority" ]]    && echo "priority: $priority"
  [[ -n "$timeout" ]]     && echo "timeout: $timeout"
  echo "---"
  echo ""
  echo "# ${slug//-/ }"
  echo ""
  echo "[problem statement, key decisions, phases]"
  echo ""
  echo "---"
} > "$target"

echo "$target"
