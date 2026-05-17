# Grooming

`groom.sh` is advisory. It detects work that probably needs attention and prints buckets — the operator decides what to act on. Nothing is destructive.

## When to Groom

- After merging a PR that resolved a task
- Start of a session, before `take`
- Weekly hygiene
- Whenever `doing/` feels suspicious

## Buckets

`groom.sh` partitions the backlog into:

### `MERGED BUT NOT MOVED` (safe to auto-fix)

A file in `doing/` whose `pr` field points to a merged PR (or whose `branch` is gone and merged into main). This is the most common real failure — the work shipped, the file just didn't move. Suggested fix: `complete.sh {slug}`. Safe because the merge is the proof.

### `TIMED OUT`

A file in `doing/` where `now - claimed_at > timeout`. Higher signal than generic *quiet* because the task itself declared the budget. Output includes:

- claimed age vs. timeout (`+24h over`)
- branch state (last commit age, alive vs. deleted)
- PR state (open / merged / closed / none)

Suggested action: `release.sh {slug}` or follow up with the claimer.

### `QUIET`

A file in `doing/` with no `timeout`, where:

- claim age > `--quiet-after` (default 7d), AND
- no commits to the file in that window, AND
- branch has no commits in that window (or is gone)

Generic stuckness. Less confident than *timed out*. Same suggested action.

### `UNRESOLVABLE DEPS`

A file in `todo/` or `doing/` referencing a `dependencies:` slug that doesn't exist anywhere in the tree. Usually a typo or rename. Suggested fix: edit the file and either fix the slug or remove the dep.

### `CYCLES`

The dependency graph (across `todo/` and `doing/`) has a cycle. `take --auto` refuses to schedule anything in a cycle. Cycles are listed as `a → b → c → a`. Resolve by editing one of the involved files' `dependencies:` map.

### `OK`

Everything else. Printed as counts, not per-file.

## Flags

- `--quiet-after DUR` — threshold for *quiet* bucket (default `7d`)
- `--no-network` — skip `gh pr view` lookups (faster, but loses *merged but not moved* detection for PRs unknown to local git)

## Operator Loop

1. Run `groom.sh`
2. For each `MERGED BUT NOT MOVED`, run `complete.sh {slug}` — safe
3. For each `TIMED OUT` / `QUIET`, decide: release, follow up, or extend by a progress note from the claimer (claimer can't extend timeout, but can document why work is taking longer)
4. For each `UNRESOLVABLE DEPS` / `CYCLES`, edit the file directly

The script never moves files itself. That's deliberate — `complete`, `release`, etc. are explicit verbs the operator runs after looking at the report.
