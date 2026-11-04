#!/usr/bin/env bash
# One poll of a repository for review work. Prints one line per pull request that wants
# attention and writes nothing anywhere.
#
#   <number> <base-sha> <head-sha> fresh|recheck|retry
#
# fresh    no verdict on this pull request at all — never reviewed
# recheck  verdicts exist, none for the current head — reviewed at an earlier head
# retry    the latest verdict for the current head is verification-incomplete, so that review
#          reached no conclusion and the head is owed another attempt
#
# Rechecks and retries come before freshes: an author waiting on a re-read is blocked, and a
# delta is cheaper than a first pass. Within each group, oldest pull request first.
#
# Verdicts are read from both venues a seat can post to, conversation comments and review bodies,
# merged in timestamp order so "the latest verdict for this head" means the latest one.
#
# Everything comes from the environment:
#   SHIPYARD_REPO     owner/name (default: the repository of the current directory)
#   SHIPYARD_LABEL    the label the lead applies. Empty or "none" (the default) means every open
#                     non-draft pull request, which is what lets a seat run in a repository that
#                     has configured nothing: a label default would need someone to apply it.
#   SHIPYARD_LIMIT    at most this many pull requests considered, oldest first (default: 50).
#                     Applied after the label filter, not as the page size: the listing paginates,
#                     so a labelled pull request past the first page is still found.
#   SHIPYARD_ACTOR    the login whose verdicts count (default: the token's own). Wrong here and
#                     every pull request looks fresh, because no verdict is ever found.
#
# Exit 0 with no output means nothing to do. Exit 2 means the poll could not be made, which is
# not the same as nothing to do: report it and poll again rather than reading it as an empty queue.
#
#   watch.sh --self-test   check the classification against built-in fixtures; makes no network call
set -euo pipefail

# One line per item: timestamp, author, and that item's own VERDICT line where it has one.
# Extracting the verdict inside jq keeps a multi-line body from becoming several lines out here,
# and the timestamp is what lets two venues merge in the order they were actually posted. The
# author comes out as a field rather than a jq filter because gh api has no --arg to pass one in
# safely, and interpolating a login into the filter is an injection waiting to happen.
#
# `.created_at // .submitted_at` because the two venues disagree: an issue comment carries
# created_at, a review carries submitted_at and no created_at at all. Reading only created_at puts
# `null` on every review line, which sorts every review after every comment regardless of when it
# was posted — and that silently breaks supersession across venues, the whole point of ordering.
verdict_jq='.[] | "\(.created_at // .submitted_at)\t\(.user.login)\t\(.body | split("\n") | map(select(startswith("VERDICT:"))) | last // "")"'

# Both venues merged, ordered, narrowed to one actor's verdict lines. The main loop and the
# self-test go through this, so a fixture exercises the same path a poll does.
verdict_lines() {
  local actor=$1
  sort | awk -F'\t' -v actor="$actor" '$2 == actor && $3 ~ /^VERDICT:/ { print $3 }'
}

# Which state a pull request is in, given its head and its verdict lines in timestamp order on
# stdin. Separate from the fetching so --self-test can drive it: a wrong answer here either
# re-reviews work already reviewed or silently drops work, and neither shows up without four
# pull requests sitting in four different states to poll against.
classify() {
  local head=$1 lines state
  lines=$(cat)
  [[ -n ${lines//[[:space:]]/} ]] || { echo fresh; return; }
  state=$(grep -F "$head" <<<"$lines" | tail -1 |
    sed -nE 's/^VERDICT:[[:space:]]*([a-z-]+).*/\1/p')
  if [[ -z $state ]]; then
    echo recheck
  elif [[ $state == verification-incomplete ]]; then
    echo retry
  else
    echo settled
  fi
}

self_test() {
  local a b failures=0 got
  a=$(printf 'a%.0s' {1..40})
  b=$(printf 'b%.0s' {1..40})
  check() {
    got=$(printf '%s' "$2" | classify "$3")
    if [[ $got == "$1" ]]; then
      echo "ok    $4"
    else
      echo "FAIL  $4: wanted $1, got $got"
      failures=$((failures + 1))
    fi
  }
  check fresh "" "$a" "no verdict anywhere"
  check settled "VERDICT: approve — at $a — 0 blocking, 0 deferrable, 0 nit" "$a" \
    "approved at this head"
  check settled "VERDICT: changes-needed — at $a — 1 blocking, 0 deferrable, 0 nit" "$a" \
    "changes needed at this head"
  check recheck "VERDICT: approve — at $b — 0 blocking, 0 deferrable, 0 nit" "$a" \
    "verdict for an earlier head only"
  check retry "VERDICT: verification-incomplete — at $a — 0 blocking, 0 deferrable, 0 nit" "$a" \
    "verification incomplete at this head"
  check settled "VERDICT: verification-incomplete — at $a — 0 blocking, 0 deferrable, 0 nit
VERDICT: approve — at $a — 0 blocking, 0 deferrable, 0 nit" "$a" \
    "incomplete then superseded by approve at the same head"
  check retry "VERDICT: approve — at $a — 0 blocking, 0 deferrable, 0 nit
VERDICT: verification-incomplete — at $a — 0 blocking, 0 deferrable, 0 nit" "$a" \
    "approve then superseded by incomplete at the same head"
  check retry "VERDICT: approve — at $b — 0 blocking, 0 deferrable, 0 nit
VERDICT: verification-incomplete — at $a — 0 blocking, 0 deferrable, 0 nit" "$a" \
    "earlier head approved, current head incomplete"
  # The cases above feed classify() lines that are already in order, so they cannot catch a
  # timestamp read from the wrong field — which is exactly how the two venues came to sort wrongly.
  # These run the real jq filter over payloads shaped like each endpoint's.
  if command -v jq >/dev/null 2>&1; then
    local comment_payload review_payload
    comment_payload='[{"created_at":"2026-01-01T12:00:00Z","user":{"login":"seat"},
      "body":"## Review\n\nVERDICT: verification-incomplete — at '"$a"' — 0 blocking, 0 deferrable, 0 nit"}]'
    review_payload='[{"submitted_at":"2026-01-01T11:00:00Z","user":{"login":"seat"},
      "body":"## Review\n\nVERDICT: approve — at '"$a"' — 0 blocking, 0 deferrable, 0 nit"}]'

    local ts
    ts=$(jq -r "$verdict_jq" <<<"$review_payload" | cut -f1)
    if [[ $ts == "2026-01-01T11:00:00Z" ]]; then
      echo "ok    a review payload yields its submitted_at"
    else
      echo "FAIL  a review payload yields its submitted_at: got '$ts'"
      failures=$((failures + 1))
    fi

    ts=$(jq -r "$verdict_jq" <<<"$comment_payload" | cut -f1)
    if [[ $ts == "2026-01-01T12:00:00Z" ]]; then
      echo "ok    a comment payload yields its created_at"
    else
      echo "FAIL  a comment payload yields its created_at: got '$ts'"
      failures=$((failures + 1))
    fi

    # End to end across venues: the review approved first, a comment said incomplete after, so the
    # head is owed a retry. Read the wrong timestamp field and this comes back settled.
    got=$(printf '%s\n%s\n' \
      "$(jq -r "$verdict_jq" <<<"$comment_payload")" \
      "$(jq -r "$verdict_jq" <<<"$review_payload")" | verdict_lines seat | classify "$a")
    if [[ $got == retry ]]; then
      echo "ok    later comment supersedes an earlier review across venues"
    else
      echo "FAIL  later comment supersedes an earlier review across venues: wanted retry, got $got"
      failures=$((failures + 1))
    fi
  else
    echo "skip  payload cases (no jq on PATH)"
  fi

  if [[ $failures -eq 0 ]]; then
    echo "watch.sh: self-test passed"
    return 0
  fi
  echo "watch.sh: $failures case(s) failed" >&2
  return 1
}

[[ ${1:-} != --self-test ]] || { self_test; exit $?; }

repo=${SHIPYARD_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)}
label=${SHIPYARD_LABEL-none}
limit=${SHIPYARD_LIMIT:-50}

if [[ -z $repo ]]; then
  echo "watch: no SHIPYARD_REPO and no repository here" >&2
  exit 2
fi

if [[ ! $limit =~ ^[1-9][0-9]*$ ]]; then
  echo "watch: SHIPYARD_LIMIT must be a positive integer, got '$limit'" >&2
  exit 2
fi

actor=${SHIPYARD_ACTOR:-$(gh api user --jq .login 2>/dev/null || true)}
if [[ -z $actor ]]; then
  echo "watch: cannot read the token's own login; set SHIPYARD_ACTOR" >&2
  exit 2
fi

if [[ -z $label || $label == none ]]; then
  select_label="."
else
  select_label="select(any(.labels[]; .name == \"$label\"))"
fi

# Ascending by creation, because the cap keeps the head of the list: GET /pulls defaults to newest
# first, which would drop the oldest pull requests — the ones that have waited longest — exactly
# backwards. The cap is applied to the filtered result, not passed as per_page: under --paginate
# per_page is the page size and caps nothing. Truncating the captured value rather than piping gh
# into head also keeps a SIGPIPE from reading as a failed listing under pipefail.
listed=$(gh api --paginate "repos/$repo/pulls?state=open&sort=created&direction=asc&per_page=100" \
  --jq ".[] | select(.draft == false) | $select_label | \"\(.number) \(.base.sha) \(.head.sha)\"") || {
  echo "watch: cannot list pull requests for $repo" >&2
  exit 2
}
prs=$(head -n "$limit" <<<"$listed")


rechecks=()
freshes=()

while read -r number base head; do
  [[ -n ${number:-} ]] || continue

  # Two steps on purpose: a fetch that fails must not read as "no verdict yet", which would
  # re-review a pull request already reviewed. --paginate because a verdict can sit past the
  # first page of a long discussion.
  comments=$(gh api --paginate "repos/$repo/issues/$number/comments?per_page=100" \
    --jq "$verdict_jq") || {
    echo "watch: cannot read comments on $repo#$number" >&2
    exit 2
  }
  # A seat configured to post inline findings puts the verdict in a review body, not a
  # conversation comment. Read both, or that seat re-reviews the same head forever.
  reviews=$(gh api --paginate "repos/$repo/pulls/$number/reviews?per_page=100" \
    --jq "$verdict_jq") || {
    echo "watch: cannot read reviews on $repo#$number" >&2
    exit 2
  }

  # Merge both venues chronologically, keep this actor's verdict lines, drop the metadata.
  state=$(printf '%s\n%s\n' "$comments" "$reviews" | verdict_lines "$actor" | classify "$head")

  case $state in
  fresh) freshes+=("$number $base $head fresh") ;;
  recheck) rechecks+=("$number $base $head recheck") ;;
  retry) rechecks+=("$number $base $head retry") ;;
  esac
done <<<"$prs"

# Rechecks and retries first, then freshes. The listing was already oldest-first, so each group
# keeps that order.
for line in ${rechecks+"${rechecks[@]}"} ${freshes+"${freshes[@]}"}; do
  echo "$line"
done
