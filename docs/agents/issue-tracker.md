# Issue tracker: local markdown via the `backlog` skill

Issues, PRDs, and deferred work for this repo live as markdown files under `backlog/` — **not** as GitHub Issues. The `backlog` skill (`~/.claude/skills/backlog/SKILL.md`) owns the convention.

## File layout

```
backlog/
├── {task-name}-{category}.md     ← pending
└── done/
    └── {task-name}-{category}.md ← completed
```

- `{task-name}` is kebab-case
- `{category}` is one of `plan` (most common), `followup`, `task-list`, `ideas`
- Pending vs done is derived from location: top-level = pending, `backlog/done/` = done
- Within pending, finer-grained triage state lives in `status:` frontmatter — see `triage-labels.md`

## Frontmatter

Optional, omit unused keys:

```yaml
---
topic: {slug}
relates_to: {after:other-task-plan | until:other-task-plan}
priority: 1   # 1 = highest
description: {short summary for list views}
status: {needs-triage | needs-info | ready-for-agent | ready-for-human | wontfix}
---
```

## Operations

When a skill asks for an issue-tracker operation, translate it to:

| Skill says | Do this |
|---|---|
| "publish to the issue tracker" | Create `backlog/{slug}-plan.md` with the structure from `~/.claude/skills/backlog/SKILL.md` |
| "fetch the relevant ticket" | Read the matching file under `backlog/` (or `backlog/done/`) |
| "list open issues" | `~/.claude/skills/backlog/scripts/status.sh` |
| "comment on an issue" | Append to the file under a `## Updates` section, dated |
| "apply a triage label" | Set or update the `status:` frontmatter field |
| "close" | `git mv backlog/{file} backlog/done/{file}` |

## Grooming

`~/.claude/skills/backlog/scripts/groom.sh` cross-references pending items against git history and the filesystem to flag items that look done but weren't moved to `backlog/done/`. See `~/.claude/skills/backlog/references/grooming.md`.

## Why not GitHub Issues

The repo is public, but it's Michael's personal config — work-in-progress notes don't need to be public artifacts. Local markdown also keeps the full body editable in the same editor as the code, and version-controlled alongside the change that resolves it.
