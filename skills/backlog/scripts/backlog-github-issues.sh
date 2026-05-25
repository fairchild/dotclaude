#!/usr/bin/env bash
# github-issues backend — backlog tasks live as GitHub Issues on the current
# repo's remote. Verb semantics are unchanged from maildir; storage moves from
# local files to `gh`. The slug is canonical via a `slug:<slug>` label; the
# issue title is human-readable.
#
# Pipeline mapping:
#   todo   = open, unassigned, has label `backlog`
#   doing  = open, assigned,   has labels `backlog` + `backlog:in-flight`
#   done   = closed
#   failed = closed,           has label `backlog:failed`
#
# Claim is `gh issue edit --add-assignee @me` followed by a re-read. If the
# re-read shows we aren't the sole assignee we back off — the assignment API
# isn't compare-and-set, so two workers can briefly co-claim; the loser
# detects via the re-read and unwinds.
#
# Worklog format matches the maildir backends — each state transition or
# progress note is one `- <ts> <verb> ...` line, posted as an issue comment.
# `gh issue view --comments` reconstructs the same chronological log a
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

me() { gh api user -q .login; }

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

cmd_setup() {
  require_gh
  [[ -f backlog/AGENTS.md ]] && {
    echo "backlog/AGENTS.md exists — refusing to overwrite" >&2; exit 1
  }
  local repo; repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)

  ensure_label "backlog"            "0e8a16" "backlog task"
  ensure_label "backlog:in-flight"  "fbca04" "claimed and in progress"
  ensure_label "backlog:cancelled"  "cccccc" "abandoned by claimer"
  ensure_label "backlog:failed"     "d93f0b" "dead-lettered; needs retry"

  mkdir -p backlog
  cat > backlog/AGENTS.md <<EOF
# backlog/

\`CLAUDE.md\` here is a symlink to this file — read one, not both.

Task state lives in GitHub Issues on **${repo}**. There is no local
\`todo/\`/\`doing/\`/\`done/\` tree — issue state plus labels are the queue.

Use the \`backlog\` skill (add / take / advance / progress / cancel / fail /
rescue / retry / maintain / status) to interact. Verbs dispatch to
\`gh issue\` under the hood.

## Backend

\`github-issues\` — see the \`backlog\` skill's \`references/backends/github-issues.md\`.

State mapping:

- todo:   open, unassigned, label \`backlog\`
- doing:  open, assigned,   labels \`backlog\` + \`backlog:in-flight\`
- done:   closed
- failed: closed,           label \`backlog:failed\`

Slug → issue lookup via \`slug:<slug>\` label (canonical). Title is free text.

## Defaults

- \`priority\`, \`timeout\`, \`dependencies\` are read from frontmatter in the
  issue body (same shape as the maildir backends — the body is markdown with
  YAML frontmatter, then the divider, then the spec).
- Arc linkage via \`roadmap:<arc>\` label.

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
  local slug="${1:?slug required}"
  local category="${2:-plan}"
  local existing; existing=$(issue_for_slug "$slug")
  [[ -n "$existing" ]] && { echo "slug already taken: #${existing}" >&2; exit 1; }
  ensure_label "slug:${slug}"        "ededed" "backlog slug"
  ensure_label "category:${category}" "ededed" "backlog category"
  gh issue create \
    --title "${slug}" \
    --label backlog --label "slug:${slug}" --label "category:${category}" \
    --body $'[problem, decisions, phases, acceptance]\n\n---'
}

# Best takeable issue: lowest declared priority, recency tiebreak. Empty stdout
# if nothing's takeable.
pick_takeable() {
  gh issue list \
    --state open --search "no:assignee" --label backlog --limit 200 \
    --json number,body,updatedAt \
    | jq -r '
        map({
          n: .number,
          p: (try ((.body // "") | capture("(^|\\n)priority:[[:space:]]*(?<v>\\d+)").v | tonumber) catch 999),
          u: .updatedAt
        })
        | sort_by([.p, (.u | fromdateiso8601 * -1)])
        | .[0].n // empty
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
  local mine; mine=$(me)
  gh issue edit "$n" --add-assignee "@me" --add-label "backlog:in-flight" >/dev/null
  # Re-read: if we aren't the sole assignee, we lost the race. Back off.
  local assignees; assignees=$(gh issue view "$n" --json assignees -q '[.assignees[].login] | join(",")')
  if [[ "$assignees" != "$mine" ]]; then
    gh issue edit "$n" --remove-assignee "$mine" --remove-label "backlog:in-flight" >/dev/null 2>&1 || true
    echo "claim conflict on #${n}: assignees=${assignees}" >&2; exit 1
  fi
  local ts claimer branch
  ts=$(backlog_now); claimer=$(backlog_claimer); branch=$(backlog_branch)
  post_log "$n" "- ${ts} advanced to=doing claimer=${claimer} branch=${branch}"
  gh issue view "$n" --json url -q .url
}

cmd_advance() {
  require_gh
  local slug="${1:?slug required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  local view; view=$(gh issue view "$n" --json state,assignees)
  local state; state=$(jq -r .state <<<"$view")
  local n_assignees; n_assignees=$(jq -r '.assignees | length' <<<"$view")

  if [[ "$state" == "OPEN" && "$n_assignees" == "0" ]]; then
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
    gh issue edit "$n" --remove-label "backlog:in-flight" >/dev/null
    gh issue close "$n" --reason completed >/dev/null
    gh issue view "$n" --json url -q .url
    return
  fi

  echo "no forward step from closed: $slug" >&2; exit 1
}

# Find the in-flight issue claimed by the current user. Errors if 0 or >1.
current_claim() {
  local mine; mine=$(me)
  local nlist; nlist=$(gh issue list \
    --state open --assignee "$mine" --label "backlog:in-flight" \
    --json number -q '.[].number')
  local count; count=$(printf '%s\n' "$nlist" | grep -c . || true)
  case "$count" in
    1) printf '%s' "$nlist" ;;
    0) echo "no in-flight claim for ${mine}" >&2; return 1 ;;
    *) echo "ambiguous: ${count} in-flight claims for ${mine}" >&2; return 1 ;;
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

close_with_label() {
  local n="$1" verb="$2" reason="$3" label="$4"
  local ts; ts=$(backlog_now)
  post_log "$n" "- ${ts} ${verb} | ${reason}"
  gh issue edit "$n" --remove-label "backlog:in-flight" --add-label "$label" >/dev/null
  gh issue close "$n" --reason "not planned" >/dev/null
}

cmd_cancel() {
  require_gh
  local slug="${1:?slug required}" reason="${2:?reason required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  close_with_label "$n" cancelled "$reason" "backlog:cancelled"
}

cmd_fail() {
  require_gh
  local slug="${1:?slug required}" reason="${2:?reason required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  close_with_label "$n" failed "$reason" "backlog:failed"
}

cmd_rescue() {
  require_gh
  local slug="${1:?slug required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  local last_line; last_line=$(gh issue view "$n" --json comments \
      -q '.comments[].body' \
    | grep -E '^- [0-9TZ:-]+ (advanced|rescued) ' | tail -1)
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
  local mine; mine=$(me)
  local current; current=$(gh issue view "$n" --json assignees -q '[.assignees[].login] | join(",")')
  local a
  for a in ${current//,/ }; do
    [[ "$a" == "$mine" ]] && continue
    gh issue edit "$n" --remove-assignee "$a" >/dev/null
  done
  gh issue edit "$n" --add-assignee "$mine" --add-label "backlog:in-flight" >/dev/null
  local ts claimer branch
  ts=$(backlog_now); claimer=$(backlog_claimer); branch=$(backlog_branch)
  post_log "$n" "- ${ts} rescued claimer=${claimer} branch=${branch}"
}

cmd_retry() {
  require_gh
  local slug="${1:?slug required}" reason="${2:?reason required}"
  local n; n=$(issue_for_slug "$slug")
  [[ -z "$n" ]] && { echo "no such slug: $slug" >&2; exit 1; }
  local labels; labels=$(gh issue view "$n" --json labels -q '[.labels[].name] | join(",")')
  [[ ",${labels}," == *",backlog:failed,"* ]] \
    || { echo "not in failed state: $slug" >&2; exit 1; }
  gh issue edit "$n" --remove-label "backlog:failed" >/dev/null
  gh issue reopen "$n" >/dev/null
  local ts; ts=$(backlog_now)
  post_log "$n" "- ${ts} retried | ${reason}"
}

count_state() {
  # $1: extra args; returns count of matching issues.
  # shellcheck disable=SC2086
  gh issue list $1 --limit 1000 --json number -q 'length'
}

cmd_status() {
  require_gh
  printf "todo: %s\n"   "$(count_state '--state open --search no:assignee --label backlog')"
  printf "doing: %s\n"  "$(count_state '--state open --label backlog:in-flight')"
  # done = closed + backlog, minus failed/cancelled
  local done_count
  done_count=$(gh issue list --state closed --label backlog --limit 1000 \
    --json number,labels \
    -q '[.[] | select(.labels | map(.name) | (contains(["backlog:failed"]) | not) and (contains(["backlog:cancelled"]) | not))] | length')
  printf "done: %s\n"   "$done_count"
  printf "failed: %s\n" "$(count_state '--state closed --label backlog:failed')"
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
