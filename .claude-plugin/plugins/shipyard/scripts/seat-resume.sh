#!/usr/bin/env bash
# The seats' resume file, named at the two moments a seat is about to lose its context.
#
#   seat-resume.sh pre-compact   PreCompact hook: name the file and what must be in it
#   seat-resume.sh start         SessionStart hook: surface an existing resume file
#   seat-resume.sh path          print the path for this repository and exit
#
# It never writes the resume file. A seat writes its own, because what belongs in it is what the
# seat knows and a script cannot guess: which verdict binds to which head, what it was mid-way
# through. All this does is make sure the path is in front of the seat at the moment it matters,
# and that the next session is told the file exists.
#
#   CLAUDE_PLUGIN_OPTION_SCRATCH_ROOT  where seats keep scratch state (default ~/.worktrees/shipyard)
#   CLAUDE_PLUGIN_OPTION_GOAL_TOKENS   the context goal, for the message only (default 300000)
#
# Installed globally, this runs in every session on the machine, so both hooks stay silent unless
# the working directory is a git repository that already has a resume file. The file's existence is
# the only signal available for telling a seat from an ordinary session, which is why a seat writes
# it on taking the seat rather than when it first needs it.
set -euo pipefail

root=${CLAUDE_PLUGIN_OPTION_SCRATCH_ROOT:-$HOME/.worktrees/shipyard}
root=${root/#\~/$HOME}
goal=${CLAUDE_PLUGIN_OPTION_GOAL_TOKENS:-300000}

# The resume file is per repository, not per checkout: a seat that moves to a second worktree of
# the same repository is the same seat, and the remote is the only identity both share. The
# common git directory is the fallback, because `--show-toplevel` in a worktree names the
# worktree and would split one seat's state across two files.
slug=$(git remote get-url origin 2>/dev/null |
  sed -E 's|\.git$||; s|.*[:/]([^/]+/[^/]+)$|\1|; s|/|-|g') || slug=""
if [[ -z $slug ]]; then
  slug=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null |
    sed -E 's|/\.git/?$||; s|.*/||') || slug=""
fi
[[ -n $slug ]] || exit 0
file="$root/resume/$slug.md"

# python3 builds the JSON because escaping a message into it by hand is a bug waiting for the
# first path with a quote in it. This hook runs in every session on the machine, so a missing
# python3 makes it say nothing rather than fail: the message is advice, and advice is not worth an
# error in somebody else's session.
emit() {
  command -v python3 >/dev/null 2>&1 || return 0
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps({"systemMessage": sys.stdin.read()}))'
}

case ${1:-} in
path)
  echo "$file"
  ;;

pre-compact)
  # No file means this is not a seat, so say nothing. A seat writes its resume file when it takes
  # the seat, which is what makes the file's absence a reliable answer rather than a guess — see
  # the skills. Speaking here instead would narrate shipyard at every global session that
  # compacts in any repository, which is most of them.
  [[ -f $file ]] || exit 0
  # GNU first: `-c` is rejected outright by BSD stat, so it falls through cleanly, while BSD's
  # `-f %m` means filesystem status on GNU and prints something that is not a timestamp.
  age=$(( ($(date +%s) - $(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file")) / 60 ))
  emit "shipyard: resume file is $file, last written ${age}m ago. Before this compaction, bring it up to date — the queue and each item's state, each open pull request with the verdict and the head SHA it binds to, and what this seat was mid-way through. Context goal is ${goal} tokens; what the summary drops, that file is the only copy of."
  ;;

start)
  [[ -f $file ]] || exit 0
  emit "shipyard: a resume file for $slug exists at $file, last written $(date -r "$file" '+%Y-%m-%d %H:%M' 2>/dev/null || echo unknown). Read it before acting, and re-check what it claims — a resume file records what was true when it was written, and a pull request's head, a check's conclusion and a verdict's SHA all move."
  ;;

*)
  echo "seat-resume.sh: expected pre-compact, start or path" >&2
  exit 2
  ;;
esac
