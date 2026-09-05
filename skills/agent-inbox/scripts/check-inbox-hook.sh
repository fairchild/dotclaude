#!/usr/bin/env bash
# Report unread counts. Silent when empty; does not consume messages.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$script_dir/lib.sh"

inbox_root=$(agent_inbox_root)
agent=$(agent_inbox_name)
shopt -s nullglob
if [[ -n "$agent" ]]; then
  files=("$inbox_root/$agent/new/"*.md)
else
  files=("$inbox_root/"*/new/*.md)
fi
[[ ${#files[@]} -eq 0 ]] && exit 0

if [[ -n "$agent" ]]; then
  printf '📬 %s unread in %s/%s/new/ — read, then archive handled messages\n' "${#files[@]}" "$inbox_root" "$agent"
else
  printf '📬 %s unread in %s/ — choose your own inbox before reading\n' "${#files[@]}" "$inbox_root"
fi
