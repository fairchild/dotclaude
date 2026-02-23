# backlog/ Directory Setup

If `backlog/` doesn't exist in the project, create it with:

```bash
mkdir -p backlog/done
```

Then create `backlog/AGENTS.md` with the conventions:

```markdown
# backlog/

Deferred work items for future sessions. Each file represents work identified as valuable but out of scope for the current PR.

## Metadata

Frontmatter is optional. Use only what you need:

```yaml
---
topic: auth-runtime
relates_to: after:oauth-hardening-plan
priority: 2
description: Follow-up cleanup after OAuth rollout.
---
```

## Categories (from filename suffix)

- `plan` — comprehensive design for new features
- `followup` — post-merge improvements and tech debt
- `task-list` — collections of related items
- `ideas` — early ideas to explore

## Naming Convention

`{task-name}-{category}.md`

Examples:
- `docs-r2-storage-plan.md`
- `session-cache-followups-task-list.md`

Rules:
- `task-name` should be kebab-case
- Category comes from the filename suffix (not frontmatter)
- Status comes from location:
  - `backlog/` = pending
  - `backlog/done/` = done
```
