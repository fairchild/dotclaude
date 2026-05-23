# Backlog Schema

Canonical spec for backlog file structure, frontmatter, and body format. The skill recipes in `../SKILL.md` implement this; if there's a conflict between the recipes and this doc, the recipes win and this doc needs updating.

## Directory Layout

```
backlog/
  AGENTS.md           # convention pointer for new sessions (optional)
  todo/               # available
  doing/              # claimed, in flight
  done/
    2026/             # year-partitioned at write time
    2026/Q1/          # optional finer subdir if a year gets crowded
    2026/cancelled/   # cancelled tasks land here
```

`done/{YYYY}/` is created at completion time using `date -u +%Y`. Finer subdirs (`done/2026/Q1/`, `done/2026/05/`) are opt-in — if a subdir already exists in the target year that fits the current date, `complete` places the file there; otherwise it lands flat under the year. Operators can split crowded years by hand; nothing migrates automatically.

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

YAML between two `---` lines. **Author-set at creation and never edited after.** Mutating frontmatter mid-flight is forbidden — state transitions are recorded as appended log blocks.

```yaml
---
topic: backlog-tooling           # grouping label, freeform
description: One-line summary    # for list views
priority: 2                      # 1 = highest, lower number = higher priority
timeout: 3d                      # humanish: 4h, 3d, 2w. Starts at the most recent `started` block. Absent = unbounded.
dependencies:                    # map of slug → reason (reason may be empty string)
  schema-migration: "needs new claim block format"
  auth-refactor: ""
---
```

### Field rules

- `priority` — integer. Sort order in take's auto-pick is ascending; missing = treated as `999`.
- `timeout` — set once by the author, never by the claimer. If the budget is wrong, release with a reason and let someone else re-take with the same budget.
- `dependencies` — map only, no array. Parallel semantics: this task is takeable when every dep slug resolves to a file under `done/**`. Ordering among dependency tasks themselves is encoded in *their* frontmatter, not here.

## Body

The body is markdown. Format:

1. `# Title` and task description (problem, decisions, phases, references — whatever fits)
2. A closing `^---$` line to mark the end of the description
3. Zero or more log entries appended over time

Every entry is delimited by a trailing `^---$`. This makes the file:

- **greppable** — `grep -n '^---$' file.md` returns every section boundary as line numbers
- **taillable** — `awk '/^---$/{n++} n>=N{print}'` gives the last N entries
- **append-only** — a heredoc redirect adds a new block without parsing

### Log entry format

Each entry starts with `### {kind} — {ISO timestamp}` and ends with `---` on its own line. The em dash is literal (`U+2014`); the heredoc recipes in SKILL.md use it directly.

```markdown
### started — 2026-05-16T14:22:00Z

claimed by conductor:austin-v3 on branch feat/backlog-maildir

---

### progress — 2026-05-16T16:45:00Z

free-form note, any markdown allowed except a bare `---` line

---

### completed — 2026-05-17T11:03:00Z

marked complete (PR: https://github.com/anthropics/dotclaude/pull/123)

---
```

Entry kinds:

- `started`     — written by `take`. Body: `claimed by <claimer> on branch <branch>`.
- `progress`    — written by `progress`. Body: free-form note.
- `released`    — written by `release`. Body: the reason.
- `cancelled`   — written by `cancel`. Body: the reason.
- `completed`   — written by `complete`. Body: `marked complete` optionally with `(PR: <url>)`.
- `reopened`    — written by `reopen`. Body: the reason.

### Reading claim state from the log

Because claim metadata lives in the body, not frontmatter:

| Question                  | How to answer                                                        |
|---------------------------|----------------------------------------------------------------------|
| Is X claimed?             | Is `backlog/doing/X.md` a regular file?                              |
| Who claims X?             | Last `### started` block's body — `claimed by <claimer> on branch <branch>` |
| How old is the claim?     | ISO in the heading of the last `### started` block                   |
| What branch?              | Same body line as claimer                                            |
| What's the PR?            | Last `### completed` block's body                                    |

Single source of truth: the log. The grep target moves from frontmatter to body; net even on ergonomics.

### Single-writer rule

Between `take` and `complete` (or `release`/`cancel`), only the claiming agent appends to the body. Enforcement is social — the maildir `git mv` is the actual lock. Two agents writing in parallel branches collide at merge, which is the correct failure.

## Initial AGENTS.md

The `init` recipe writes a short pointer at `backlog/AGENTS.md` so any agent landing in the project knows where to look:

```markdown
# backlog/

Deferred work, one markdown file per task. Location = status:

- `todo/` — available
- `doing/` — claimed, in flight
- `done/{YYYY}/` — completed

Use the `backlog` skill (add / take / progress / complete / release / cancel / reopen / groom / status) to interact. Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.
```
