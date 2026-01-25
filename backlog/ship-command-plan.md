---
status: pending
category: plan
pr: null
branch: null
score: null
retro_summary: null
completed: null
---

# /ship Command

## Problem Statement

The current PR workflow requires three manual steps: `/reflect`, then `/session-wrapup`, then merge. Users forget to run these steps, leading to:
- PRs merged without reflection (bugs slip through)
- Backlog items not moved to done
- ROADMAP.md learnings not captured
- Handoff prompts not generated

A single `/ship` command would chain these steps and ensure consistent PR hygiene.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | PR creation + reflect + wrapup | Full lifecycle, not just wrapup |
| PR handling | Create if needed, update if exists | Flexible for different workflows |
| Reflect integration | Run inline, not as separate command | Keep context in same session |
| Failure handling | Stop on reflect issues, prompt for fixes | Don't ship broken code |
| Release suggestion | At end, only for milestones | Avoid release fatigue |

## Architecture

```
/ship
  │
  ├─ 1. Check git status
  │     └─ Uncommitted changes? → Commit them
  │
  ├─ 2. PR handling
  │     ├─ No PR exists? → Create with gh pr create
  │     └─ PR exists? → Update if needed
  │
  ├─ 3. Reflect (inline)
  │     ├─ Review changes with fresh eyes
  │     ├─ Check for bugs, missed cases
  │     └─ Issues found? → Fix before continuing
  │
  ├─ 4. Session Wrapup
  │     ├─ Update backlog items (status: done)
  │     ├─ Move completed items to backlog/done/
  │     ├─ Update ROADMAP.md learnings
  │     └─ Generate handoff prompt
  │
  └─ 5. Final
        ├─ Commit backlog changes
        ├─ Push
        └─ Suggest /release if milestone
```

## Implementation

### Phase 1: Create the Command

**Files to create:**
- `commands/ship.md` - The command definition

**Content:**

```markdown
---
description: Ship a PR - combines reflect, session-wrapup, and PR finalization
---

# Ship

Complete a PR with full hygiene: reflect, wrapup, and prepare for merge.

## Prerequisites

- Work is complete and tested
- On a feature branch (not main)

## Workflow

### Step 1: Git Status Check

Check for uncommitted changes:
\`\`\`bash
git status
\`\`\`

If changes exist:
- Review them with `git diff`
- Commit with appropriate message
- Push to remote

### Step 2: PR Handling

Check if PR exists:
\`\`\`bash
gh pr view --json number,title,state 2>/dev/null
\`\`\`

If no PR:
- Run `git diff main...HEAD` to review all changes
- Create PR with `gh pr create --base main`
- Use concise title (<80 chars) and description (<5 sentences)

If PR exists:
- Verify it's up to date with remote
- Push any new commits

### Step 3: Reflect

Pause and review with fresh eyes:

1. **Goal check**: Did we achieve what we set out to do?
2. **Bug hunt**: Any logic errors, edge cases, or regressions?
3. **Simplification**: Can anything be removed or simplified?
4. **Security**: Any vulnerabilities introduced?

If issues found:
- Fix them before continuing
- Commit and push fixes
- Re-run reflection

### Step 4: Session Wrapup

Run the session-wrapup workflow:

1. **Backlog updates**:
   - Find related backlog item(s)
   - Set `status: done`, `completed: YYYY-MM-DD`
   - Add `retro_summary` (one sentence)
   - Set `pr:` and `branch:`
   - Move to `backlog/done/`

2. **ROADMAP.md**:
   - Remove completed items from Active
   - Add learnings entry with date and PR number

3. **Handoff prompt**:
   - What was completed (PR link)
   - What's next
   - Key context

### Step 5: Final Commit

\`\`\`bash
git add backlog/
git commit -m "chore: update backlog for [feature]"
git push
\`\`\`

### Step 6: Output

Display:
- PR URL (ready for merge)
- Handoff prompt for next session
- Suggest `/release` if this completes a milestone

## Example Output

\`\`\`
✓ Committed 2 files
✓ PR #63 updated
✓ Reflect: No issues found
✓ Backlog: chronicle-smart-suggestions moved to done/
✓ ROADMAP.md: Added learnings for #63
✓ Pushed

PR ready to merge: https://github.com/user/repo/pull/63

---
Handoff prompt for next session:

Merged PR #63 - Chronicle SessionStart hook.
Next: Dashboard enhancements
See @backlog/ROADMAP.md
---

Consider /release? This completes Chronicle Phase 3.
\`\`\`
```

### Phase 2: Add to Superpowers (Optional)

If we want Claude to auto-suggest `/ship`:

**Files to modify:**
- `skills/superpowers/SKILL.md` - Add ship trigger

```markdown
- superpowers:ship: Use when PR is created and work is complete, before ending session
```

**Acceptance criteria:**
- [ ] `/ship` command exists and is executable
- [ ] Chains reflect → wrapup → PR finalization
- [ ] Stops if reflect finds issues
- [ ] Updates backlog and ROADMAP correctly
- [ ] Generates handoff prompt
- [ ] Suggests release for milestones

## Verification Commands

```bash
# Test the command flow (dry run)
/ship

# Verify backlog was updated
ls backlog/done/
cat backlog/ROADMAP.md | head -30

# Verify PR is ready
gh pr view
```

## Rollback Plan

If `/ship` causes issues:
- Revert backlog changes: `git checkout HEAD~1 -- backlog/`
- The command only modifies backlog files and git state
- No production impact

## References

- `commands/session-wrapup.md` - Existing wrapup logic
- `commands/reflect.md` - Reflection prompt
- `skills/release/SKILL.md` - Release skill for milestone detection
