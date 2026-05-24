# Issue tracker: local maildir via the `backlog` skill

Issues, PRDs, and deferred work for this repo live as markdown files under `backlog/` — **not** as GitHub Issues. The `backlog` skill (`~/.claude/skills/backlog/SKILL.md`) owns the convention. **State is encoded in directory location**, not in a frontmatter field.

## File layout

```
backlog/
├── ROADMAP.md                       ← strategic layer (intent, priorities, arcs)
├── AGENTS.md                        ← backend declaration, defaults, pipeline, triage-integration conventions
├── inbox/   <slug>-<category>.md    ← triage queue (needs-triage default; needs-info via frontmatter)
├── todo/    <slug>-<category>.md    ← ready-for-agent (default); ready-for-human via frontmatter
├── doing/   <slug>-<category>.md    ← claimed, in flight (gitignored symlink into git-common-dir)
├── done/    <slug>-<category>.md    ← completed (and cancelled — log line discriminates)
└── failed/  <slug>-<category>.md    ← dead-letter (wontfix + execution failures)
```

- `<slug>` is kebab-case
- `<category>` is the *backlog* category (`plan`, `followup`, `task-list`, `ideas`) — not Matt's `kind:` field
- Pipeline is `inbox → todo → doing → done`; `advance` reads the pipeline from `backlog/AGENTS.md`. `add` lands new tasks in `inbox/` (the first pipeline dir).
- There is no backward verb — work that can't proceed is `fail`ed, and may be `retry`ed back to `inbox/`
- Backend is `maildir-shared`: `doing/` is shared across worktrees via git-common-dir for atomic-claim locking
- A sibling `.out-of-scope/` directory at the repo root holds per-concept rationale for `wontfix`-enhancement decisions (institutional memory beyond the `failed/` log line)

## Frontmatter

Optional — every field has a default:

```yaml
---
priority: 2                  # 1 = highest, default 999 (sorts last)
timeout: 4h                  # humanish (4h, 3d, 2w), default 7d
dependencies:
  other-slug: "why we depend on it"
arc: backlog-roadmap-dogfood # optional link to a ROADMAP.md priority

# Triage-integration fields (preserved, not interpreted by recipes — see triage-labels.md)
kind: bug                    # bug | enhancement (Matt's category role)
needs-info: which iOS version exhibits the bug?     # on inbox/ items only
ready-for-human: design call needed on color palette  # on todo/ items only
out-of-scope: dark-mode      # on failed/ items only — slug under .out-of-scope/
---
```

## Operations

When an engineering skill asks for an issue-tracker operation, translate to a `backlog` verb:

| Skill says | Do this |
|---|---|
| "publish to the issue tracker" (`to-prd`, `to-issues`) | `scripts/backlog.sh add <slug> [category]` — lands in `inbox/`. Edit body with the PRD or issue template, then `advance` to `todo/` once it's ready-for-agent. |
| "fetch the relevant ticket" | Read the matching file under `backlog/{inbox,todo,doing,done,failed}/` |
| "list open issues" | `scripts/backlog.sh status` |
| "comment on an issue" | `scripts/backlog.sh progress "<note>"` — appends below the `---` divider on the active claim. Prefix AI-generated triage comments with `[ai-triage]`. |
| "apply a triage label" | See `triage-labels.md` — triage is directory location + named frontmatter keys (`needs-info:`, `ready-for-human:`, `out-of-scope:`), not a label |
| "promote to ready-for-agent" | `scripts/backlog.sh advance <slug>` — moves `inbox/` → `todo/` |
| "move to ready-for-human" | While in `todo/`, set `ready-for-human: <what's needed>` frontmatter key |
| "move to needs-info" | While in `inbox/`, set `needs-info: <specific questions>` frontmatter key |
| "wontfix" | `scripts/backlog.sh fail <slug> "wontfix: <reason>"` — moves to `failed/`. For enhancements, write `.out-of-scope/<concept>.md` and set `out-of-scope: <concept>` frontmatter on the failed task. |
| "close" | `scripts/backlog.sh advance <slug>` (forward step); `cancel` for in-flight abandonment; `fail` for can't-proceed or wontfix |

The full verb set is `add / take / advance / progress / cancel / fail / rescue / retry / maintain / status / worker`. The script reads `backlog/AGENTS.md` to detect the backend and dispatches. Prefer the script over inline bash. Semantics: `~/.claude/skills/backlog/references/worker.md`.

## File body shape

Each task has a `---` divider with blank lines around it.

- **Above the divider**: what the author meant (problem, decisions, acceptance criteria). Frozen after first commit. `retry` is the only verb that may edit it.
- **Below the divider**: append-only event log written by workers (`advanced`, `progress`, `cancelled`, `failed`, …). Don't rewrite history below the divider.

## ROADMAP

`backlog/ROADMAP.md` is the strategic counterpart — Intent, Principles, Current Focus, Priorities (named arcs), Non-goals. Tasks optionally link via `arc: <name>` frontmatter. Before adding a new task, check whether it fits a current arc or sits outside one — both are fine, but the link helps `worker` and `maintain` reason about priority.

## Why not GitHub Issues

The repo is public, but it's Michael's personal config — work-in-progress notes don't need to be public artifacts. Local markdown also keeps the full body editable in the same editor as the code, version-controlled alongside the change that resolves it, and lets the same file accumulate author-meaning + worker-trace in one place.
