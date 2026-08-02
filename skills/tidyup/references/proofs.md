# Proof standards for "this thread is dead"

Deleting a worktree or branch is safe exactly when its content is somewhere else. These tiers order the evidence from certain to circumstantial; `audit.py` applies them mechanically.

## Tiers

**oid-match** — the local HEAD equals a merged PR's `headRefOid` byte-for-byte. Certain: the exact commit the PR merged from is this one.

**ancestor** — `git merge-base --is-ancestor HEAD origin/<default>` holds. Certain: every commit is reachable from main.

**pr-name-match** — the branch name matches a merged PR's `headRefName`, but the local tip differs (extra commits, or squash rewrote history). Strong but not absolute: the PR merged, yet local commits past the PR head may exist. In practice these are usually re-landed through other PRs (review-loop reactions, counterpart lanes) — when it matters, spot-check whether the extra commits' files match main's content, not `git cherry`, which squash merges defeat.

**none / UNKNOWN** — no merged PR, tip not in main. Either live work or an abandoned exploration; age and the user decide, never the sweep.

## Why ancestry alone under-reports

Squash merging creates a new commit on main with the branch's content but none of its SHAs. Every ancestry-based tool (`branch --merged`, `cherry`, `rev-list --count`) then reports the branch as unmerged/ahead. A branch "15 ahead" whose PR squash-merged may have zero unlanded lines. This is why the audit fetches PR metadata (`gh pr list --state merged --json headRefName,headRefOid`) instead of trusting local graph queries — and why fetching the *full* merged history matters: a 400-PR window left 101 provably-merged branches classified UNKNOWN in the first live run.

## Dirt playbook (DIRTY_MERGED)

- **Untracked scraps** (`?? CODEX_REPORT.md`, logs): noise, delete with the worktree.
- **Modified/staged files**: check whether the same files exist in `origin/main` (`git cat-file -e origin/main:<path>`) — staged next-slice work is often re-landed by later PRs.
- **Unique rolling docs** (handoff.md, session notes): copy to the scratchpad before removal; cite the preserved path in the report.

## Execution gotchas

- Remove nested worktrees deepest-path-first; a parent removed first orphans the child's path.
- Session managers (Orca, Conductor, harness `.claude/worktrees`) track worktrees in their own state — use their CLI to remove where one exists (`orca worktree rm --worktree path:<p> --force`), plain `git worktree remove --force` elsewhere, then `git worktree prune`.
- Redirect the sweep's full output to a log file and read counts from it afterward; the run takes minutes (each removal deletes build trees) and belongs in the background.
- GitHub's auto-delete-head-branch plus stacked PRs means a merge can close children or invalidate parents — worktree cleanup after a merge train needs the PR states re-checked, not assumed.
