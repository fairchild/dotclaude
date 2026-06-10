#!/usr/bin/env bash
# gitea backend — backlog tasks live as Gitea issues on a self-hosted Gitea
# instance. Verb semantics are unchanged from the maildir backends; storage
# moves to Gitea's REST API. The repo's open issues *are* the backlog — anything
# open is takeable, non-conformant issues get triaged when encountered.
#
# This is the github-issues backend retargeted at Gitea. Everything that reads
# comment bodies (claim resolution, worklog, rescue) is identical — only the
# transport changes. Two things make the port small:
#
#   * `tea api` is an authenticated passthrough to Gitea's REST API (like
#     `gh api`). It reads the server URL and token from the resolved `tea`
#     login, so this script never sees — and never hardcodes — either. The
#     non-hardcoding requirement is satisfied by construction: the only
#     instance-specific value anywhere is in `~/.config/tea` and `.git/config`,
#     neither committed.
#   * Identity (which server, which repo) comes from a named git remote
#     (default `gitea`) the same way github-issues reads it from `origin` via
#     `gh`. The committed `backlog/AGENTS.md` carries only the remote name and
#     an optional login name — nothing server-specific.
#
# State mapping mirrors github-issues. For the default pipeline:
#
#   todo   = open,   no  `<first-stage>` label
#   doing  = open,   has `<first-stage>` label
#   done   = closed, no  `<failed>` label
#   failed = closed, has `<failed>` label
#
# Gitea has no `completed` vs `not planned` close reason — `cancel` and ordinary
# `done` both just close the issue; the worklog comment (`cancelled` vs
# `advanced to=done`) is the sole discriminator, which `status` already keys on.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$script_dir/lib.sh"

# --- config resolution (the non-hardcoded identity seam) --------------------

# Read a `key: value` from a `## <Section>` block in backlog/AGENTS.md. Mirrors
# the jira backend's reader. Empty string if absent.
section_value() {
  local section="${1:?section required}" key="${2:?key required}" default="${3:-}"
  local found
  found=$(awk -v heading="## ${section}" -v key="$key" '
    $0 == heading { flag=1; next }
    flag && /^## / { exit }
    flag {
      line = $0
      sub(/^[[:space:]]*-?[[:space:]]*/, "", line)
      if (index(line, key ":") == 1) {
        v = substr(line, length(key) + 2)
        sub(/^[[:space:]]+/, "", v); sub(/[[:space:]]+$/, "", v)
        print v; exit
      }
    }
  ' backlog/AGENTS.md 2>/dev/null)
  printf '%s' "${found:-$default}"
}

# Parse `owner/repo` out of a git remote URL. Handles http(s) and ssh/scp forms,
# with or without a trailing `.git`.
remote_owner_repo() {
  local url="$1"
  url="${url%.git}"
  url="${url%/}"
  # Strip scheme + host: http://host:3000/owner/repo, git@host:owner/repo,
  # ssh://git@host:2222/owner/repo all reduce to the last two path segments.
  local path="$url"
  path="${path#*://}"          # drop scheme if present
  path="${path#*@}"            # drop user@ if present
  case "$path" in
    *:*/*) path="${path#*:}" ;;   # scp-style host:owner/repo
    */*)   path="${path#*/}" ;;   # http-style host[:port]/owner/repo -> owner/repo (first seg is host)
  esac
  # `path` may still lead with host segments if there were extra dirs; take the
  # final two segments as owner/repo.
  echo "$path" | awk -F/ '{ if (NF>=2) print $(NF-1)"/"$NF }'
}

# Resolve identity into globals: GITEA_REMOTE, OWNER_REPO, and TEA_AUTH (the
# array of flags that point `tea` at the right login). Precedence:
#   owner/repo : GITEA_REPO env > `## Gitea repo:` > parsed from the git remote
#   login      : GITEA_LOGIN env > `## Gitea login:` > discover from the remote
#   remote     : `## Gitea remote:` > `gitea`
GITEA_REMOTE=""; OWNER_REPO=""; GITEA_LOGIN=""; TEA_AUTH=()
resolve_gitea() {
  GITEA_REMOTE="$(section_value Gitea remote gitea)"
  local remote_url=""
  remote_url=$(git remote get-url "$GITEA_REMOTE" 2>/dev/null || true)

  OWNER_REPO="${GITEA_REPO:-$(section_value Gitea repo "")}"
  if [[ -z "$OWNER_REPO" && -n "$remote_url" ]]; then
    OWNER_REPO="$(remote_owner_repo "$remote_url")"
  fi

  GITEA_LOGIN="${GITEA_LOGIN_OVERRIDE:-$(section_value Gitea login "")}"

  # Auth flags: an explicit login wins; otherwise let tea discover the login
  # from the named remote's host. Either way the URL+token live in tea's config,
  # never here.
  if [[ -n "$GITEA_LOGIN" ]]; then
    TEA_AUTH=(--login "$GITEA_LOGIN")
  elif [[ -n "$remote_url" ]]; then
    TEA_AUTH=(--remote "$GITEA_REMOTE")
  else
    TEA_AUTH=()
  fi
}

require_gitea() {
  command -v tea >/dev/null 2>&1 \
    || { echo "tea CLI not installed; install from https://gitea.com/gitea/tea/releases (or 'brew tap gitea/tea https://gitea.com/gitea/homebrew-tea.git && brew install tea')" >&2; exit 1; }
  command -v jq >/dev/null 2>&1 \
    || { echo "jq not installed; required by gitea backend" >&2; exit 1; }
  resolve_gitea
  [[ -n "$OWNER_REPO" ]] || {
    echo "can't resolve owner/repo — add a '${GITEA_REMOTE:-gitea}' git remote pointing at the Gitea repo:" >&2
    echo "  git remote add ${GITEA_REMOTE:-gitea} <gitea-url>/<owner>/<repo>.git" >&2
    echo "or set '## Gitea repo: <owner>/<repo>' in backlog/AGENTS.md" >&2
    exit 1
  }
  # Smoke test: an authenticated read against the repo. Surfaces missing tea
  # login early with actionable guidance instead of a cascade of API errors.
  gitea_api GET "/repos/${OWNER_REPO}" 2>/dev/null | jq -e '.full_name // .id' >/dev/null 2>&1 || {
    echo "can't reach ${OWNER_REPO} on Gitea — is a tea login configured for this server?" >&2
    echo "  tea login add --name <name> --url <gitea-url> --token <token>" >&2
    echo "(then set '## Gitea login: <name>' in backlog/AGENTS.md, or rely on the '${GITEA_REMOTE}' remote host match)" >&2
    exit 1
  }
}

# --- transport: everything goes through `tea api` ---------------------------

# tea api <METHOD> <path> [extra tea-api args...]. The path is prefixed with
# /api/v1 by tea. Auth (server + token) comes from TEA_AUTH.
gitea_api() {
  local method="$1" path="$2"; shift 2
  # ${arr[@]+...} guards the empty-array expansion under bash 3.2 + `set -u`
  # (TEA_AUTH is empty when neither a login nor a gitea remote is configured).
  tea api -X "$method" ${TEA_AUTH[@]+"${TEA_AUTH[@]}"} "$path" "$@"
}

# Paginated GET of a list endpoint — returns one concatenated JSON array. Gitea
# caps `limit` at 50 by default and requires walking pages, so this is
# mandatory for correctness, not just large repos.
gitea_api_list() {
  local base="$1" sep page=1 limit=50 chunk count acc='[]'
  [[ "$base" == *\?* ]] && sep='&' || sep='?'
  # Break on an empty page, not on `count < limit`: if the instance's
  # MAX_RESPONSE_ITEMS is below our requested limit, a *full* page returns fewer
  # than `limit` items, and `count < limit` would drop everything after it. The
  # page>1000 guard is a runaway backstop against a server that ignores `page`.
  while (( page <= 1000 )); do
    chunk=$(gitea_api GET "${base}${sep}limit=${limit}&page=${page}")
    [[ -z "$chunk" || "$chunk" == "null" ]] && chunk='[]'
    count=$(jq 'length' <<<"$chunk")
    (( count == 0 )) && break
    acc=$(jq -s 'add' <(printf '%s' "$acc") <(printf '%s' "$chunk"))
    (( page++ ))
  done
  printf '%s' "$acc"
}

post_log() {
  local n="$1" line="$2"
  gitea_api POST "/repos/${OWNER_REPO}/issues/${n}/comments" \
    -d "$(jq -n --arg b "$line" '{body:$b}')" >/dev/null
}

# Labels are added/removed by id (the remove endpoint takes an id, not a name),
# so cache the repo's labels once and resolve name -> id locally.
_LABELS_CACHE=""
labels_cache() {
  [[ -n "$_LABELS_CACHE" ]] || _LABELS_CACHE=$(gitea_api_list "/repos/${OWNER_REPO}/labels")
  printf '%s' "$_LABELS_CACHE"
}
label_id() { labels_cache | jq -r --arg n "$1" 'map(select(.name==$n)) | .[0].id // empty'; }

add_label() {
  local n="$1" name="$2" id; id=$(label_id "$name")
  [[ -n "$id" ]] || { echo "no such label on remote: $name" >&2; return 1; }
  gitea_api POST "/repos/${OWNER_REPO}/issues/${n}/labels" -d "{\"labels\":[${id}]}" >/dev/null
}
remove_label() {
  local n="$1" name="$2" id; id=$(label_id "$name")
  [[ -n "$id" ]] || return 0
  gitea_api DELETE "/repos/${OWNER_REPO}/issues/${n}/labels/${id}" >/dev/null 2>&1 || true
}

# Idempotent label create — Gitea has no upsert, so check-then-create.
ensure_label() {
  local name="$1" color="$2" desc="$3"
  [[ -n "$(label_id "$name")" ]] && return 0
  gitea_api POST "/repos/${OWNER_REPO}/labels" \
    -d "$(jq -n --arg n "$name" --arg c "#$color" --arg d "$desc" '{name:$n,color:$c,description:$d}')" >/dev/null
  _LABELS_CACHE=""   # invalidate so the new label is visible to label_id
}

# --- label/state helpers (identical model to github-issues) -----------------

state_label()          { backlog_label "$1" "$1"; }
failed_label()         { backlog_label failed failed; }
inflight_states()      { backlog_inflight_dirs; }
first_inflight_state() { backlog_first_inflight_dir; }

inflight_labels_json() {
  local state
  while IFS= read -r state; do
    [[ -z "$state" ]] && continue
    echo "$(state_label "$state")"
  done < <(inflight_states) | jq -R . | jq -sc .
}

issue_labels_json() { gitea_api GET "/repos/${OWNER_REPO}/issues/${1}" | jq -c '[.labels[].name]'; }
issue_state_field() { gitea_api GET "/repos/${OWNER_REPO}/issues/${1}" | jq -r '.state'; }

# Which in-flight pipeline state an issue is in (last-matched in pipeline order;
# empty if none).
issue_state() {
  local n="$1" labels_json; labels_json=$(issue_labels_json "$n")
  local result="" state label
  while IFS= read -r state; do
    [[ -z "$state" ]] && continue
    label=$(state_label "$state")
    if jq -e --arg l "$label" 'any(. == $l)' <<<"$labels_json" >/dev/null; then
      result="$state"
    fi
  done < <(inflight_states)
  printf '%s' "$result"
}

validate_id() {
  local id="$1"
  [[ "$id" =~ ^#?[0-9]+$ ]] \
    || { echo "expected issue number (got: ${id})" >&2; return 1; }
  id="${id#\#}"
  gitea_api GET "/repos/${OWNER_REPO}/issues/${id}" 2>/dev/null | jq -e '.number' >/dev/null 2>&1 \
    || { echo "no such issue: #${id}" >&2; return 1; }
  printf '%s' "$id"
}

# Comments matching the worklog line shape, chronological. Identical downstream
# to every other backend — the comment body *is* the worklog line.
worklog_lines() {
  local n="$1"
  gitea_api_list "/repos/${OWNER_REPO}/issues/${n}/comments" \
    | jq -r 'sort_by(.created_at) | .[].body' \
    | grep -E '^- [0-9TZ:-]+ ' || true
}

# Branch that currently owns the claim on issue $1 (see github-issues for the
# rules — retried resets, first-stage advance is first-wins, rescued overrides).
claim_winner_branch() {
  local n="$1" first; first=$(first_inflight_state)
  worklog_lines "$n" | awk -v first="$first" '
    function branch_of(line,    p) {
      p = match(line, /branch=[^ ]+/)
      return p ? substr(line, RSTART+7, RLENGTH-7) : ""
    }
    /retried/ { winner = ""; next }
    $0 ~ ("advanced to=" first "( |$)") {
      if (winner == "") winner = branch_of($0)
    }
    /rescued/ {
      b = branch_of($0); if (b != "") winner = b
    }
    END { if (winner != "") print winner }
  '
}

# --- verbs ------------------------------------------------------------------

cmd_setup() {
  command -v tea >/dev/null 2>&1 \
    || { echo "tea CLI not installed; install from https://gitea.com/gitea/tea/releases" >&2; exit 1; }
  command -v jq >/dev/null 2>&1 \
    || { echo "jq not installed; required by gitea backend" >&2; exit 1; }
  [[ -f backlog/AGENTS.md ]] && {
    echo "backlog/AGENTS.md exists — refusing to overwrite" >&2; exit 1
  }

  # Flags: same pipeline/label surface as github-issues, plus gitea identity.
  #   --remote=<name>        git remote that points at the Gitea repo (default gitea)
  #   --login=<name>         tea login to use (default: discover from the remote host)
  #   --pipeline="..."       pipeline declaration
  #   --label-<state>=<name> / --failed-label / --claim-label   label overrides
  local pipeline="todo → doing → done" remote="gitea" login="" arg
  for arg in "$@"; do
    case "$arg" in
      --pipeline=*) pipeline="${arg#--pipeline=}" ;;
      --remote=*)   remote="${arg#--remote=}" ;;
      --login=*)    login="${arg#--login=}" ;;
    esac
  done

  local -a inflight_list=()
  local tok
  while IFS= read -r tok; do
    case "$tok" in todo|done|failed|inbox|'') ;; *) inflight_list+=("$tok") ;; esac
  done < <(echo "$pipeline" | grep -oE '[a-z][a-z0-9-]*')
  [[ ${#inflight_list[@]} -eq 0 ]] && {
    echo "pipeline must declare at least one in-flight stage (got: $pipeline)" >&2; exit 1
  }

  is_valid_role() {
    local target="$1" s
    [[ "$target" == "failed" ]] && return 0
    for s in "${inflight_list[@]}"; do [[ "$s" == "$target" ]] && return 0; done
    return 1
  }

  local failed="failed"
  local -a label_args=()
  for arg in "$@"; do
    case "$arg" in
      --backend=*|--pipeline=*|--remote=*|--login=*) ;;
      --failed-label=*) failed="${arg#--failed-label=}" ;;
      --claim-label=*)  label_args+=("${inflight_list[0]}=${arg#--claim-label=}") ;;
      --label-*)
        local rest="${arg#--label-}" state name
        state="${rest%%=*}"; name="${rest#*=}"
        [[ "$state" == "$rest" || -z "$state" || -z "$name" ]] && {
          echo "malformed flag: $arg (want --label-<state>=<name>)" >&2; exit 1
        }
        is_valid_role "$state" || {
          echo "unknown label role: $state (valid: ${inflight_list[*]} failed)" >&2; exit 1
        }
        if [[ "$state" == "failed" ]]; then failed="$name"; else label_args+=("${state}=${name}"); fi
        ;;
      *) echo "unknown setup flag: $arg" >&2; exit 1 ;;
    esac
  done

  local -a labels_resolved=()
  local s pair k v lbl
  for s in "${inflight_list[@]}"; do
    lbl="$s"
    if [[ ${#label_args[@]} -gt 0 ]]; then
      for pair in "${label_args[@]}"; do
        k="${pair%%=*}"; v="${pair#*=}"; [[ "$k" == "$s" ]] && lbl="$v"
      done
    fi
    labels_resolved+=("$lbl")
  done
  label_for_state() {
    local target="$1" i
    for i in "${!inflight_list[@]}"; do
      [[ "${inflight_list[$i]}" == "$target" ]] && { printf '%s' "${labels_resolved[$i]}"; return; }
    done
  }

  # Resolve identity and verify auth before mutating anything on the remote.
  GITEA_REMOTE="$remote"
  local remote_url; remote_url=$(git remote get-url "$remote" 2>/dev/null || true)
  [[ -n "$remote_url" ]] || {
    echo "no '${remote}' git remote — add one pointing at the Gitea repo first:" >&2
    echo "  git remote add ${remote} <gitea-url>/<owner>/<repo>.git" >&2
    exit 2
  }
  OWNER_REPO="$(remote_owner_repo "$remote_url")"
  [[ -n "$OWNER_REPO" ]] || { echo "can't parse owner/repo from remote: $remote_url" >&2; exit 1; }
  GITEA_LOGIN="$login"
  if [[ -n "$login" ]]; then TEA_AUTH=(--login "$login"); else TEA_AUTH=(--remote "$remote"); fi
  gitea_api GET "/repos/${OWNER_REPO}" 2>/dev/null | jq -e '.full_name // .id' >/dev/null 2>&1 || {
    echo "can't reach ${OWNER_REPO} on Gitea — configure a tea login for this server:" >&2
    echo "  tea login add --name <name> --url <gitea-url> --token <token>" >&2
    echo "then re-run setup with --login=<name>" >&2
    exit 1
  }

  # Create one label per in-flight state, plus the failed label.
  for s in "${inflight_list[@]}"; do
    ensure_label "$(label_for_state "$s")" "fbca04" "backlog: ${s}"
  done
  ensure_label "$failed" "d93f0b" "backlog: dead-lettered; needs retry"

  local first_state="${inflight_list[0]}"
  local first_label; first_label="$(label_for_state "$first_state")"
  local pipeline_arrow="todo"
  for s in "${inflight_list[@]}"; do pipeline_arrow+=" → ${s}"; done
  pipeline_arrow+=" → done"

  local state_table=""
  state_table+=$'| todo     | open        | no in-flight labels      |\n'
  for s in "${inflight_list[@]}"; do
    state_table+="| ${s}     | open        | \`$(label_for_state "$s")\` label     |"$'\n'
  done
  state_table+=$'| done     | closed      | no `'"${failed}"$'` label       |\n'
  state_table+=$'| failed   | closed      | `'"${failed}"$'` label          |'

  local labels_section=""
  for s in "${inflight_list[@]}"; do
    labels_section+="${s}: $(label_for_state "$s")"$'\n'
  done
  labels_section+="failed: ${failed}"

  local gitea_section="remote: ${remote}"
  [[ -n "$login" ]] && gitea_section+=$'\n'"login: ${login}"

  mkdir -p backlog
  cat > backlog/AGENTS.md <<EOF
# backlog/

\`CLAUDE.md\` here is a symlink to this file — read one, not both.

Task state lives in Gitea issues on the repo behind the \`${remote}\` git
remote. The repo's open issues are the backlog — anything open is takeable.
Non-conformant issues (random feature requests, dormant bug reports) get
triaged when a worker encounters them; there's no marker label gating
membership.

## Gitea

${gitea_section}

The server URL and token are **not** stored here — they live in the \`${remote}\`
git remote (\`.git/config\`) and in \`tea\`'s login config
(\`~/.config/tea/config.yml\`), neither committed. To wire a new machine:

    git remote add ${remote} <gitea-url>/${OWNER_REPO}.git
    tea login add --name <name> --url <gitea-url> --token <token>

Then set \`login: <name>\` above, or rely on tea matching the \`${remote}\`
remote's host to a login. Override identity ad hoc with \`GITEA_REPO\` /
\`GITEA_LOGIN_OVERRIDE\` env vars.

## State mapping

| State    | open/closed | labels                   |
|----------|-------------|--------------------------|
${state_table}

## Worklog

Every state transition and progress note is one comment on the issue, in this shape:

    - <ISO-8601 ts> <verb> [args] | <trail>

| Verb                       | Args / trail                                                |
|----------------------------|-------------------------------------------------------------|
| \`advanced to=<state>\`    | for \`<first-in-flight>\`: \`claimer=<who>\` \`branch=<git-branch>\`; for \`done\`: optional \`\| PR=<url>\`; intermediate transitions: no extra args |
| \`progress\`               | trail = \`\| <note>\`                                        |
| \`cancelled\`              | trail = \`\| <reason>\`                                      |
| \`failed\`                 | trail = \`\| <reason>\`                                      |
| \`rescued\`                | \`claimer=<who>\` \`branch=<git-branch>\`                   |
| \`retried\`                | trail = \`\| <reason>\`                                      |

## Claim resolution

The **branch** is the claim identity (agents often share one Gitea account, so assignee isn't reliable). Walking comments chronologically:

- \`retried\` resets the contest (no current winner)
- \`advanced to=${first_state}\` sets the winner only if currently empty (first-wins, catches take-time races)
- \`rescued\` overrides the current winner (deliberate takeover after timeout)

The earliest \`advanced to=${first_state}\` since the most recent \`retried\`, optionally overridden by a later \`rescued\`, is the canonical claimer.

## Operating

These conventions are operable directly via \`tea\` / \`tea api\` — open an issue, add the \`${first_label}\` label, post the right comment. The \`backlog\` skill (\`add / take / advance / progress / cancel / fail / rescue / retry / maintain / status\`) is a convenience layer that automates the patterns (auto-pick by priority, race-resolution at claim time, status counts) but isn't required for any of them. Mix both: skill for batch operations, raw \`tea\` for one-offs.

Tasks are referenced by issue number — \`take 42\` or \`take #42\`. Titles are free text.

## Backend

\`gitea\` — see the \`backlog\` skill's \`references/backends/gitea.md\` for the script's behavior.

## Pipeline

${pipeline_arrow}

(Each in-flight state has a label. \`advance\` moves an issue to the next state in this line — closes the issue when it reaches \`done\`. Add or remove intermediate stages by editing this line; declare each new state in \`## Labels\` below.)

## Labels

${labels_section}

(Each in-flight pipeline state maps to a label. Defaults to the state name itself; override here to align with an existing label vocabulary. \`failed\` is the special dead-letter terminal. Configurable at setup via \`--label-<state>=<name>\` and \`--failed-label=<name>\`; editing this section after \`setup\` requires renaming the labels on the remote to keep them in sync.)

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
  local label_summary=""
  for s in "${inflight_list[@]}"; do label_summary+="${s}=$(label_for_state "$s") "; done
  git commit -m "setup backlog (gitea; ${label_summary}failed=${failed})"
}

cmd_add() {
  require_gitea
  local title="${1:?title required}"
  gitea_api POST "/repos/${OWNER_REPO}/issues" \
    -d "$(jq -n --arg t "$title" --arg b $'[problem, decisions, phases, acceptance]\n\n---' '{title:$t, body:$b}')" \
    | jq -r '.html_url'
}

# Best takeable issue: lowest priority number, recency tiebreak. Takeable =
# open, no in-flight label. `type=issues` keeps PRs out of the running.
pick_takeable() {
  gitea_api_list "/repos/${OWNER_REPO}/issues?state=open&type=issues" \
    | jq -r --argjson inflight "$(inflight_labels_json)" '
        [.[] | select(.labels | map(.name) | any(. as $l | $inflight | index($l) != null) | not)]
        | map({
            n: .number,
            p: (try ((.body // "") | capture("(^|\\n)priority:[[:space:]]*(?<v>\\d+)").v | tonumber) catch 999),
            u: .updated_at
          })
        | sort_by([.p, (try (.u | fromdateiso8601 * -1) catch 0)])
        | .[0].n // empty
      '
}

cmd_take() {
  require_gitea
  local slug="${1:-}" n
  if [[ -n "$slug" ]]; then
    n=$(validate_id "$slug") || exit 1
  else
    n=$(pick_takeable)
    [[ -z "$n" ]] && { echo "no available tasks" >&2; exit 0; }
  fi
  local ts claimer branch first first_lbl
  ts=$(backlog_now); claimer=$(backlog_claimer); branch=$(backlog_branch)
  first=$(first_inflight_state); first_lbl=$(state_label "$first")
  post_log "$n" "- ${ts} advanced to=${first} claimer=${claimer} branch=${branch}"
  add_label "$n" "$first_lbl"
  local winner; winner=$(claim_winner_branch "$n")
  if [[ "$winner" != "$branch" ]]; then
    echo "claim conflict on #${n}: won by branch=${winner}" >&2; exit 1
  fi
  gitea_api GET "/repos/${OWNER_REPO}/issues/${n}" | jq -r '.html_url'
}

cmd_advance() {
  require_gitea
  local slug="${1:?issue number required}" n; n=$(validate_id "$slug") || exit 1
  local state; state=$(issue_state_field "$n")
  if [[ "$state" == "closed" ]]; then
    echo "no forward step from closed: $slug" >&2; exit 1
  fi
  local curr; curr=$(issue_state "$n")
  if [[ -z "$curr" ]]; then
    cmd_take "$slug"; return
  fi
  local next; next=$(backlog_next_dir "$curr")
  [[ -n "$next" ]] || { echo "no next state from \`${curr}\` in declared pipeline" >&2; exit 1; }
  local ts curr_lbl; ts=$(backlog_now); curr_lbl=$(state_label "$curr")
  if [[ "$next" == "done" ]]; then
    local pr_url line
    pr_url=$(gh pr view --json url -q .url 2>/dev/null || true)
    line="- ${ts} advanced to=done"
    [[ -n "$pr_url" ]] && line+=" | PR=${pr_url}"
    post_log "$n" "$line"
    remove_label "$n" "$curr_lbl"
    gitea_api PATCH "/repos/${OWNER_REPO}/issues/${n}" -d '{"state":"closed"}' >/dev/null
  else
    local next_lbl; next_lbl=$(state_label "$next")
    post_log "$n" "- ${ts} advanced to=${next}"
    remove_label "$n" "$curr_lbl"
    add_label "$n" "$next_lbl"
  fi
  gitea_api GET "/repos/${OWNER_REPO}/issues/${n}" | jq -r '.html_url'
}

# In-flight issue claimed by the current branch. Errors on 0 or >1.
current_claim() {
  local branch; branch=$(backlog_branch)
  local hits=() n
  while IFS= read -r n; do
    [[ -z "$n" ]] && continue
    local winner; winner=$(claim_winner_branch "$n")
    [[ "$winner" == "$branch" ]] && hits+=("$n")
  done < <(
    gitea_api_list "/repos/${OWNER_REPO}/issues?state=open&type=issues" \
      | jq -r --argjson inflight "$(inflight_labels_json)" '
          .[] | select(.labels | map(.name) | any(. as $l | $inflight | index($l) != null)) | .number
        '
  )
  case "${#hits[@]}" in
    1) printf '%s' "${hits[0]}" ;;
    0) echo "no in-flight claim for branch=${branch}" >&2; return 1 ;;
    *) echo "ambiguous: ${#hits[@]} in-flight claims for branch=${branch}" >&2; return 1 ;;
  esac
}

cmd_progress() {
  require_gitea
  local note="${1:?note required}" n; n=$(current_claim) || exit 1
  local ts; ts=$(backlog_now)
  post_log "$n" "- ${ts} progress | ${note}"
  gitea_api GET "/repos/${OWNER_REPO}/issues/${n}" | jq -r '.html_url'
}

# Close the issue with a worklog line; optionally stamp an extra label first.
# Gitea has no close reason — the worklog verb is the discriminator.
close_with_log() {
  local n="$1" verb="$2" reason="$3" extra_label="${4:-}"
  local ts; ts=$(backlog_now)
  post_log "$n" "- ${ts} ${verb} | ${reason}"
  local curr; curr=$(issue_state "$n")
  [[ -n "$curr" ]] && remove_label "$n" "$(state_label "$curr")"
  [[ -n "$extra_label" ]] && add_label "$n" "$extra_label"
  gitea_api PATCH "/repos/${OWNER_REPO}/issues/${n}" -d '{"state":"closed"}' >/dev/null
}

cmd_cancel() {
  require_gitea
  local slug="${1:?issue number required}" reason="${2:?reason required}"
  local n; n=$(validate_id "$slug") || exit 1
  close_with_log "$n" cancelled "$reason"
}

cmd_fail() {
  require_gitea
  local slug="${1:?issue number required}" reason="${2:?reason required}"
  local n; n=$(validate_id "$slug") || exit 1
  close_with_log "$n" failed "$reason" "$(failed_label)"
}

cmd_rescue() {
  require_gitea
  local slug="${1:?issue number required}" n; n=$(validate_id "$slug") || exit 1
  local state; state=$(issue_state_field "$n")
  [[ "$state" != "open" ]] && { echo "issue #${n} is closed; nothing to rescue" >&2; exit 1; }
  local first; first=$(first_inflight_state)
  worklog_lines "$n" | grep -qE "(advanced to=${first}( |\$)|rescued)" \
    || { echo "no prior claim line on #${n}" >&2; exit 1; }
  local last_line; last_line=$(worklog_lines "$n" \
    | grep -E '(advanced to=|progress|rescued)' | tail -1)
  [[ -z "$last_line" ]] && { echo "no activity on #${n}" >&2; exit 1; }
  local last_ts; last_ts=$(awk '{print $2}' <<<"$last_line")
  local ep; ep=$(backlog_epoch "$last_ts")
  [[ -z "$ep" ]] && { echo "unparseable timestamp: $last_ts" >&2; exit 1; }
  local tmp; tmp=$(mktemp)
  gitea_api GET "/repos/${OWNER_REPO}/issues/${n}" | jq -r '.body' > "$tmp"
  local secs; secs=$(backlog_timeout_seconds "$tmp"); rm -f "$tmp"
  (( $(date -u +%s) - ep > secs )) \
    || { echo "claim still active; refusing rescue" >&2; exit 1; }
  local ts claimer branch
  ts=$(backlog_now); claimer=$(backlog_claimer); branch=$(backlog_branch)
  post_log "$n" "- ${ts} rescued claimer=${claimer} branch=${branch}"
  local curr; curr=$(issue_state "$n")
  [[ -z "$curr" ]] && add_label "$n" "$(state_label "$first")"
  local winner; winner=$(claim_winner_branch "$n")
  if [[ "$winner" != "$branch" ]]; then
    echo "rescue conflict on #${n}: won by branch=${winner}" >&2; exit 1
  fi
}

cmd_retry() {
  require_gitea
  local slug="${1:?issue number required}" reason="${2:?reason required}"
  local n; n=$(validate_id "$slug") || exit 1
  local labels failed
  labels=$(issue_labels_json "$n" | jq -r 'join(",")')
  failed=$(failed_label)
  [[ ",${labels}," == *",${failed},"* ]] \
    || { echo "not in failed state: $slug" >&2; exit 1; }
  remove_label "$n" "$failed"
  gitea_api PATCH "/repos/${OWNER_REPO}/issues/${n}" -d '{"state":"open"}' >/dev/null
  local ts; ts=$(backlog_now)
  post_log "$n" "- ${ts} retried | ${reason}"
}

cmd_status() {
  require_gitea
  local state_label_map bucket_init output_order failed_lbl
  state_label_map=$({
    printf '{'
    local first=1 s
    while IFS= read -r s; do
      [[ -z "$s" ]] && continue
      [[ $first -eq 1 ]] && first=0 || printf ','
      printf '"%s":"%s"' "$(state_label "$s")" "$s"
    done < <(inflight_states)
    printf '}'
  })
  bucket_init=$({
    printf '{"todo":0'
    local s
    while IFS= read -r s; do [[ -n "$s" ]] && printf ',"%s":0' "$s"; done < <(inflight_states)
    printf ',"done":0,"failed":0}'
  })
  output_order=$({
    printf '["todo"'
    local s
    while IFS= read -r s; do [[ -n "$s" ]] && printf ',"%s"' "$s"; done < <(inflight_states)
    printf ',"done","failed"]'
  })
  failed_lbl=$(failed_label)

  gitea_api_list "/repos/${OWNER_REPO}/issues?state=all&type=issues" \
    | jq -r --argjson init "$bucket_init" \
            --argjson stateMap "$state_label_map" \
            --argjson order "$output_order" \
            --arg failed "$failed_lbl" '
        reduce .[] as $i ($init;
          ($i.labels | map(.name)) as $L
          | if $i.state == "open" then
              ($L | map($stateMap[.] // empty)) as $hit
              | if ($hit | length) > 0 then .[$hit[0]] += 1 else .todo += 1 end
            elif ($L | contains([$failed])) then .failed += 1
            else .done += 1 end
        )
        | . as $b | $order | map("\(.): \($b[.])") | .[]
      '
}

cmd_maintain() {
  echo "maintain: load ~/.claude/skills/backlog/references/maintain.md and references/backends/gitea.md" >&2
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
