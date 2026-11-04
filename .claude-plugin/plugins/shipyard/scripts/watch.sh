#!/usr/bin/env bash
# One poll of a repository for review work. Prints one line per pull request that wants
# attention and writes nothing anywhere.
#
#   <number> <base-sha> <head-sha> fresh|recheck
#
# fresh   — carries the review label and has no verdict comment for the current head
# recheck — has a verdict for an older head, so the author pushed since
#
# Everything comes from the environment:
#   SHIPYARD_REPO     owner/name (default: the repository of the current directory)
#   SHIPYARD_LABEL    the label the lead applies (default: review)
#   SHIPYARD_LIMIT    pull requests to consider (default: 50)
#   SHIPYARD_ACTOR    the login whose comments count as verdicts (default: the token's own)
#
# Exit 0 with no output means nothing to do. Exit 2 means the poll could not be made, which is
# not the same as nothing to do.
set -euo pipefail

repo=${SHIPYARD_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)}
label=${SHIPYARD_LABEL:-review}
limit=${SHIPYARD_LIMIT:-50}

if [[ -z $repo ]]; then
  echo "watch: no SHIPYARD_REPO and no repository here" >&2
  exit 2
fi

actor=${SHIPYARD_ACTOR:-$(gh api user --jq .login 2>/dev/null || true)}
if [[ -z $actor ]]; then
  echo "watch: cannot read the token's own login; set SHIPYARD_ACTOR" >&2
  exit 2
fi

prs=$(gh api "repos/$repo/pulls?state=open&per_page=$limit" \
  --jq ".[] | select(.draft == false) | select(any(.labels[]; .name == \"$label\")) | \"\(.number) \(.base.sha) \(.head.sha)\"") || {
  echo "watch: cannot list pull requests for $repo" >&2
  exit 2
}

while read -r number base head; do
  [[ -n ${number:-} ]] || continue

  verdicts=$(gh api "repos/$repo/issues/$number/comments?per_page=100" \
    --jq ".[] | select(.user.login == \"$actor\") | .body" 2>/dev/null |
    grep '^VERDICT:' | grep -oE '[0-9a-f]{40}' || true)

  if [[ -z $verdicts ]]; then
    echo "$number $base $head fresh"
  elif ! grep -qx "$head" <<<"$verdicts"; then
    echo "$number $base $head recheck"
  fi
done <<<"$prs"
