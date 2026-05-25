#!/usr/bin/env bash
# github-issues backend — backlog tasks live as GitHub Issues on the current
# repo's remote. Verb semantics are unchanged from maildir; storage moves from
# local files to `gh`. Slugs are canonical via a `slug:<slug>` label, which
# also serves as the "this is a backlog task" marker (presence-test). Titles
# are free text.
#
# State derives from GitHub-native signals where it can, falling back to
# labels only where the platform can't encode the distinction:
#
#   todo   = open,   has `slug:*` label, no  `doing` label
#   doing  = open,   has `slug:*` label, has `doing` label
#   done   = closed, has `slug:*` label, no  `failed` label
#   failed = closed, has `slug:*` label, has `failed` label
#
# `cancel` and ordinary `done` both close the issue; they're discriminated by
# the worklog comment (and by GitHub's own close reason — `completed` vs
# `not planned`). Status lumps them, matching the maildir backends.
#
# Claim discriminator is the **branch**, not the assignee. Agents often share
# a GitHub identity (one PAT, many workers), so assignee can't tell two
# workers apart; branch usually can. `take` posts the claim comment first,
# adds the `doing` label, then re-reads comments — the earliest
# `advanced to=doing` line since the most recent `retried` comment wins. If
# the winner's `branch=` matches ours, the claim is ours; otherwise we lost
# the race and exit non-zero.
#
# Worklog format matches the maildir backends — each state transition or
# progress note is one `- <ts> <verb> ...` line, posted as an issue comment.
# `gh issue view --json comments` reconstructs the same chronological log a
# maildir worker would see by reading the file body below the divider.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$script_dir/lib.sh"

require_gh() {
  command -v gh >/dev/null 2>&1 \
    || { echo "gh CLI not installed; see https://cli.github.com" >&2; exit 1; }
  command -v jq >/dev/null 2>&1 \
    || { echo "jq not installed; required by github-issues backend" >&2; exit 1; }
  gh auth status >/dev/null 2>&1 \
    || { echo "gh not authenticated; run: gh auth login" >&2; exit 1; }
}

# Resolve a slug to an issue number. Empty stdout if no such slug.
issue_for_slug() {
  local slug="$1"
  gh issue list --state all --label "slug:${slug}" --limit 1 \
    --json number -q '.[0].number // empty' 2>/dev/null
}

post_log() {
  local n="$1" line="$2"
  gh issue comment "$n" --body "$line" >/dev/null
}

ensure_label() {
  local name="$1" color="$2" desc="$3"
  gh label create "$name" --color "$color" --description "$desc" --force >/dev/null 2>&1
}

# Comments matching the worklog line shape, in chronological order.
# Each line is the raw comment body. Skips bodies that aren't worklog lines.
worklog_lines() {
  local n="$1"
  gh issue view "$n" --json comments \
    -q '.comments | sort_by(.createdAt) | .[].body' \
    | grep -E '^- [0-9TZ:-]+ '
}

# Extract `branch=<X>` from a worklog line. Empty if not present.
branch_of() {
  grep -oE 'branch=[^ ]+' <<<"$1" | tail -1 | cut -d= -f2
}

cmd_setup() {
  require_gh
  [[ -f backlog/AGENTS.md ]] && {
    echo "backlog/AGENTS.md exists — refusing to overwrite" >&2; exit 1
  }
  local repo; repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)

  ensure_label "doing"  "fbca04" "claimed and in progress"
  ensure_label "failed" "d93f0b" "dead-lettered; needs retry"

  mkdir -p backlog
  cat > backlog/AGENTS.md <<EOF
# backlog/

\`CLAUDE.md\` here is a symlink to this file — read one, not both.

Task state lives in GitHub Issues on **${repo}**. There is no local
\`todo/\`/\`doing/\`/\`done/\` tree — issue state plus a small label set are the
queue.

Use the \`backlog\` skill (add / take / advance / progress / cancel / fail /
rescue / retry / maintain / status) to interact. Verbs dispatch to
\`gh issue\` under the hood.

## Backend

\`github-issues\` — see the \`backlog\` skill's \`references/backends/github-issues.md\`.

State mapping:

| State    | open/closed | labels                                |
|----------|-------------|---------------------------------------|
| todo     | open        | has \`slug:*\`, no \`doing\`          |
| doing    | open        | has \`slug:*\`, \`doing\`             |
| done     | closed      | has \`slug:*\`, no \`failed\`         |
| failed   | closed      | has \`slug:*\`, \`failed\`            |

\`cancel\` and ordinary \`done\` both close the issue — discriminated by the
worklog comment and GitHub's close reason. The \`slug:<slug>\` label is
canonical (lookup + "this is a backlog task" marker via presence). Title is
free text; the spec body carries \`priority\`/\`timeout\`/\`dependencies\` as
YAML frontmatter, same shape as the maildir backends.

## Pipeline

\`todo → doing → done\` (intermediate stages aren't supported in v1).

## ROADMAP

Strategic counterpart at \`backlog/ROADMAP.md\`. See the \`backlog\` skill's \`references/roadmap.md\`.
EOF
  ln -sf AGENTS.md backlog/CLAUDE.md
  [[ -f backlog/ROADMAP.md ]] || cat > backlog/ROADMAP.md <<'EOF'
# ROADMAP

## Intent
<!-- One paragraph. -->

## Principles
<!-- 3–7 short statements. -->

## Current Focus
<!-- 1–3 paragraphs. -->

## Priorities
<!-- Ordered named arcs. -->

## Non-goals
<!-- What we are explicitly not doing right now. -->
EOF
  git add backlog/AGENTS.md backlog/CLAUDE.md backlog/ROADMAP.md
  git commit -m "setup backlog (github-issues)"
}

cmd_add() {
  require_gh
  # Second positional arg used to carry a `category`; the skill no longer
  # tracks it as a label. If the spec author wants to record one, it goes in
  # the body. Silently accept and ignore for backwards-compat.
  local slug="${1:?slug required}"
  local existing; existing=$(issue_for_slug "$slug")
  [[ -n "$existing" ]] && { echo "slug already taken: #${existing}" >&2; exit 1; }
  ensure_label "slug:${slug}" "ededed" "backlog slug"
  gh issue create \
    --title "${slug}" \
    --label "slug:${slug}" \
    --body $'[problem, decisions, phases, acceptance]\n\n---'
}

# Best takeable issue: lowest declared priority, recency tiebreak. Empty stdout
# if nothing's takeable. Takeable = open, has a `slug:*` label, no `doing`.
pick_takeable() {
  gh issue list --state open --limit 1000 \
    --json number,body,updatedAt,labels \
    | jq -r '
        [.[]
          | select(.labels | map(.name) | any(startswith("slug:")) and (contains(["doing"]) | not))]
        | map({
            n: .number,
            p: (try ((.body // "") | capture("(^|\\n)priority:[[:space:]]*(?<v>\\d+)").v | tonumber) catch 999),
            u: .updatedAt
          })
        | sort_by([.p, (.u | fromdateiso8601 * -1)])
        | .[0].n // empty
      '
}

# Returns the branch that won the most recent claim race on issue $1. The
# winner is the earliest `advanced to=doing` line since the most recent
# `retried` line (retry resets the contest). Empty stdout if no claim posted.
claim_winner_branch() {
  local n="$1"
  worklog_lines "$n" | awk '
    /retried/ { delete claims; next }
    /advanced to=doing/ {
      match($0, /branch=[^ ]+/)
      if (RSTART > 0) {
        b = substr($0, RSTART+7, RLENGTH-7)
        if (winner == "") winner = b
      }
    }
    END { if (winner != "") print winner }
  '
}

cmd_take() {
  require_gh
  local slug="${1:-}"
  local n
  if [[ -n "$slug" ]]; then
    n=$(issue_for_slug "$slug")
    [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  else
    n=$(pick_takeable)
    [[ -z "$n" ]] && { echo "no available tasks" >&2; exit 0; }
  fi
  local ts claimer branch
  ts=$(backlog_now); claimer=$(backlog_claimer); branch=$(backlog_branch)
  # Post the claim comment first — comment timestamps are the discriminator.
  post_log "$n" "- ${ts} advanced to=doing claimer=${claimer} branch=${branch}"
  gh issue edit "$n" --add-label "doing" >/dev/null
  # Re-read: did our comment win the race?
  local winner; winner=$(claim_winner_branch "$n")
  if [[ "$winner" != "$branch" ]]; then
    echo "claim conflict on #${n}: won by branch=${winner}" >&2; exit 1
  fi
  gh issue view "$n" --json url -q .url
}

cmd_advance() {
  require_gh
  local slug="${1:?slug required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  local view; view=$(gh issue view "$n" --json state,labels)
  local state; state=$(jq -r .state <<<"$view")
  local has_doing; has_doing=$(jq -r '[.labels[].name] | index("doing") | tostring' <<<"$view")

  if [[ "$state" == "OPEN" && "$has_doing" == "null" ]]; then
    # todo → doing — same path as take
    cmd_take "$slug"
    return
  fi

  if [[ "$state" == "OPEN" ]]; then
    # doing → done
    local ts pr_url line
    ts=$(backlog_now)
    pr_url=$(gh pr view --json url -q .url 2>/dev/null || true)
    line="- ${ts} advanced to=done"
    [[ -n "$pr_url" ]] && line+=" | PR=${pr_url}"
    post_log "$n" "$line"
    gh issue edit "$n" --remove-label "doing" >/dev/null
    gh issue close "$n" --reason completed >/dev/null
    gh issue view "$n" --json url -q .url
    return
  fi

  echo "no forward step from closed: $slug" >&2; exit 1
}

# Find the in-flight issue claimed by the current branch. Errors if 0 or >1.
current_claim() {
  local branch; branch=$(backlog_branch)
  local hits=()
  local n
  while IFS= read -r n; do
    [[ -z "$n" ]] && continue
    local winner; winner=$(claim_winner_branch "$n")
    [[ "$winner" == "$branch" ]] && hits+=("$n")
  done < <(gh issue list --state open --label doing --limit 200 --json number -q '.[].number')
  case "${#hits[@]}" in
    1) printf '%s' "${hits[0]}" ;;
    0) echo "no in-flight claim for branch=${branch}" >&2; return 1 ;;
    *) echo "ambiguous: ${#hits[@]} in-flight claims for branch=${branch}" >&2; return 1 ;;
  esac
}

cmd_progress() {
  require_gh
  local note="${1:?note required}"
  local n; n=$(current_claim) || exit 1
  local ts; ts=$(backlog_now)
  post_log "$n" "- ${ts} progress | ${note}"
  gh issue view "$n" --json url -q .url
}

close_with_log() {
  local n="$1" verb="$2" reason="$3" close_reason="$4" extra_label="${5:-}"
  local ts; ts=$(backlog_now)
  post_log "$n" "- ${ts} ${verb} | ${reason}"
  gh issue edit "$n" --remove-label "doing" >/dev/null 2>&1 || true
  [[ -n "$extra_label" ]] && gh issue edit "$n" --add-label "$extra_label" >/dev/null
  gh issue close "$n" --reason "$close_reason" >/dev/null
}

cmd_cancel() {
  require_gh
  local slug="${1:?slug required}" reason="${2:?reason required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  close_with_log "$n" cancelled "$reason" "not planned"
}

cmd_fail() {
  require_gh
  local slug="${1:?slug required}" reason="${2:?reason required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  close_with_log "$n" failed "$reason" "not planned" "failed"
}

cmd_rescue() {
  require_gh
  local slug="${1:?slug required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  local last_line; last_line=$(worklog_lines "$n" | grep -E '(advanced to=doing|rescued)' | tail -1)
  [[ -z "$last_line" ]] && { echo "no prior claim line on #${n}" >&2; exit 1; }
  local last_ts; last_ts=$(awk '{print $2}' <<<"$last_line")
  local ep; ep=$(backlog_epoch "$last_ts")
  [[ -z "$ep" ]] && { echo "unparseable timestamp: $last_ts" >&2; exit 1; }
  # Timeout lives in body frontmatter — write the body to a tempfile so the
  # shared helper (which works on files) can parse it.
  local tmp; tmp=$(mktemp)
  gh issue view "$n" --json body -q .body > "$tmp"
  local secs; secs=$(backlog_timeout_seconds "$tmp"); rm -f "$tmp"
  (( $(date -u +%s) - ep > secs )) \
    || { echo "claim still active; refusing rescue" >&2; exit 1; }
  local ts claimer branch
  ts=$(backlog_now); claimer=$(backlog_claimer); branch=$(backlog_branch)
  post_log "$n" "- ${ts} rescued claimer=${claimer} branch=${branch}"
  gh issue edit "$n" --add-label "doing" >/dev/null
}

cmd_retry() {
  require_gh
  local slug="${1:?slug required}" reason="${2:?reason required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  local labels; labels=$(gh issue view "$n" --json labels -q '[.labels[].name] | join(",")')
  [[ ",${labels}," == *",failed,"* ]] \
    || { echo "not in failed state: $slug" >&2; exit 1; }
  gh issue edit "$n" --remove-label "failed" >/dev/null
  gh issue reopen "$n" >/dev/null
  local ts; ts=$(backlog_now)
  post_log "$n" "- ${ts} retried | ${reason}"
}

cmd_status() {
  require_gh
  # One fetch, bucket via jq. Only counts issues carrying a `slug:*` label.
  gh issue list --state all --limit 1000 --json number,state,labels \
    | jq -r '
        [.[] | select(.labels | map(.name) | any(startswith("slug:")))]
        | reduce .[] as $i (
            {"todo":0,"doing":0,"done":0,"failed":0};
            ($i.labels | map(.name)) as $L
            | if   $i.state == "OPEN"   and ($L | contains(["doing"]))  then .doing  += 1
              elif $i.state == "OPEN"                                    then .todo   += 1
              elif $i.state == "CLOSED" and ($L | contains(["failed"])) then .failed += 1
              else .done += 1 end
          )
        | "todo: \(.todo)\ndoing: \(.doing)\ndone: \(.done)\nfailed: \(.failed)"
      '
}

cmd_maintain() {
  echo "maintain: load ~/.claude/skills/backlog/references/maintain.md and walk the buckets" >&2
  echo "(advisory walk; benefits from agent judgment)"
}

cmd="${1:-}"
shift || true
case "$cmd" in
  setup)    cmd_setup "$@" ;;
  add)      cmd_add "$@" ;;
  take)     cmd_take "$@" ;;
  advance)  cmd_advance "$@" ;;
  progress) cmd_progress "$@" ;;
  cancel)   cmd_cancel "$@" ;;
  fail)     cmd_fail "$@" ;;
  rescue)   cmd_rescue "$@" ;;
  retry)    cmd_retry "$@" ;;
  status)   cmd_status "$@" ;;
  maintain) cmd_maintain "$@" ;;
  *)        echo "unknown subcommand: $cmd" >&2; exit 1 ;;
esac
