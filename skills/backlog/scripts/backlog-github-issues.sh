#!/usr/bin/env bash
# github-issues backend — backlog tasks live as GitHub Issues on the current
# repo's remote. Verb semantics are unchanged from maildir; storage moves from
# local files to `gh`. The repo's open issues *are* the backlog — there is no
# separation between "backlog tasks" and "other issues." Anything open is
# takeable. Non-conformant issues (random feature requests, dormant bug
# reports) get handled as they're encountered, not gated by a marker label.
#
# Tasks are referenced by GitHub issue number — the platform's native
# identifier. `take 42` and `take #42` both work; titles are free text and
# the operator/agent reads them out of `gh issue list` to know which number
# to grab. No slug labels, no parallel identifier scheme.
#
# State derives from GitHub-native signals where it can, falling back to
# labels only where the platform can't encode the distinction:
#
#   todo   = open,   no  `doing` label
#   doing  = open,   has `doing` label
#   done   = closed, no  `failed` label
#   failed = closed, has `failed` label
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

# Lazy label-name lookups. Read from backlog/AGENTS.md `## Labels` section
# every call (the file is small and the parser is cheap). Defaults match the
# bare names cmd_setup creates when no labels are configured.
claim_label()  { backlog_label claim  doing;  }
failed_label() { backlog_label failed failed; }

# Validate an id arg and emit the bare issue number. Accepts `42` or `#42`.
# Verifies the issue exists in the repo (one API call) so callers get a clear
# "no such issue" message rather than a cascade of gh errors.
validate_id() {
  local id="$1"
  [[ "$id" =~ ^#?[0-9]+$ ]] \
    || { echo "expected issue number (got: ${id})" >&2; return 1; }
  id="${id#\#}"
  gh issue view "$id" --json number -q .number 2>/dev/null \
    || { echo "no such issue: #${id}" >&2; return 1; }
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
  # Flags: --claim-label and --failed-label let projects align with their
  # existing label vocabulary at setup time (no need to fork the script).
  # --backend=* is the dispatcher's flag — accepted and ignored here.
  local claim="doing" failed="failed"
  for arg in "$@"; do
    case "$arg" in
      --backend=*)      ;;
      --claim-label=*)  claim="${arg#--claim-label=}" ;;
      --failed-label=*) failed="${arg#--failed-label=}" ;;
      *) echo "unknown setup flag: $arg" >&2; exit 1 ;;
    esac
  done

  local repo; repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)

  ensure_label "$claim"  "fbca04" "backlog: claimed and in progress"
  ensure_label "$failed" "d93f0b" "backlog: dead-lettered; needs retry"

  mkdir -p backlog
  cat > backlog/AGENTS.md <<EOF
# backlog/

\`CLAUDE.md\` here is a symlink to this file — read one, not both.

Task state lives in GitHub Issues on **${repo}**. The repo's open issues are
the backlog — anything open is takeable. Non-conformant issues (random
feature requests, dormant bug reports) get triaged when a worker encounters
them; there's no marker label gating membership.

## State mapping

| State    | open/closed | labels                |
|----------|-------------|-----------------------|
| todo     | open        | no \`${claim}\` label |
| doing    | open        | \`${claim}\` label    |
| done     | closed      | no \`${failed}\` label |
| failed   | closed      | \`${failed}\` label   |

## Worklog

Every state transition and progress note is one comment on the issue, in this shape:

    - <ISO-8601 ts> <verb> [args] | <trail>

| Verb                  | Args / trail                                                  |
|-----------------------|---------------------------------------------------------------|
| \`advanced to=doing\` | \`claimer=<who>\` \`branch=<git-branch>\`                     |
| \`advanced to=done\`  | optional \`\| PR=<url>\`                                       |
| \`progress\`          | trail = \`\| <note>\`                                          |
| \`cancelled\`         | trail = \`\| <reason>\`                                        |
| \`failed\`            | trail = \`\| <reason>\`                                        |
| \`rescued\`           | \`claimer=<who>\` \`branch=<git-branch>\`                     |
| \`retried\`           | trail = \`\| <reason>\`                                        |

## Claim resolution

The **branch** is the claim identity (agents often share a GitHub account, so assignee isn't reliable). Walking comments chronologically:

- \`retried\` resets the contest (no current winner)
- \`advanced to=doing\` sets the winner only if currently empty (first-wins, catches take-time races)
- \`rescued\` overrides the current winner (deliberate takeover after timeout)

The earliest \`advanced to=doing\` since the most recent \`retried\`, optionally overridden by a later \`rescued\`, is the canonical claimer.

## Operating

These conventions are operable directly via \`gh issue\` — open an issue, add the \`${claim}\` label, post the right comment. The \`backlog\` skill (\`add / take / advance / progress / cancel / fail / rescue / retry / maintain / status\`) is a convenience layer that automates the patterns (auto-pick by priority, race-resolution at claim time, status counts) but isn't required for any of them. Mix both: skill for batch operations, raw \`gh\` for one-offs.

Tasks are referenced by issue number — \`take 42\` or \`take #42\`. Titles are free text.

## Backend

\`github-issues\` — see the \`backlog\` skill's \`references/backends/github-issues.md\` for the script's behavior.

## Labels

claim:  ${claim}
failed: ${failed}

(Defaults: \`doing\` / \`failed\`. Configurable at setup via \`--claim-label\` / \`--failed-label\`, or by editing this section — but renaming after \`setup\` requires \`gh label rename\` on the remote to keep the existing labels in sync.)

## Pipeline

\`todo → doing → done\` (intermediate stages aren't supported yet).

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
  git commit -m "setup backlog (github-issues; claim=${claim} failed=${failed})"
}

cmd_add() {
  require_gh
  # Single arg is the issue title (can have spaces if quoted). Any extra
  # positional args are silently ignored for backwards-compat with operators
  # who scripted the old `add SLUG CAT` shape.
  local title="${1:?title required}"
  gh issue create \
    --title "${title}" \
    --body $'[problem, decisions, phases, acceptance]\n\n---'
}

# Best takeable issue: lowest declared priority, recency tiebreak. Empty stdout
# if nothing's takeable. Takeable = open, no claim label. Every open issue is
# in the running — non-conformant ones get handled when encountered.
pick_takeable() {
  gh issue list --state open --limit 1000 \
    --json number,body,updatedAt,labels \
    | jq -r --arg claim "$(claim_label)" '
        [.[] | select(.labels | map(.name) | contains([$claim]) | not)]
        | map({
            n: .number,
            p: (try ((.body // "") | capture("(^|\\n)priority:[[:space:]]*(?<v>\\d+)").v | tonumber) catch 999),
            u: .updatedAt
          })
        | sort_by([.p, (.u | fromdateiso8601 * -1)])
        | .[0].n // empty
      '
}

# Returns the branch that currently owns the claim on issue $1. Rules:
#   - `retried` resets the contest (back to no claimant)
#   - `advanced to=doing` sets the winner only if there's no current claimant
#     (earliest-wins for race detection)
#   - `rescued` overrides the current winner (rescue is a deliberate takeover
#     after timeout — the rescuer is the new claimant)
# Empty stdout if no claim has been posted since the last retry.
claim_winner_branch() {
  local n="$1"
  worklog_lines "$n" | awk '
    function branch_of(line,    p, b) {
      p = match(line, /branch=[^ ]+/)
      return p ? substr(line, RSTART+7, RLENGTH-7) : ""
    }
    /retried/ { winner = ""; next }
    /advanced to=doing/ {
      if (winner == "") winner = branch_of($0)
    }
    /rescued/ {
      b = branch_of($0); if (b != "") winner = b
    }
    END { if (winner != "") print winner }
  '
}

cmd_take() {
  require_gh
  local slug="${1:-}"
  local n
  if [[ -n "$slug" ]]; then
    n=$(validate_id "$slug") || exit 1
  else
    n=$(pick_takeable)
    [[ -z "$n" ]] && { echo "no available tasks" >&2; exit 0; }
  fi
  local ts claimer branch
  ts=$(backlog_now); claimer=$(backlog_claimer); branch=$(backlog_branch)
  # Post the claim comment first — comment timestamps are the discriminator.
  post_log "$n" "- ${ts} advanced to=doing claimer=${claimer} branch=${branch}"
  gh issue edit "$n" --add-label "$(claim_label)" >/dev/null
  # Re-read: did our comment win the race?
  local winner; winner=$(claim_winner_branch "$n")
  if [[ "$winner" != "$branch" ]]; then
    echo "claim conflict on #${n}: won by branch=${winner}" >&2; exit 1
  fi
  gh issue view "$n" --json url -q .url
}

cmd_advance() {
  require_gh
  local slug="${1:?issue number required}"
  local n; n=$(validate_id "$slug") || exit 1
  local view; view=$(gh issue view "$n" --json state,labels)
  local state; state=$(jq -r .state <<<"$view")
  local has_claim; has_claim=$(jq -r --arg claim "$(claim_label)" \
    '[.labels[].name] | index($claim) | tostring' <<<"$view")

  if [[ "$state" == "OPEN" && "$has_claim" == "null" ]]; then
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
    gh issue edit "$n" --remove-label "$(claim_label)" >/dev/null
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
  gh issue edit "$n" --remove-label "$(claim_label)" >/dev/null 2>&1 || true
  [[ -n "$extra_label" ]] && gh issue edit "$n" --add-label "$extra_label" >/dev/null
  gh issue close "$n" --reason "$close_reason" >/dev/null
}

cmd_cancel() {
  require_gh
  local slug="${1:?issue number required}" reason="${2:?reason required}"
  local n; n=$(validate_id "$slug") || exit 1
  close_with_log "$n" cancelled "$reason" "not planned"
}

cmd_fail() {
  require_gh
  local slug="${1:?issue number required}" reason="${2:?reason required}"
  local n; n=$(validate_id "$slug") || exit 1
  close_with_log "$n" failed "$reason" "not planned" "$(failed_label)"
}

cmd_rescue() {
  require_gh
  local slug="${1:?issue number required}"
  local n; n=$(validate_id "$slug") || exit 1
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
  gh issue edit "$n" --add-label "$(claim_label)" >/dev/null
  # Symmetry with cmd_take: re-read in case another agent also rescued.
  local winner; winner=$(claim_winner_branch "$n")
  if [[ "$winner" != "$branch" ]]; then
    echo "rescue conflict on #${n}: won by branch=${winner}" >&2; exit 1
  fi
}

cmd_retry() {
  require_gh
  local slug="${1:?issue number required}" reason="${2:?reason required}"
  local n; n=$(validate_id "$slug") || exit 1
  local labels failed
  labels=$(gh issue view "$n" --json labels -q '[.labels[].name] | join(",")')
  failed=$(failed_label)
  [[ ",${labels}," == *",${failed},"* ]] \
    || { echo "not in failed state: $slug" >&2; exit 1; }
  gh issue edit "$n" --remove-label "$failed" >/dev/null
  gh issue reopen "$n" >/dev/null
  local ts; ts=$(backlog_now)
  post_log "$n" "- ${ts} retried | ${reason}"
}

cmd_status() {
  require_gh
  # One fetch, bucket via jq. Every issue in the repo is counted. Bucket
  # names in the output stay as the canonical state names (todo/doing/done/
  # failed) regardless of how the project named the labels — operators
  # compare across projects without translating the output.
  gh issue list --state all --limit 1000 --json number,state,labels \
    | jq -r --arg claim "$(claim_label)" --arg failed "$(failed_label)" '
        reduce .[] as $i (
          {"todo":0,"doing":0,"done":0,"failed":0};
          ($i.labels | map(.name)) as $L
          | if   $i.state == "OPEN"   and ($L | contains([$claim]))  then .doing  += 1
            elif $i.state == "OPEN"                                   then .todo   += 1
            elif $i.state == "CLOSED" and ($L | contains([$failed])) then .failed += 1
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
