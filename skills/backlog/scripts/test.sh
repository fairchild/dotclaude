#!/usr/bin/env bash
# Full-cycle test harness for both backends.
# Creates temp repos under TMPDIR, runs each verb, asserts state, cleans up.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKLOG="$script_dir/backlog.sh"

# Counters live in tmpfiles so subshells can update them.
PASS_FILE=$(mktemp); FAIL_FILE=$(mktemp)
echo 0 > "$PASS_FILE"; echo 0 > "$FAIL_FILE"
trap 'rm -f "$PASS_FILE" "$FAIL_FILE"' EXIT
ok() { echo "  PASS: $*"; n=$(cat "$PASS_FILE"); echo $((n+1)) > "$PASS_FILE"; }
nok() { echo "  FAIL: $*" >&2; n=$(cat "$FAIL_FILE"); echo $((n+1)) > "$FAIL_FILE"; }

# ---------- maildir-git ----------
test_maildir_git() {
  echo "=== maildir-git ==="
  local tmp; tmp=$(mktemp -d)
  ( cd "$tmp"
    git init -q -b main
    git config user.email t@t && git config user.name t
    git commit -qm "root" --allow-empty

    "$BACKLOG" setup --backend=maildir-git >/dev/null
    [[ -f backlog/AGENTS.md ]] && ok "setup wrote AGENTS.md" || nok "setup missing AGENTS.md"
    grep -q "maildir-git" backlog/AGENTS.md && ok "AGENTS.md declares backend" || nok "no backend declaration"

    "$BACKLOG" add sample plan >/dev/null
    [[ -f backlog/todo/sample-plan.md ]] && ok "add created todo file" || nok "add missing file"

    "$BACKLOG" take sample-plan >/dev/null
    [[ -f backlog/doing/sample-plan.md ]] && ok "take moved to doing" || nok "take missing file in doing"
    grep -q 'advanced to=doing' backlog/doing/sample-plan.md && ok "claim log line present" || nok "no claim log"

    "$BACKLOG" progress "checkpoint" >/dev/null
    grep -q 'progress | checkpoint' backlog/doing/sample-plan.md && ok "progress note appended" || nok "no progress log"

    "$BACKLOG" advance sample-plan >/dev/null
    [[ -f backlog/done/sample-plan.md ]] && ok "advance to done worked" || nok "advance to done failed"
    grep -q 'advanced to=done' backlog/done/sample-plan.md && ok "completion log present" || nok "no completion log"

    # Cancel
    "$BACKLOG" add ditch plan >/dev/null
    "$BACKLOG" take ditch-plan >/dev/null
    "$BACKLOG" cancel ditch-plan "not needed" >/dev/null
    [[ -f backlog/done/ditch-plan.md ]] && ok "cancel moved to done" || nok "cancel failed"
    grep -q 'cancelled | not needed' backlog/done/ditch-plan.md && ok "cancel log line present" || nok "no cancel log"

    # Fail + retry
    "$BACKLOG" add blocked plan >/dev/null
    "$BACKLOG" take blocked-plan >/dev/null
    "$BACKLOG" fail blocked-plan "external blocker" >/dev/null
    [[ -f backlog/failed/blocked-plan.md ]] && ok "fail moved to failed" || nok "fail failed"
    "$BACKLOG" retry blocked-plan "unblocked" >/dev/null
    [[ -f backlog/todo/blocked-plan.md ]] && ok "retry moved back to todo" || nok "retry failed"

    # Status
    out=$("$BACKLOG" status)
    grep -q "^todo:" <<<"$out" && grep -q "^doing:" <<<"$out" && ok "status shows piles" || nok "status output malformed"
  )
  rm -rf "$tmp"
}

# ---------- maildir-shared (in-repo) ----------
test_maildir_shared() {
  echo "=== maildir-shared (single worktree) ==="
  local tmp; tmp=$(mktemp -d)
  ( cd "$tmp"
    git init -q -b main
    git config user.email t@t && git config user.name t
    git commit -qm "root" --allow-empty

    "$BACKLOG" setup --backend=maildir-shared >/dev/null
    [[ -L backlog/doing ]] && ok "setup created doing symlink" || nok "no symlink"
    grep -q "^backlog/doing$" .gitignore && ok "gitignore entry added" || nok "no gitignore entry"
    grep -q "maildir-shared" backlog/AGENTS.md && ok "AGENTS.md declares backend" || nok "no backend declaration"
    [[ -z "$(git status --short backlog/doing 2>/dev/null)" ]] && ok "doing/ symlink not surfaced by git status" || nok "symlink showing in git status"

    "$BACKLOG" add sample plan >/dev/null
    "$BACKLOG" take sample-plan >/dev/null

    shared_doing="$(git rev-parse --git-common-dir)/backlog/doing"
    [[ -f "$shared_doing/sample-plan.md" ]] && ok "take stored claim in shared dir" || nok "no file in shared dir"
    [[ ! -f backlog/todo/sample-plan.md ]] && ok "todo file git-removed" || nok "todo file still present"
    grep -q 'advanced to=doing' "$shared_doing/sample-plan.md" && ok "claim log present in shared" || nok "no claim log"

    "$BACKLOG" progress "shared checkpoint" >/dev/null
    grep -q 'progress | shared checkpoint' "$shared_doing/sample-plan.md" && ok "progress appended to shared" || nok "no progress log"

    "$BACKLOG" advance sample-plan >/dev/null
    [[ -f backlog/done/sample-plan.md ]] && ok "advance moved shared → done in tree" || nok "completion failed"
    [[ ! -f "$shared_doing/sample-plan.md" ]] && ok "shared file removed after completion" || nok "shared file lingered"
    grep -q 'progress | shared checkpoint' backlog/done/sample-plan.md && ok "worklog preserved through completion" || nok "log lost on completion"

    # Symlink self-heal
    rm backlog/doing
    "$BACKLOG" status >/dev/null
    [[ -L backlog/doing ]] && ok "symlink self-healed on next verb" || nok "symlink not restored"
  )
  rm -rf "$tmp"
}

# ---------- cross-worktree race ----------
test_cross_worktree_race() {
  echo "=== cross-worktree race ==="
  local tmp wt_a wt_b
  tmp=$(mktemp -d)
  wt_a="${tmp}-a"
  wt_b="${tmp}-b"
  ( cd "$tmp"
    git init -q -b main
    git config user.email t@t && git config user.name t
    git commit -qm "root" --allow-empty

    "$BACKLOG" setup --backend=maildir-shared >/dev/null
    "$BACKLOG" add race plan >/dev/null

    git worktree add -q "$wt_a" -b feat/a
    git worktree add -q "$wt_b" -b feat/b

    # Both worktrees attempt to claim simultaneously
    out_a=$( (cd "$wt_a" && "$BACKLOG" take race-plan 2>&1) || true )
    out_b=$( (cd "$wt_b" && "$BACKLOG" take race-plan 2>&1) || true )

    conflict_a=$(echo "$out_a" | grep -c 'claim conflict' || true)
    conflict_b=$(echo "$out_b" | grep -c 'claim conflict' || true)

    local won_total=0
    [[ -d "$(git rev-parse --git-common-dir)/backlog/doing" ]] && \
      won_total=$(find "$(git rev-parse --git-common-dir)/backlog/doing" -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$won_total" -eq 1 ]]; then
      ok "exactly one worktree won the cross-worktree race"
    else
      nok "race resulted in $won_total claims (expected 1)"
    fi
    if [[ "$conflict_a" -eq 1 || "$conflict_b" -eq 1 ]]; then
      ok "loser reported claim conflict"
    else
      nok "no claim conflict reported (out_a=[$out_a] out_b=[$out_b])"
    fi

    git worktree remove --force "$wt_a" 2>/dev/null || true
    git worktree remove --force "$wt_b" 2>/dev/null || true
  )
  rm -rf "$tmp" "$wt_a" "$wt_b"
}

test_maildir_git
test_maildir_shared
test_cross_worktree_race

echo
echo "=== summary ==="
pass=$(cat "$PASS_FILE"); fail=$(cat "$FAIL_FILE")
echo "passed: $pass"
echo "failed: $fail"
[[ "$fail" -eq 0 ]] || exit 1
