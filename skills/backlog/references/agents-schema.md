# Backlog Schema

Canonical spec for backlog file structure, frontmatter, and body format. The skill recipes in `../SKILL.md` implement this; if there's a conflict between the recipes and this doc, the recipes win and this doc needs updating.

## Directory Layout

```
backlog/
  AGENTS.md   # convention pointer for new sessions (optional)
  todo/       # available
  doing/      # claimed, in flight
  done/       # completed (and cancelled, discriminated by log line)
  failed/     # dead-letter for tasks that exhausted retries (created on demand)
```

Flat `done/` — no time partitioning. If it grows large enough to be annoying (years from now), operators can shard by hand; nothing migrates automatically and no recipe relies on the directory shape.

`failed/` is created on demand by the `fail` recipe; it doesn't exist until the first failure. Operators review it manually and either `reopen` (back to todo/) or `cancel` (terminal in done/).

## Filename

`{task-name}-{category}.md`

- `task-name` — kebab-case
- `category` — one of `plan`, `followup`, `task-list`, `ideas`

Examples:

- `docs-r2-storage-plan.md`
- `session-cache-followups-task-list.md`
- `chronicle-extractor-quality-ideas.md`

Slug = filename minus path and `.md`. Dependencies reference tasks by slug; the agent resolves a slug by walking `todo/`, `doing/`, `done/`, and `failed/` (if present).

## Frontmatter (optional)

YAML between two `---` lines at the top of the file. **Every field has a default**, so a minimal task can omit frontmatter entirely. Author-set at creation and frozen after first commit, with one exception: `reopen` may edit frontmatter to correct issues found during the prior attempt (see SKILL.md's reopen recipe).

```yaml
---
priority: 2                      # 1 = highest. Default: 999 (sorts after every declared priority)
timeout: 3d                      # humanish: 4h, 3d, 2w. Default: 7d
dependencies:                    # map of slug → reason. Default: empty (no deps)
  schema-migration: "needs new claim block format"
---
```

A minimal task with no frontmatter at all is valid:

```markdown
# Quick fix

The login button is misaligned on mobile.

---
```

This gets `priority=999`, `timeout=7d`, `dependencies={}`. Recipes treat it like any other task.

### Defaults and when to override

- **`priority` defaults to `999`** — sorts after every declared priority. Declare a number (1 = highest) when scheduling order matters. With few tasks the default is fine; with many in `todo/`, declare for clarity.
- **`timeout` defaults to `7d`** — long enough for most knowledge work, short enough that a dead claim doesn't linger. Use shorter (`4h`, `1d`) for automated agent tasks; longer (`2w`, `1m`) for tasks needing synchronous human input or external dependencies. Projects with a fundamentally different rhythm can state their convention in `backlog/AGENTS.md`; the recipes still use `7d` as the hardcoded fallback but humans and agents adjust per-task accordingly.
- **`dependencies` defaults to empty** — declare only hard preconditions (the task literally cannot start without X done). Soft "would be nice if X were done first" preferences belong in priority ordering, not deps.

### Other fields

Additional keys an author writes are preserved in the file but not interpreted by any recipe. Useful for ad-hoc project metadata (`assignee:`, `epic:`, etc.) your project's own workflows might read.

## Body

Two halves, divided by a `---` line with blank lines on either side (so markdown renders it as a horizontal rule):

```markdown
# Title

[description: problem, decisions, phases, references, acceptance criteria]

---

- 2026-05-16T14:22:00Z started claimer=conductor:austin-v3 branch=feat/foo
- 2026-05-16T16:45:00Z progress | auth prototype passing locally
- 2026-05-17T11:03:00Z completed PR=https://github.com/.../pull/123
```

**Above the divider** is the author-set description, frozen after first commit *except at reopen*. Reopen permits spec edits because reopen IS a correction (see the reopen recipe in SKILL.md). Otherwise, state changes go to the log below, not to the description.

**Below the divider** is the append-only event log. Each line is one event.

### Log line format

```
- {ISO timestamp} {kind} key=value ... [| free prose]
```

Strictly one line per event. Long-form detail belongs in the commit body — `git show <sha>` retrieves it. The bullet is the index; git is the archive.

Kinds and their KV / prose conventions:

| kind        | written by | KV fields                      | prose after `|`         |
|-------------|------------|--------------------------------|-------------------------|
| `started`   | take       | `claimer=...`, `branch=...`    | rare                    |
| `recovered` | recover    | `claimer=...`, `branch=...`    | rare                    |
| `progress`  | progress   | none                           | the note                |
| `completed` | complete   | `PR=<url>` (optional)          | rare                    |
| `released`  | release    | none                           | the reason              |
| `cancelled` | cancel     | none                           | the reason              |
| `failed`    | fail       | none                           | the reason              |
| `reopened`  | reopen     | none                           | the reason              |

### Reading state from the log

| Question                  | How to answer                                                              |
|---------------------------|----------------------------------------------------------------------------|
| Is X claimed?             | Is `backlog/doing/X.md` a regular file with a live (non-stale) claim?      |
| Who claims X?             | `grep -oE 'claimer=[^ ]+' X.md \| tail -1 \| cut -d= -f2`                  |
| What branch?              | `grep -oE 'branch=[^ ]+' X.md \| tail -1 \| cut -d= -f2`                   |
| How old is the claim?     | Timestamp of the most recent `started` or `recovered` line                 |
| How many recovery attempts? | `grep -c '^- .*recovered' X.md`                                          |
| What's the PR?            | `grep -oE 'PR=[^ ]+' X.md \| tail -1 \| cut -d= -f2-`                      |
| Has it been marked done?  | `grep -q '^- .*completed' X.md`                                            |
| Was it dead-lettered?     | Is `backlog/failed/X.md` a regular file?                                   |
| Full history with context | `git log --follow -- backlog/.../X.md` (traces across the maildir renames) |

Cat shows the story in place; `git log` shows the same events with author and ancestry. They stay synchronized because every recipe both appends one bullet AND commits.

### Single-writer rule

Between `take` and `complete` (or `release`/`cancel`), only the claiming agent appends. Enforcement is social — the maildir `git mv` is the actual lock. Two agents writing in parallel branches collide at merge, which is the correct failure.

