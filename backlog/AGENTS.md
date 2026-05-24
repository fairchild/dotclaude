# backlog/

Deferred work, one markdown file per task. Location = status:

- `todo/`  — available
- `doing/` — claimed, in flight (symlink into git-common-dir shared dir)
- `done/`  — completed (and cancelled — discriminated by the `cancelled` log line)
- `failed/` — dead-letter for tasks that couldn't proceed (created on demand)

Use the `backlog` skill (add / advance / progress / cancel / fail / rescue / retry / maintain / status) to interact. There is no backward verb — work that can't proceed is `fail`ed and may be `retry`ed back to `todo/`. Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.

## Backend

`maildir-shared` — `todo/`, `done/`, `failed/` are committed to git; `doing/` is a gitignored symlink into `$(git rev-parse --git-common-dir)/backlog/doing`, shared across all worktrees of this clone. Claim is an atomic file create in the shared dir — exactly one worktree wins when two race. See `~/.claude/skills/backlog/references/backends/maildir-shared.md`.

## Defaults

Frontmatter is optional; recipes apply these defaults when fields are omitted:

- `priority: 999` (earlier value is higher priority — declare to drive auto-pick ordering)
- `timeout: 7d` (override per-task: shorter for fast agent work, longer for human-paced or human-blocked)
- `dependencies: {}` (declare only hard preconditions)

## Pipeline

`inbox → todo → doing → done`

`inbox/` is the triage queue — `add` lands new tasks there. `todo/` holds items that are `ready-for-agent` by default; `take`/`worker` claim from `todo/` only. See `~/.claude/skills/backlog/references/pipeline.md`.

## Triage integration

This repo cooperates with Matt Pocock's `triage`/`to-issues`/`to-prd` skills via two named frontmatter keys whose presence indicates Matt's state and whose value carries the actionable context. See `docs/agents/triage-labels.md` for the full mapping.

- `needs-info: <what's missing — specific questions for the reporter>` — used only on items in `inbox/`. Absence in `inbox/` means `needs-triage` (the default).
- `ready-for-human: <what kind of human work is needed>` — used only on items in `todo/`. Absence in `todo/` means `ready-for-agent` (the default).
- `out-of-scope: <reason or .out-of-scope/<slug>.md link>` — set when a wontfix-enhancement is `fail`ed.
- `kind: bug | enhancement` — Matt's category role; required at triage time.

These are author-set additional fields preserved by every recipe but not interpreted by them. The skill code doesn't gate on them; they're an interoperability convention.

## ROADMAP

Strategic counterpart at `backlog/ROADMAP.md` — Intent, Principles, Current Focus, Priorities (named arcs), Non-goals. Tasks optionally link via `arc: <name>` frontmatter. See `~/.claude/skills/backlog/references/roadmap.md`.
