# Session Wrapup

Prepare for PR merge: update backlog and create handoff. Run after `/reflect`.

## Workflow

### 1. Initialize Backlog (if needed)
If `backlog/` doesn't exist:
```bash
mkdir -p backlog/done
```
Create `backlog/CLAUDE.md` with schema from existing pattern.

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
For scope discovered but not implemented:
- Use `/defer` to create new backlog items, OR
- Create files manually following `backlog/CLAUDE.md` schema

### 4. Update Roadmap
Review `backlog/ROADMAP.md`:

**Direction** — Suggest updates based on session insights:
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
Fast capture—don't overthink. Patterns emerge over time.

### 5. Generate Handoff
Create a prompt for the next session including:
- What was completed (PR link)
- What's next (backlog item or area)
- Key decisions or context

### 6. Final Commit
```bash
git add backlog/
git commit -m "chore: update backlog for [feature]"
```
Ready to merge PR.

## Execution

1. Check for `backlog/` — init if missing
2. Read current backlog item being completed
3. Walk through updates
4. Present: summary, learnings, handoff prompt
5. Commit backlog changes
