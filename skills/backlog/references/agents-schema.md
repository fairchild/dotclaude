# backlog/ Directory Setup

If `backlog/` doesn't exist in the project, create it with:

```bash
mkdir -p backlog/done
```

Then create `backlog/AGENTS.md` with the schema documentation:

```markdown
# backlog/

Deferred work items for future sessions. Each file represents work identified as valuable but out of scope for the current PR.

## Frontmatter Schema

Every file must start with YAML frontmatter:

```yaml
---
status: pending          # pending | in-progress | done
category: plan           # plan | followup | task-list | ideas
pr: null                 # PR number that implements this
branch: null             # branch name that implements this
score: null              # 0-5 effectiveness/efficiency rating
retro_summary: null      # one-sentence summary of how it went
completed: null          # YYYY-MM-DD
---
```

## Categories

### plan
Comprehensive design documents for new features.

### followup
Post-merge improvements and tech debt.

### task-list
Collections of related items discovered during other work.

### ideas
Ideas to explore, not yet developed into actionable plans.

## Naming Convention

`{feature}-{category}.md`

## Lifecycle

1. **pending** - Created, waiting to be picked up
2. **in-progress** - Branch created, PR opened
3. **done** - Move file to `backlog/done/`
```
