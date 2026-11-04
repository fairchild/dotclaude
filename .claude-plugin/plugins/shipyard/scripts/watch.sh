#!/usr/bin/env bash
# One poll of a repository for review work. Prints one line per pull request that wants
# attention and writes nothing anywhere.
#
#   <number> <base-sha> <head-sha> fresh|recheck
#
# fresh   — carries the review label and has no verdict for the current head
# recheck — has a verdict for an older head, so the author pushed since
#
# Verdicts are read from both venues a seat can post to, conversation comments and review
# bodies, so a repository configured for inline findings is not re-reviewed forever.
#
# Everything comes from the environment:
#   SHIPYARD_REPO     owner/name (default: the repository of the current directory)
#   SHIPYARD_LABEL    the label the lead applies (default: review)
#   SHIPYARD_LIMIT    pull requests to consider (default: 50)
#   SHIPYARD_ACTOR    the login whose verdicts count (default: the token's own)
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

  # Two steps on purpose: a fetch that fails must not read as "no verdict yet", which would
  # re-review a pull request already reviewed. --paginate because a verdict can sit past the
  # first page of a long discussion.
  bodies=$(gh api --paginate "repos/$repo/issues/$number/comments?per_page=100" \
    --jq ".[] | select(.user.login == \"$actor\") | .body") || {
    echo "watch: cannot read comments on $repo#$number" >&2
    exit 2
  }
  # A seat configured to post inline findings puts the verdict in a review body, not a
  # conversation comment. Read both, or that seat re-reviews the same head forever.
  reviews=$(gh api --paginate "repos/$repo/pulls/$number/reviews?per_page=100" \
    --jq ".[] | select(.user.login == \"$actor\") | .body") || {
    echo "watch: cannot read reviews on $repo#$number" >&2
    exit 2
  }
  bodies=$(printf '%s\n%s\n' "$bodies" "$reviews")
  verdicts=$(grep '^VERDICT:' <<<"$bodies" | grep -oE '[0-9a-f]{40}' || true)

  if [[ -z $verdicts ]]; then
    echo "$number $base $head fresh"
  elif ! grep -qx "$head" <<<"$verdicts"; then
    echo "$number $base $head recheck"
  fi
done <<<"$prs"
