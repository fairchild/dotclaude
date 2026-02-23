# Backlog Grooming

Review pending backlog items, close completed ones, and keep the roadmap accurate.

## When to Groom

- **After merging a PR** that implements a backlog item
- **Start of a maintenance session** when picking up where you left off
- **Weekly** as part of project hygiene

## Review Checklist

For each file in `backlog/*.md`:

1. **Check git history** -- does `git log --oneline --all` mention this feature, branch, or keywords?
2. **Check filesystem** -- do "Files to create" from the plan already exist?
3. **Check ROADMAP.md** -- is this listed as "Active" but no recent commits?
4. **Re-evaluate scope** -- is this still relevant, or has the project moved past it?

## Closing an Item

1. Optionally add retrospective metadata in frontmatter:
   ```yaml
   description: Implemented in PR #87; superseded by auth-v2 rollout.
   ```
2. Move to `backlog/done/`:
   ```bash
   git mv backlog/feature-plan.md backlog/done/feature-plan.md
   ```
3. Update `ROADMAP.md` -- move from Active/Planned to Done

## Handling Stale Items

Items with no activity for 30+ days and no clear path forward:

- **Still valuable?** Re-scope and update the plan
- **Overtaken by events?** Move to `done/` and note why in `description`
- **Too vague?** Demote to `*-ideas.md` or delete

## Detection Script

Run the automated check:

```bash
~/.claude/skills/backlog/scripts/groom.sh [path/to/backlog]
```

The script cross-references pending items against git history and the filesystem to flag likely-completed work. Review its output -- it suggests, you decide.
