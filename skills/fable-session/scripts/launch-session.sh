#!/usr/bin/env bash
# Start or bring back a session in a WorkSpaces workspace, and succeed only when it is verified.
#
#   launch-session.sh <repo> <name> <brief-path> [--model <id>] [--effort <level>]
#
# Exit codes: 0 session verified or ready, 1 failed, 2 usage, 3 needs a person.
# The last line of output on success is the session's tmux handle.

set -euo pipefail

ws="${WORKSPACES_BIN:-workspaces}"
model=claude-opus-5-5
effort=xhigh
ref=origin/main

die() { echo "error: $1" >&2; exit "${2:-1}"; }
usage() { die "usage: launch-session.sh <repo> <name> <brief-path> [--model <id>] [--effort <level>]" 2; }
field() { python3 -c "import json,sys;print(json.load(sys.stdin).get('$1') or '')"; }

[ $# -ge 3 ] || usage
repo=$1 name=$2 brief=$3
shift 3
while [ $# -gt 0 ]; do
  case "$1" in
    --model) model=${2:?}; shift 2 ;;
    --effort) effort=${2:?}; shift 2 ;;
    *) usage ;;
  esac
done

[ -f "$brief" ] || die "no brief at $brief"
brief=$(cd "$(dirname "$brief")" && pwd)/$(basename "$brief")
case "$brief$name$model$effort" in *\'*) die "a single quote can't appear in the brief path, name, model or effort" 2 ;; esac
"$ws" help 2>&1 | grep -q 'ws check' || die "this WorkSpaces CLI has no 'ws check'; install a build with it"

report() { # read a ws check result, and exit unless it passed
  local result=$1 status=$2 verdict blocker
  verdict=$(echo "$result" | field verdict)
  blocker=$(echo "$result" | field blocker)
  [ "$status" -eq 0 ] && return 0
  case "$verdict" in
    blocked) die "the session is waiting on a prompt: ${blocker:-unknown}. Answer it in the row, then rerun." 3 ;;
    *) echo "$result" >&2; die "session check failed: ${verdict:-no verdict}" ;;
  esac
}

workspace=$repo/$name
if "$ws" ws path "$workspace" >/dev/null 2>&1; then
  set +e
  out=$("$ws" ws resume "$workspace" --json 2>&1); status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    case "$out" in
      *"is open in a terminal"*) echo "$out" >&2; die "press Return in the open terminal to resume" 3 ;;
      *) die "$out" ;;
    esac
  fi
  handle=$(echo "$out" | field handle)
  set +e
  result=$("$ws" ws check "$handle" --wait 60 --ready --json); status=$?
  set -e
  report "$result" "$status"
else
  "$ws" repo list | awk -v repo="$repo" '$1 == repo { found = 1 } END { exit !found }' || die "repo '$repo' isn't registered: run '$ws repo add <path>'"
  "$ws" ws new "$repo" "$name" --from-ref "$ref" --json >/dev/null
  # The single quotes matter: 'ws check' can only verify a plain claude command.
  command="claude --model $model --effort $effort --name $name 'Read $brief and follow it.'"
  handle=$("$ws" ws launch "$workspace" --cmd "$command" --json | field handle)
  set +e
  result=$("$ws" ws check "$handle" --wait 120 --json); status=$?
  set -e
  report "$result" "$status"
fi

echo "$handle"
