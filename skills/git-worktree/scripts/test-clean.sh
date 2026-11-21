#!/usr/bin/env bash
# Behavior test for `wt clean`: builds a throwaway origin, clone and worktrees,
# stubs gh, and checks which worktrees clean removes, archives and leaves alone.
set -euo pipefail

WT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/wt.sh"
T=$(mktemp -d)
SLEEPER=""
trap '[[ -n "$SLEEPER" ]] && kill "$SLEEPER" 2>/dev/null; rm -rf "$T"' EXIT

export HOME="$T/home" WORKTREES_ROOT="$T/home/.worktrees"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_NOSYSTEM=1
mkdir -p "$HOME" "$T/bin"

# gh stub: a commit listed in $T/merged-shas belongs to a merged pull request
cat > "$T/bin/gh" <<EOF
#!/usr/bin/env bash
sha=\$(echo "\$2" | sed -E 's|.*/commits/([0-9a-f]+)/pulls|\1|')
if [[ -f "$T/gh-down" ]]; then echo "HTTP 401: Bad credentials" >&2; exit 1; fi
grep -qx "\$sha" "$T/merged-shas" 2>/dev/null && echo merged || echo none
EOF
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH"

git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/myrepo" 2>/dev/null
cd "$T/myrepo"
printf 'node_modules/\n' > .gitignore
git add .gitignore && git commit -qm init && git push -q origin main
git remote set-head origin main

add() {  # add <path> <branch|--detach> [start]
    local path="$1" how="$2" start="${3:-main}"
    if [[ "$how" == --detach ]]; then git worktree add -q --detach "$path" "$start"
    else git worktree add -q -b "$how" "$path" "$start"; fi
}
commit_in() { (cd "$1" && echo "$2" > "$2.txt" && git add . && git commit -qm "$2"); }

R="$WORKTREES_ROOT/myrepo-local"   # folder name differs from the origin name, as in the field
add "$R/merged" merged;           commit_in "$R/merged" a
(cd "$R/merged" && git push -q origin merged:main); git fetch -q origin
add "$R/review-1" --detach origin/main
add "$R/squashed" squashed;       commit_in "$R/squashed" b
git -C "$R/squashed" rev-parse HEAD >> "$T/merged-shas"
add "$R/wip" wip;                 commit_in "$R/wip" c
add "$R/fresh" fresh origin/main
add "$R/dirty" --detach origin/main; echo x >> "$R/dirty/.gitignore"
add "$R/notes" --detach origin/main; echo n > "$R/notes/notes.md"; mkdir -p "$R/notes/node_modules/pkg"
add "$R/busy" --detach origin/main
busy_log="$HOME/.claude/projects/$(cd "$R/busy" && pwd -P | sed 's|[^a-zA-Z0-9]|-|g')"  # Claude Code keys sessions by physical cwd
mkdir -p "$busy_log" && touch "$busy_log/s.jsonl"
add "$R/serving" --detach origin/main
(cd "$R/serving" && exec sleep 300) & SLEEPER=$!
add "$T/myrepo/.claude/worktrees/agent-1" --detach origin/main
add "$R/unchecked" unchecked;     commit_in "$R/unchecked" d
mkdir -p "$WORKTREES_ROOT/gone/x" && echo "gitdir: $T/nowhere/.git/worktrees/x" > "$WORKTREES_ROOT/gone/x/.git"

fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

# GitHub unreachable: the squash-merged worktree must be left alone, loudly
touch "$T/gh-down"
out=$("$WT" clean --dry-run 2>&1) || true
check "gh failure is reported, not read as unmerged" '[[ "$out" == *"could not ask GitHub"* ]]'
rm "$T/gh-down"

out=$("$WT" clean --all --dry-run 2>&1) || true
check "dry run touches nothing" '[[ -d "$R/merged" && -d "$R/squashed" ]]'
check "dry run reports the orphan" '[[ "$out" == *"orphan   gone/x"* ]]'

"$WT" clean --all --delete-branch >/dev/null 2>&1 || true
check "branch merged into main: removed"         '[[ ! -e "$R/merged" ]]'
check "merged branch deleted"                    '! git show-ref -q refs/heads/merged'
check "detached review checkout: removed"        '[[ ! -e "$R/review-1" ]]'
check "squash-merged (PR lookup): removed"       '[[ ! -e "$R/squashed" ]]'
check "harness worktree outside root: removed"   '[[ ! -e "$T/myrepo/.claude/worktrees/agent-1" ]]'
check "unmerged branch: kept"                    '[[ -d "$R/wip" ]] && git show-ref -q refs/heads/wip'
check "branch just cut, no commits yet: kept"    '[[ -d "$R/fresh" ]] && git show-ref -q refs/heads/fresh'
check "unmerged, PR none: kept"                 '[[ -d "$R/unchecked" ]]'
check "uncommitted changes: kept"                '[[ -d "$R/dirty" ]]'
check "active Claude session: kept"              '[[ -d "$R/busy" ]]'
check "process running inside: kept"             '[[ -d "$R/serving" ]]'
check "untracked files: archived, not removed"   '[[ ! -e "$R/notes" && -f "$WORKTREES_ROOT/.archive/myrepo-local/notes/notes.md" ]]'
check "archive drops ignored files"              '[[ ! -e "$WORKTREES_ROOT/.archive/myrepo-local/notes/node_modules" ]]'
check "orphan left alone"                        '[[ -f "$WORKTREES_ROOT/gone/x/.git" ]]'
check "git no longer lists retired worktrees"    '! git worktree list | grep -q "/merged\|/review-1\|/notes"'

exit $fail
