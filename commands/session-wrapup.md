# Session Wrapup

The final step before merging a PR. Run after `/reflect`.

## Purpose

Capture what we learned, update artifacts, and create a handoff prompt for the next session. This ensures continuity across sessions and builds a knowledge base that accumulates over time.

The handoff prompt is deliberately manual—you copy/paste it to start the next session. This friction ensures wrapup truly is the last step before merge.

## Workflow

### 1. Initialize (if needed)
```bash
mkdir -p backlog/done
```

If `backlog/ROADMAP.md` doesn't exist, create it:
```markdown
# Roadmap

## Direction
<!-- Current goals and priorities -->

## Learnings
<!-- Accumulated insights from past sessions -->
```

### 2. Update Completed Items
For the backlog item(s) completed in this PR:
- Set `status: done`
- Set `completed: YYYY-MM-DD`
- Add brief `retro_summary` (one sentence)
- Set `pr:` and `branch:` if not already set
- Optionally set `score:` (0-5 effectiveness rating)
- Move file to `backlog/done/`

### 3. Capture Deferred Work
For scope discovered but not implemented, use `/defer` or create manually:
```yaml
---
status: pending
category: followup  # or: plan, task-list, ideas
pr: null
branch: null
---
```

### 4. Update Roadmap
Review `backlog/ROADMAP.md`:

**Direction** — Suggest updates based on session insights, if any:
- New priorities that emerged
- Goals that should shift
- Directions no longer relevant

**Learnings** — Append with date, milestone, and PR:
```markdown
### YYYY-MM-DD — milestone name (#PR)
- What worked well
- What caused friction
- Anything worth documenting
```

### 5. Generate Handoff

**5a. Write handoff.md**

Write detailed handoff to repo root (`handoff.md`):

```markdown
# Session Handoff

## Current Task
{Brief description of what we completed}

## Progress
- {Key accomplishments}
- {State of the codebase}

## Key Decisions
- **{topic}**: {choice} — {rationale}
- **{topic}**: {choice} — {rationale}

## Next Steps
1. {Recommended next action}
2. {Follow-up work}

## Relevant Files
- `path/to/file` — {why it matters}

## Open Questions
- {Unresolved decisions or blockers}

---
*Session completed on {date}*
*PR: #{number} — {title}*
```

**5b. Git handling**

Check if `handoff.md` is tracked:
```bash
git ls-files --error-unmatch handoff.md 2>/dev/null
```

- If tracked (exit 0) → include in final commit
- If untracked (exit 1) → leave untracked

**5c. Output summary**

Output a short, copy-pastable prompt:

```
Completed: {brief description} (PR #{number})
Next: {recommended next action}
See @handoff.md for full context
```

### 6. Final Commit
```bash
git add backlog/

# Include handoff.md only if already tracked
if git ls-files --error-unmatch handoff.md 2>/dev/null; then
  git add handoff.md
fi

git commit -m "chore: update backlog for [feature]"
```

Ready to merge PR.

### 7. Consider Release
If this PR completes a milestone (not just a task), suggest running `/release` to:
- Bump version
- Generate changelog from commits
- Create GitHub Release

Milestones often span multiple PRs—suggest release when meaningful capability is complete, not after every PR.
