#!/usr/bin/env bash
# Wait for the checks on one commit to finish, then print each one's conclusion. Reads state and
# writes nothing; it never reruns, cancels or approves anything.
#
#   <check name> <conclusion>
#
# Both kinds of check count: check runs, and commit statuses (CircleCI and other status-API
# reporters, where a status's state is printed as its conclusion).
#
# Exit 0  every check finished and none failed
# Exit 1  a check failed, was cancelled or timed out
# Exit 2  the state could not be read, or the wait timed out — verification-incomplete, not green
# Exit 3  the commit exists and reports no checks at all
#
# 2 and 3 are different answers and the seat treats them differently. A check that exists and
# cannot be read is state the seat is blind to, so it cannot approve. A repository that runs no CI
# is not hiding anything: the seat records "repository reports no checks" under what it could not
# verify and judges the rest on its own reading. Collapsing the two means a repository without CI
# can never be approved, which would make the zero-config path useless.
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
  # Commit statuses are a second API, and CI that predates check runs (CircleCI, Jenkins, many
  # bots) reports only there; a required check can be one of them. The combined endpoint already
  # keeps the latest state per context. pending maps to an unfinished run; failure and error keep
  # their own word, which the conclusion case below reads as failed.
  statuses=$(gh api "repos/$repo/commits/$sha/status?per_page=100" \
    --jq '.statuses[] | if .state == "pending" then "\(.context)\tin_progress\tpending" else "\(.context)\tcompleted\t\(.state)" end') || {
    echo "ci-wait: cannot read commit statuses for $sha" >&2
    exit 2
  }
  runs=$(printf '%s\n%s\n' "$runs" "$statuses" | sed '/^$/d')

  if [[ -z $runs ]]; then
    echo "ci-wait: $sha reports no checks" >&2
    exit 3
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
