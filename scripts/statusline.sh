#!/usr/bin/env bash
#
# Claude Code status line.
#
#   api-docs (3) Opus 5.5 @work $0.43 wk 34% 8%
#   │        │   │        │     │     │      └── context window used
#   │        │   │        │     │     └── week's usage (5h too, from 50%), once a reply reports it
#   │        │   │        │     └── session cost at API prices
#   │        │   │        └── claude-as profile; ⚠ <login> instead when it isn't CLAUDE_AS_ACCOUNT
#   │        │   └── model
#   │        └── uncommitted files
#   └── worktree, then the branch only when the worktree name doesn't imply it
#
# Everything but the branch, the dirty count and the login arrives on stdin, so
# this makes one jq call over stdin, at most two git calls, and one jq read of
# the login record only when CLAUDE_AS_ACCOUNT is set. No cache, no background
# jobs, no reads of the session transcript.
#
# Reached via WORKSPACES_STATUSLINE_FALLBACK; see docs in README.

set -uo pipefail   # no -e: a field that fails should drop out, not truncate the line

BLUE=$'\033[34m' DIM=$'\033[90m' CYAN=$'\033[36m' MAGENTA=$'\033[35m'
YELLOW=$'\033[33m' RED=$'\033[31m' RESET=$'\033[0m'

hue() { # percent → colour: quiet below 60, yellow to 85, red past it
    if (($1 >= 85)); then printf '%s' "$RED"
    elif (($1 >= 60)); then printf '%s' "$YELLOW"
    else printf '%s' "$DIM"
    fi
}

payload=$(cat)

# One jq call. Cost comes back as integer cents so the shell needs no bc; an
# absent usage window comes back as -1. Fields are joined on the unit separator,
# not a tab, so an empty field keeps its place instead of collapsing into the next.
fields=$(printf '%s' "$payload" | jq -r '
  [ (.workspace.git_worktree // (.workspace.current_dir // "" | split("/") | last)),
    (.workspace.current_dir // ""),
    (.model.display_name // "" | sub(" *\\(.*\\)$"; "")),
    (.cost.total_cost_usd // 0 | . * 100 | round),
    (.context_window.used_percentage // 0 | round),
    (.rate_limits.seven_day.used_percentage // -1 | round),
    (.rate_limits.five_hour.used_percentage // -1 | round)
  ] | map(. // "" | tostring) | join("\u001f")' 2>/dev/null)
IFS=$'\x1f' read -r dir cwd model cents ctx week five <<<"$fields"

branch="" dirty=""
if [[ -n "${cwd:-}" ]] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
    n=$(git -C "$cwd" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    [[ ${n:-0} -gt 0 ]] && dirty="$n"
fi

# Silence when the worktree name already says it, including Claude Code's own
# worktree-<name> branches; loud when the branch surprises.
[[ -n "$branch" && ( "${branch#worktree-}" == "${dir:-}" || "${branch##*/}" == "${dir:-}" ) ]] && branch=""

# The login matches when its local part equals the declared one or starts with
# "<declared>.", in any case. Prints the login's local part only when it doesn't.
who=""
if [[ -n "${CLAUDE_AS_ACCOUNT:-}" ]]; then
    wrong=$(jq -r --arg want "$CLAUDE_AS_ACCOUNT" '
      def local: ascii_downcase | split("@") | .[0] // "";
      (.oauthAccount.emailAddress // "" | local) as $have | ($want | local) as $w
      | if $have == $w or ($have | startswith($w + ".")) then empty
        elif $have == "" then "nobody" else $have end' \
      "${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json" 2>/dev/null) || wrong="nobody"
    [[ -n "$wrong" ]] && who="${RED}⚠ ${wrong}${RESET}"
fi
[[ -z "$who" && -n "${CLAUDE_PROFILE:-}" ]] && who="${MAGENTA}@${CLAUDE_PROFILE}${RESET}"

out=""
[[ -n "${dir:-}" ]] && out+="${BLUE}${dir}${RESET}"
[[ -n "$branch" ]] && out+=" ${DIM}${branch}${RESET}"
[[ -n "$dirty" ]] && out+=" ${CYAN}(${dirty})${RESET}"
[[ -n "${model:-}" ]] && out+=" ${model}"
[[ -n "$who" ]] && out+=" ${who}"
((${cents:-0} > 0)) && out+=$(printf " ${YELLOW}\$%d.%02d${RESET}" $((cents / 100)) $((cents % 100)))
((${week:--1} >= 0)) && out+=" $(hue "$week")wk ${week}%${RESET}"
((${five:--1} >= 50)) && out+=" $(hue "$five")5h ${five}%${RESET}"
((${ctx:-0} > 0)) && out+=" $(hue "$ctx")${ctx}%${RESET}"

# An empty line renders as an error row, so always emit something.
printf '%s' "${out:- }"
