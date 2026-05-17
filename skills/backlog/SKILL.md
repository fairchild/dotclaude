---
name: backlog
description: Maildir-style backlog for parallel agents. Tasks live as markdown files in todo/, doing/, or done/{YYYY}/ — location is status, claim is an atomic git mv. Use when adding a deferred work item, picking up the next task, recording progress, completing, cancelling, reopening, or grooming. Single writer per claim, append-only progress log, graph-native dependencies.
license: Apache-2.0
---

# Backlog

A task tracker shaped like a maildir. Each task is one markdown file. Its location *is* its state:

- `backlog/todo/`            — available to claim
- `backlog/doing/`           — claimed, in flight
- `backlog/done/{YYYY}/`     — completed, year-partitioned at write time

Claiming a task is `git mv todo/X.md doing/X.md`. Two agents racing the same task collide at merge — the right failure mode, not silent double-work.

## Lifecycle Verbs

Everyday three:

- `/backlog add`       — create a task in `todo/`
- `/backlog take`      — claim a task (todo → doing). With no argument, picks highest priority whose dependencies are all done.
- `/backlog complete`  — mark done (doing → `done/{YYYY}/`)

In-flight (the claiming agent only):

- `/backlog progress "note"` — append a timestamped note to the body
- `/backlog release`         — give the task back to `todo/` (with reason)

Lifecycle adjustments:

- `/backlog cancel`  — this isn't going to happen (todo or doing → `done/{YYYY}/cancelled/`)
- `/backlog reopen`  — done → todo, strips claim

Inspection:

- `/backlog status`  — what's in each pile
- `/backlog next`    — dry-run of `take --auto`, shows what would be picked
- `/backlog why`     — explain why a task isn't takeable
- `/backlog groom`   — flag stuck, timed-out, merged-but-not-moved, unresolvable deps, cycles

## File Shape

Frontmatter is structured metadata. The body is a task description followed by an append-only log of `started`, `progress`, and lifecycle entries. Every block — frontmatter, body, and each log entry — ends with `^---$`. This makes the file greppable, taillable, and append-friendly with a plain heredoc.

```markdown
---
topic: backlog-tooling
description: Refactor backlog to maildir layout
priority: 2
timeout: 3d
dependencies:
  schema-migration: "needs new claim block format"
claimed_at: 2026-05-16T14:22:00Z
claimed_by: conductor:austin-v3
branch: feat/backlog-maildir
pr: null
---

# Backlog Maildir Refactor

[problem statement, decisions, phases — whatever the task needs]

---

### started — 2026-05-16T14:22:00Z

claimed by conductor:austin-v3 on branch feat/backlog-maildir

---

### progress — 2026-05-16T16:45:00Z

claim.sh + complete.sh ready; starting groom.sh

---
```

See `references/agents-schema.md` for the full schema (frontmatter keys, filename rules, dependencies syntax).

## Rules

- **Single writer per claim.** Only the claiming agent appends to the body between take and complete. Claim is established by the `git mv`; the `started` block is documentation, not the lock.
- **Frontmatter mutates only at lifecycle transitions.** `take` stamps claim fields; `complete` stamps `pr`. Nothing else edits frontmatter mid-flight.
- **Timeout is set by the task author, not the claimer.** Absent = unbounded. Claimers cannot extend or shorten. If the budget is wrong, the right move is a progress note + release, not silent extension.
- **Dependencies are parallel.** `dependencies: {slug: "reason"}` map of task slugs that must be in `done/**` before this one is takeable. Ordering among them is *their* problem (encoded in their own frontmatter). No array form.
- **Year partition at write time.** `complete` derives the year from UTC `date +%Y`. Reopen-then-recomplete lands in the *current* year, not the original.

## Quick Use

```bash
# Add a task interactively
~/.claude/skills/backlog/scripts/add.sh

# Take the next available task (no arg = auto-pick)
~/.claude/skills/backlog/scripts/take.sh

# Or take a specific one
~/.claude/skills/backlog/scripts/take.sh backlog-maildir-plan

# Log progress while working
~/.claude/skills/backlog/scripts/progress.sh "auth migration prototype passing locally"

# Finish
~/.claude/skills/backlog/scripts/complete.sh

# Or hand back if blocked
~/.claude/skills/backlog/scripts/release.sh --reason "blocked on legal review"
```

All scripts accept an optional first positional argument for the backlog directory; default is `backlog` relative to cwd.

## Setting Up backlog/ In a New Project

```bash
~/.claude/skills/backlog/scripts/init.sh
```

Creates `backlog/{todo,doing,done}/` and writes `backlog/AGENTS.md` with the conventions inline. See `references/agents-schema.md` for what gets written.

## Migrating An Existing Flat Backlog

If a project has the old flat layout (items at `backlog/*.md`, completed at `backlog/done/*.md`), run:

```bash
~/.claude/skills/backlog/scripts/migrate.sh [path/to/backlog]
```

Pending items move into `todo/`. Completed items move into `done/{year}/` where year comes from their last git-log timestamp.

## Quality Checklist (when adding a task)

- Enough context that a fresh session can execute without the original conversation
- Specific file paths (with line numbers when relevant)
- Verification commands or acceptance criteria
- Dependencies declared if any (`dependencies: {slug: "why"}`)
- `priority` set if it matters (1 = highest)
- `timeout` set only if the author has a real budget in mind

## References

- `references/agents-schema.md` — Directory layout, frontmatter schema, filename rules, dependencies syntax, body format
- `references/grooming.md` — Stuck-detection buckets and the release/complete loop
- `references/README.md` — Background, design philosophy, related projects
