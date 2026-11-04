#!/usr/bin/env bash
# Wait for the checks on one commit to finish, then print each one's conclusion. Reads state and
# writes nothing; it never reruns, cancels or approves anything.
#
#   <check name> <conclusion>
#
# Exits 0 when every check finished and none failed, 1 when one failed or was cancelled, 2 when
# the wait timed out or the state could not be read — which is verification-incomplete, not green.
#
#   SHIPYARD_REPO       owner/name (default: the repository of the current directory)
#   SHIPYARD_SHA        the commit to watch (required; a full 40-character SHA)
#   SHIPYARD_CI_TIMEOUT seconds before giving up (default: 1800)
#   SHIPYARD_CI_POLL    seconds between polls (default: 20)
set -euo pipefail

repo=${SHIPYARD_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)}
sha=${SHIPYARD_SHA:-}
timeout=${SHIPYARD_CI_TIMEOUT:-1800}
poll=${SHIPYARD_CI_POLL:-20}

if [[ -z $repo || ! $sha =~ ^[0-9a-f]{40}$ ]]; then
  echo "ci-wait: need SHIPYARD_REPO and a 40-character SHIPYARD_SHA" >&2
  exit 2
fi

deadline=$(( $(date +%s) + timeout ))
while :; do
  runs=$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" \
    --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion // "pending")"') || {
    echo "ci-wait: cannot read checks for $sha" >&2
    exit 2
  }

  if [[ -z $runs ]]; then
    echo "ci-wait: no checks reported for $sha" >&2
    exit 2
  fi

  if ! awk -F'\t' '$2 != "completed"' <<<"$runs" | grep -q .; then
    failed=0
    while IFS=$'\t' read -r name _ conclusion; do
      echo "$name $conclusion"
      case $conclusion in success | neutral | skipped) ;; *) failed=1 ;; esac
    done <<<"$runs"
    exit "$failed"
  fi

  if (( $(date +%s) >= deadline )); then
    echo "ci-wait: still running after ${timeout}s" >&2
    awk -F'\t' '$2 != "completed" { print $1 }' <<<"$runs" >&2
    exit 2
  fi
  sleep "$poll"
done
