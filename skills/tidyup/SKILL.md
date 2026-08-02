---
name: tidyup
description: Audit and sweep a repo's accumulated worktrees, stale local branches, and in-flight PRs when open threads have sprawled. Use when the user says "tidy up", "too many open threads", "clean up worktrees", "clean up branches", or asks what's still in flight across old sessions. Proof-based classification (squash-merge aware) before anything is deleted.
license: Apache-2.0
---

# Tidyup

Reduce a repo's open threads — worktrees, local branches, open PRs, dirty checkouts — to only what's actually alive. The mechanical classification is a script; the judgment calls (dirt, unique artifacts, PR dispositions) stay with you and the user.

Core fact this skill is built on: in a squash-merge repo, `git branch --merged` and `git cherry` under-report what landed — a branch can sit 15 commits "ahead" with every line already in main. Merged-PR metadata is the ground truth. Proof tiers and gotchas: `references/proofs.md`.

## Workflow

**1. Audit (read-only).** Run from inside the current session's worktree so it self-protects:

```bash
uv run --script ~/.claude/skills/tidyup/scripts/audit.py --json audit.json --plan plan.sh
```

Classifies every worktree and local branch as KEEP (primary, current session, open-PR, default branch), SAFE (provably landed), DIRTY_MERGED (landed but has uncommitted files), or UNKNOWN (no proof — never auto-deleted). Alongside it, survey the rest of the in-flight surface yourself: open PRs with CI/merge state, dirty files in the primary checkout, claimed issues, and any session-manager view of the same worktrees (e.g. `orca worktree ps --json`).

**2. Verify at-risk items.** For each DIRTY_MERGED, characterize the dirt: untracked report scraps are noise; staged or modified files may be a next slice that later landed elsewhere (check whether those files exist in `origin/main`) or genuinely unique work. Preserve unique artifacts (handoff docs, uncommitted notes) to the scratchpad **before** any deletion. For UNKNOWN worktrees, last-commit age is the main signal — months-old never-PR'd explorations are usually abandoned, but that call belongs to the user.

**3. One decision point.** A single AskUserQuestion covering everything: sweep aggressiveness (full / merged-only / sidebar-only), disposition per open PR (merge, fix-and-hold, close, leave), and how to resolve any dirty primary checkout. Batch it — the survey made the options concrete, so one round of answers unlocks the whole execution.

**4. Execute.** Review `plan.sh`, then run it with full output redirected to a log file (no tail pipes — truncate at read time). The plan removes nested worktrees deepest-first, routes session-manager-owned worktrees through their own CLI (`orca worktree rm`) so UI state stays in sync, prunes, then deletes branches. Expect it to be slow: each removal deletes large build trees. PR dispositions execute per the user's answers; respect the repo's merge-authority conventions.

**5. Report.** Counts (removed / kept / survivors), what each survivor is and why it survived, where preserved artifacts live, and any out-of-scope findings (other repos' pending threads) as one-liners.

## Guardrails

- Never delete an UNKNOWN without the user naming it or approving its tier explicitly.
- Branch deletion follows worktree removal, never precedes it (`branch -D` fails on checked-out branches — that failure is a safety net, not an obstacle).
- Deleted branch tips stay reflog-recoverable for ~90 days; deleted dirty files do not — hence preserve-then-delete.
- A primary checkout sitting on a non-default branch with uncommitted files is usually a half-finished automation run — surface it, don't silently absorb it.
