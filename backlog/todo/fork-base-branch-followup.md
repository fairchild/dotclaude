# Fork Skill: `--base` Flag Support

## Problem Statement

`/fork <branch>` creates a worktree from the current branch. When you're on a
feature branch (e.g., `team-memory`) but want the fork based on `main`, there's
no way to specify that. You have to drop to the `wt` CLI directly and manually
open the new session.

Discovered during a session on `team-memory` branch where context optimization
work needed to be isolated on a branch from `main`, not from `team-memory`.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Flag name | `--base` | Matches `wt` CLI convention |
| Default | Current branch (unchanged) | Backward compatible |

## Implementation

### Phase 1: Add `--base` support

**Files to modify:**
- `skills/fork/SKILL.md` — Update usage, instructions, and examples

**Changes:**
1. Add `--base` to usage section:
   ```
   /fork <branch>              # Fork from current branch
   /fork <branch> --base main  # Fork from specified base branch
   ```

2. Update Step 1 (Determine Mode) to parse `--base <ref>` argument

3. Update Step 3 (Write Handoff) worktree command:
   ```bash
   wt <branch> --base <ref> --context "$HANDOFF"
   ```

**Acceptance criteria:**
- [ ] `/fork my-feature --base main` creates worktree branched from main
- [ ] `/fork my-feature` still works (branches from current branch)
- [ ] `--base` works with both worktree and local modes
- [ ] Help text updated

## Verification Commands

```bash
# Test: fork with --base from a feature branch
git checkout some-feature
# /fork test-branch --base main
# Verify: git -C ~/.worktrees/repo/test-branch log --oneline -1
# Should show main's HEAD, not some-feature's
```

## References

- `skills/fork/SKILL.md` — Current skill definition
- `wt` CLI supports `--base` already — skill just needs to pass it through
