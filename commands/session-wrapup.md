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
Output a prompt for the next session. The user will copy/paste it to start fresh.

Include:
- What was completed (PR link)
- What's next (backlog item or area)
- Key decisions or context
- `@filename` references for files that should be loaded in context

### 6. Final Commit
```bash
git add backlog/
git commit -m "chore: update backlog for [feature]"
```

Ready to merge PR.
