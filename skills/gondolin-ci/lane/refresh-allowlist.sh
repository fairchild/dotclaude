#!/usr/bin/env bash
# Fetch the Actions hosts GitHub publishes. GitHub adds results storage hosts over time, and a job
# sent to one the shipped list lacks loses its log upload, which the run's egress summary shows as a
# refused productionresultssa host.
#   refresh-allowlist.sh [file]
# The default file is in the state directory, where the lane reads it on top of the shipped list.
set -euo pipefail

state=${GONDOLIN_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/gondolin-runner}
out=${1:-${state}/allowlist.json}

fetched=$(gh api meta --jq '{source: "gh api meta .domains.actions", fetchedAt: (now | todate), hosts: .domains.actions}')
count=$(printf '%s' "$fetched" | jq '.hosts | length')
if ! [ "$count" -gt 0 ]; then
  printf '%s\n' "GitHub's answer named no Actions hosts; nothing written" >&2
  exit 1
fi

mkdir -p "$(dirname -- "$out")"
printf '%s\n' "$fetched" > "$out"
printf '%s\n' "${count} hosts in ${out}"
