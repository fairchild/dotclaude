#!/usr/bin/env bash
# Initialize backlog/ in a project: create todo/, doing/, done/ and AGENTS.md.
# Usage: init.sh [PATH]

set -euo pipefail

target="${1:-backlog}"
mkdir -p "$target/todo" "$target/doing" "$target/done"

agents_md="$target/AGENTS.md"
if [[ ! -f "$agents_md" ]]; then
  cat > "$agents_md" <<'EOF'
# backlog/

Deferred work, one markdown file per task. Location = status:

- `todo/`         — available
- `doing/`        — claimed, in flight
- `done/{YYYY}/`  — completed, year-partitioned

Interact via the backlog skill (`/backlog add|take|complete|...`).
Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.
EOF
  echo "wrote $agents_md"
fi

echo "initialized: $target"
ls -la "$target"
