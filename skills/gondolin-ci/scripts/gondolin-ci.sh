#!/usr/bin/env bash
# Pick a pull request, run one of services' CI suites inside a disposable gondolin VM, and
# watch it go. See docs/gondolin-runner.md in services for what the VM does.
#   gondolin-ci.sh                 list candidates, newest first
#   gondolin-ci.sh run [pr] [suite]  run one; pr defaults to the newest open pull request
set -euo pipefail

repo=${GONDOLIN_CI_REPO:-fairchild/services}
lane=${GONDOLIN_RUNNER_DIR:-$HOME/code/services/scripts/gondolin}

if [ -t 1 ]; then
  dim=$'\033[2m'; bold=$'\033[1m'; cyan=$'\033[36m'; off=$'\033[0m'
else
  dim=''; bold=''; cyan=''; off=''
fi

[ -x "${lane}/run-optin.sh" ] || {
  printf '%s\n' "no runner at ${lane} — set GONDOLIN_RUNNER_DIR" >&2
  exit 1
}

candidates() {
  gh pr list --repo "$repo" --limit "${1:-6}" --json number,title,headRefOid,updatedAt,isDraft \
    --jq '.[] | select(.isDraft | not) | "\(.number)\t\(.headRefOid[0:8])\t\(.updatedAt[11:16])\t\(.title)"'
}

show_list() {
  local heading=$1 limit=$2 skip=${3:-}
  printf '\n%s%s%s\n\n' "$bold" "$heading" "$off"
  local first=1
  while IFS=$'\t' read -r num sha _when title; do
    [ -n "${num:-}" ] || continue
    [ "$num" = "$skip" ] && continue
    if [ "${#title}" -gt 56 ]; then title="${title:0:55}…"; fi
    if [ -z "$skip" ] && [ "$first" = 1 ]; then
      printf '  %s▸ %-5s%s %-56s  %s%s · newest%s\n' "$cyan" "$num" "$off" "$title" "$dim" "$sha" "$off"
      first=0
    else
      printf '    %s%-5s%s %-56s  %s%s%s\n' "$cyan" "$num" "$off" "$title" "$dim" "$sha" "$off"
    fi
  done <<< "$(candidates "$limit")"
}

case "${1:-list}" in
  list | "")
    show_list "Pull requests this laptop can run" 6
    printf '\n  %ssuites%s  lint (default) · python · files · draw     %sauthkit needs macOS, not this lane%s\n' \
      "$dim" "$off" "$dim" "$off"
    printf '  %srun%s     gondolin-ci run [pr] [suite]\n\n' "$dim" "$off"
    ;;
  run)
    pr=${2:-}
    suite=${3:-lint}
    if [ -z "$pr" ]; then
      pr=$(candidates 1 | head -1 | cut -f1)
      [ -n "$pr" ] || { printf 'no open pull requests\n' >&2; exit 1; }
    fi
    status=0
    "${lane}/run-optin.sh" "$pr" "$suite" || status=$?
    show_list "Next" 5 "$pr"
    printf '\n  %sgondolin-ci run <pr> [suite]%s\n\n' "$dim" "$off"
    exit "$status"
    ;;
  *)
    printf 'usage: gondolin-ci.sh [list | run [pr] [suite]]\n' >&2
    exit 2
    ;;
esac
