# backlog/

Deferred work, one markdown file per task. Location = status:

- `todo/`  — available
- `doing/` — claimed, in flight
- `done/`  — completed (and cancelled — discriminated by the `cancelled` log line)

Use the `backlog` skill (add / take / recover / progress / complete / release / cancel / fail / reopen / groom / status) to interact. Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.

## Defaults

Frontmatter is optional; recipes apply these defaults when fields are omitted:

- `priority: 999` (low — declare to drive auto-pick ordering)
- `timeout: 7d` (override per-task: shorter for fast agent work, longer for human-paced or human-blocked)
- `dependencies: {}` (declare only hard preconditions)

## ROADMAP

Strategic counterpart at `backlog/ROADMAP.md` — Intent, Principles, Current Focus, Priorities (named arcs), Non-goals. Tasks optionally link via `arc: <name>` frontmatter. See `~/.claude/skills/backlog/references/roadmap.md`.
