# Issue tracker: local maildir via the `backlog` skill

Issues, PRDs, and deferred work for this repo live as markdown files under `backlog/` — **not** as GitHub Issues. The `backlog` skill (`~/.claude/skills/backlog/SKILL.md`) owns the convention. **State is encoded in directory location**, not in a frontmatter field.

## File layout

```
backlog/
├── ROADMAP.md                       ← strategic layer (intent, priorities, arcs)
├── AGENTS.md                        ← backend declaration, defaults, pipeline
├── todo/    <slug>-<category>.md    ← available to claim
├── doing/   <slug>-<category>.md    ← claimed, in flight (gitignored symlink into git-common-dir)
├── done/    <slug>-<category>.md    ← completed (and cancelled — log line discriminates)
└── failed/  <slug>-<category>.md    ← dead-letter (created on demand)
```

- `<slug>` is kebab-case
- `<category>` is one of `plan` (most common), `followup`, `task-list`, `ideas`
- Pipeline is `todo → doing → done`; `advance` reads the pipeline from `backlog/AGENTS.md`
- There is no backward verb — work that can't proceed is `fail`ed, and may be `retry`ed back to `todo/`
- Backend is `maildir-shared`: `doing/` is shared across worktrees via git-common-dir for atomic-claim locking

## Frontmatter

Optional — every field has a default:

```yaml
---
priority: 2                  # 1 = highest, default 999 (sorts last)
timeout: 4h                  # humanish (4h, 3d, 2w), default 7d
dependencies:
  other-slug: "why we depend on it"
arc: backlog-roadmap-dogfood # optional link to a ROADMAP.md priority
---
```

## Operations

When an engineering skill asks for an issue-tracker operation, translate to a `backlog` verb:

| Skill says | Do this |
|---|---|
| "publish to the issue tracker" | `scripts/backlog.sh add <slug> [category]`, then edit `backlog/todo/<slug>-<category>.md` |
| "fetch the relevant ticket" | Read the matching file under `backlog/{todo,doing,done,failed}/` |
| "list open issues" | `scripts/backlog.sh status` |
| "comment on an issue" | `scripts/backlog.sh progress "<note>"` — appends below the `---` divider on the active claim |
| "apply a triage label" | See `triage-labels.md` — triage is directory location + `priority:`, not a label |
| "close" | `scripts/backlog.sh advance <slug>` (forward step); `cancel <slug> "<reason>"` or `fail <slug> "<reason>"` for non-completion |

The full verb set is `add / take / advance / progress / cancel / fail / rescue / retry / maintain / status / worker`. The script reads `backlog/AGENTS.md` to detect the backend and dispatches. Prefer the script over inline bash. Semantics: `~/.claude/skills/backlog/references/worker.md`.

## File body shape

Each task has a `---` divider with blank lines around it.

- **Above the divider**: what the author meant (problem, decisions, acceptance criteria). Frozen after first commit. `retry` is the only verb that may edit it.
- **Below the divider**: append-only event log written by workers (`advanced`, `progress`, `cancelled`, `failed`, …). Don't rewrite history below the divider.

## ROADMAP

`backlog/ROADMAP.md` is the strategic counterpart — Intent, Principles, Current Focus, Priorities (named arcs), Non-goals. Tasks optionally link via `arc: <name>` frontmatter. Before adding a new task, check whether it fits a current arc or sits outside one — both are fine, but the link helps `worker` and `maintain` reason about priority.

## Why not GitHub Issues

The repo is public, but it's Michael's personal config — work-in-progress notes don't need to be public artifacts. Local markdown also keeps the full body editable in the same editor as the code, version-controlled alongside the change that resolves it, and lets the same file accumulate author-meaning + worker-trace in one place.
