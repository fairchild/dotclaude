# Backlog Schema

Canonical spec for backlog file structure, frontmatter, and body format. The skill recipes in `../SKILL.md` implement this; if there's a conflict between the recipes and this doc, the recipes win and this doc needs updating.

## Directory Layout

```
backlog/
  AGENTS.md   # convention pointer for new sessions (optional)
  todo/       # available
  doing/      # claimed, in flight
  done/       # completed (and cancelled, discriminated by log line)
```

Flat `done/` — no time partitioning. If it grows large enough to be annoying (years from now), operators can shard by hand; nothing migrates automatically and no recipe relies on the directory shape.

## Filename

`{task-name}-{category}.md`

- `task-name` — kebab-case
- `category` — one of `plan`, `followup`, `task-list`, `ideas`

Examples:

- `docs-r2-storage-plan.md`
- `session-cache-followups-task-list.md`
- `chronicle-extractor-quality-ideas.md`

Slug = filename minus path and `.md`. Dependencies reference tasks by slug; the agent resolves a slug by walking `todo/`, `doing/`, `done/**`.

## Frontmatter

YAML between two `---` lines. **Author-set at creation and never edited after.** Mutating frontmatter mid-flight is forbidden — state transitions are recorded as appended log lines below the body divider.

```yaml
---
priority: 2                      # 1 = highest, lower number = higher priority
timeout: 3d                      # humanish: 4h, 3d, 2w. Starts at the most recent `started` block. Absent = unbounded.
dependencies:                    # map of slug → reason (reason may be empty string)
  schema-migration: "needs new claim block format"
  auth-refactor: ""
---
```

Three fields, all functional. Additional keys an author adds are preserved but not interpreted by any verb.

### Field rules

- `priority` — integer. Sort order in take's auto-pick is ascending; missing = treated as `999`.
- `timeout` — set once by the author, never by the claimer. Starts at the most recent `started` log line. If the budget is wrong, release with a reason and let someone else re-take with the same budget.
- `dependencies` — map only, no array. Parallel semantics: this task is takeable when every dep slug resolves to a file under `done/**`. Ordering among dependency tasks themselves is encoded in *their* frontmatter, not here.

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

**Above the divider** is the author-set, immutable description. Edits after the first commit go to the log below, not to the description.

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
| `progress`  | progress   | none                           | the note                |
| `completed` | complete   | `PR=<url>` (optional)          | rare                    |
| `released`  | release    | none                           | the reason              |
| `cancelled` | cancel     | none                           | the reason              |
| `reopened`  | reopen     | none                           | the reason              |

### Reading state from the log

| Question                  | How to answer                                                              |
|---------------------------|----------------------------------------------------------------------------|
| Is X claimed?             | Is `backlog/doing/X.md` a regular file?                                    |
| Who claims X?             | `grep -oE 'claimer=[^ ]+' X.md \| tail -1 \| cut -d= -f2`                  |
| What branch?              | `grep -oE 'branch=[^ ]+' X.md \| tail -1 \| cut -d= -f2`                   |
| How old is the claim?     | Timestamp of the most recent `started` line                                |
| What's the PR?            | `grep -oE 'PR=[^ ]+' X.md \| tail -1 \| cut -d= -f2`                       |
| Has it been marked done?  | `grep -q '^- .*completed' X.md`                                            |
| Full history with context | `git log --follow -- backlog/.../X.md` (traces across the maildir renames) |

Cat shows the story in place; `git log` shows the same events with author and ancestry. They stay synchronized because every recipe both appends one bullet AND commits.

### Single-writer rule

Between `take` and `complete` (or `release`/`cancel`), only the claiming agent appends. Enforcement is social — the maildir `git mv` is the actual lock. Two agents writing in parallel branches collide at merge, which is the correct failure.

## Initial AGENTS.md

The `init` recipe writes a short pointer at `backlog/AGENTS.md` so any agent landing in the project knows where to look:

```markdown
# backlog/

Deferred work, one markdown file per task. Location = status:

- `todo/` — available
- `doing/` — claimed, in flight
- `done/` — completed

Use the `backlog` skill (add / take / progress / complete / release / cancel / reopen / groom / status) to interact. Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.
```
