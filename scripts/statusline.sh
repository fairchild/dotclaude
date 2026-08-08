#!/usr/bin/env bash
#
# Claude Code status line.
#
#   statline  detached (3)  Opus 5  $5.79  15%
#   │         │        │    │       │      └── context window used
#   │         │        │    │       └── session cost
#   │         │        │    └── model
#   │         │        └── uncommitted files
#   │         └── branch — shown only when the directory doesn't imply it
#   └── worktree
#
# Everything but the branch and the dirty count arrives on stdin, so this makes
# one jq call and at most two git calls. No cache, no background jobs, no reads
# of the session transcript.
#
# Reached via WORKSPACES_STATUSLINE_FALLBACK; see docs in README.

set -uo pipefail   # no -e: a field that fails should drop out, not truncate the line

BLUE=$'\033[34m' DIM=$'\033[90m' CYAN=$'\033[36m'
YELLOW=$'\033[33m' RED=$'\033[31m' RESET=$'\033[0m'

payload=$(cat)

# One jq call. Cost comes back as integer cents so the shell needs no bc.
fields=$(printf '%s' "$payload" | jq -r '
  [ (.workspace.git_worktree // (.workspace.current_dir // "" | split("/") | last)),
    (.workspace.current_dir // ""),
    (.model.display_name // "" | sub(" *\\(.*\\)$"; "")),
    (.cost.total_cost_usd // 0 | . * 100 | round),
    (.context_window.used_percentage // 0 | round)
  ] | @tsv' 2>/dev/null)
IFS=$'\t' read -r dir cwd model cents ctx <<<"$fields"

branch="" dirty=""
if [[ -n "${cwd:-}" ]] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
    n=$(git -C "$cwd" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    [[ ${n:-0} -gt 0 ]] && dirty="$n"
fi

# Silence when the worktree name already says it; loud when the branch surprises.
[[ -n "$branch" && ( "$branch" == "${dir:-}" || "${branch##*/}" == "${dir:-}" ) ]] && branch=""

out=""
[[ -n "${dir:-}" ]] && out+="${BLUE}${dir}${RESET}"
[[ -n "$branch" ]] && out+=" ${DIM}${branch}${RESET}"
[[ -n "$dirty" ]] && out+=" ${CYAN}(${dirty})${RESET}"
[[ -n "${model:-}" ]] && out+=" ${model}"
[[ ${cents:-0} -gt 0 ]] && out+=$(printf " ${YELLOW}\$%d.%02d${RESET}" $((cents / 100)) $((cents % 100)))

if [[ ${ctx:-0} -gt 0 ]]; then
    if [[ $ctx -ge 80 ]]; then hue=$RED
    elif [[ $ctx -ge 60 ]]; then hue=$YELLOW
    else hue=$DIM
    fi
    out+=" ${hue}${ctx}%${RESET}"
fi

# An empty line renders as an error row, so always emit something.
printf '%s' "${out:- }"
