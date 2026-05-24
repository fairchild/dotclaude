# backlog/

Deferred work, one markdown file per task. Location = status:

- `todo/`  — available
- `doing/` — claimed, in flight
- `done/`  — completed (and cancelled — discriminated by the `cancelled` log line)
- `failed/` — dead-letter for tasks that couldn't proceed (created on demand)

Use the `backlog` skill (add / advance / progress / cancel / fail / rescue / retry / groom / status) to interact. There is no backward verb — work that can't proceed is `fail`ed and may be `retry`ed back to `todo/`. Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.

## Backend

`maildir-git` — everything in this directory is committed to git; claim is `git mv`. See `~/.claude/skills/backlog/references/backends/maildir-git.md`. (Will migrate to `maildir-shared` once that backend lands; see the task `backlog-pluggable-backends-plan.md`.)

## Defaults

Frontmatter is optional; recipes apply these defaults when fields are omitted:

- `priority: 999` (earlier value is higher priority — declare to drive auto-pick ordering)
- `timeout: 7d` (override per-task: shorter for fast agent work, longer for human-paced or human-blocked)
- `dependencies: {}` (declare only hard preconditions)

## Pipeline

`todo → doing → done`

The default pipeline. To add intermediate states (e.g. `reviewing/`), create the directory and update this line — `advance` reads it. See `~/.claude/skills/backlog/references/pipeline.md`.

## ROADMAP

Strategic counterpart at `backlog/ROADMAP.md` — Intent, Principles, Current Focus, Priorities (named arcs), Non-goals. Tasks optionally link via `arc: <name>` frontmatter. See `~/.claude/skills/backlog/references/roadmap.md`.
