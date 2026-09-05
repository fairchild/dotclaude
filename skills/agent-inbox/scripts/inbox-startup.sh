#!/usr/bin/env bash
# SessionStart hook: summarize unread inbox messages so the agent sees them as initial context.
# Uses the same identity and root as the unread-count hook.
# Silent when empty; does not consume messages.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$script_dir/lib.sh"

inbox_root=$(agent_inbox_root)
agent=$(agent_inbox_name)
if [[ -z "$agent" ]]; then
  exec bash "$script_dir/check-inbox-hook.sh"
fi
inbox="$inbox_root/$agent/new"

[[ -d "$inbox" ]] || exit 0

# Collect .md files — fast glob, no find
shopt -s nullglob
files=("$inbox"/*.md)
shopt -u nullglob

count=${#files[@]}
[[ $count -eq 0 ]] && exit 0

echo "📬 ${count} unread in ${inbox_root}/${agent}/new/"
echo ""

for f in "${files[@]}"; do
  name=$(basename "$f")
  # Extract sender from frontmatter (first 'from:' line)
  from=$(awk '/^from:/{print $2; exit}' "$f")
  # Extract first non-frontmatter, non-blank line as subject
  subject=$(awk 'BEGIN{in_fm=0} /^---$/{in_fm=!in_fm; next} in_fm{next} /^$/{next} {print; exit}' "$f")
  printf "  • [%s] %s — %s\n" "${from:-unknown}" "${subject:0:80}" "$name"
done

echo ""
echo "Read with: cat \"${inbox_root}/${agent}/new/<file>\""
