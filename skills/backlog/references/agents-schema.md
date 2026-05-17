# Backlog Schema

The canonical spec for backlog file structure, frontmatter, and body format. The scripts under `scripts/` implement this; if there's a conflict between this doc and the scripts, the scripts win and this doc needs updating.

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

`done/{YYYY}/` is created at completion time using `date -u +%Y`. Finer subdirs (e.g. `done/2026/Q1/` or `done/2026/05/`) are opt-in — if a subdir already exists in the target year that fits the current date, `complete.sh` will place the file there; otherwise it lands flat under the year. Operators can split crowded years by hand; nothing migrates automatically.

## Filename

`{task-name}-{category}.md`

- `task-name` — kebab-case
- `category` — one of `plan`, `followup`, `task-list`, `ideas`

Examples:

- `docs-r2-storage-plan.md`
- `session-cache-followups-task-list.md`
- `chronicle-extractor-quality-ideas.md`

Slug = filename minus path and `.md`. Dependencies reference tasks by slug; the scripts resolve a slug by walking `todo/`, `doing/`, `done/**`.

## Frontmatter

YAML between two `---` lines. All keys are optional except where noted.

```yaml
---
# Author-set (creation time)
topic: backlog-tooling           # grouping label, freeform
description: One-line summary    # for list views
priority: 2                      # 1 = highest, lower number = higher priority
timeout: 3d                      # humanish: 4h, 3d, 2w. Starts at claimed_at. Absent = unbounded.
dependencies:                    # map of slug → reason (reason may be empty string)
  schema-migration: "needs new claim block format"
  auth-refactor: ""

# Claim fields (stamped by take.sh, cleared by release.sh / reopen.sh)
claimed_at: 2026-05-16T14:22:00Z # UTC ISO 8601
claimed_by: conductor:austin-v3  # agent/session/workspace id
branch: feat/backlog-maildir     # where work is happening
pr: null                         # stamped by complete.sh once known
---
```

### Field rules

- `priority` — integer. Sort order in `take --auto` is ascending; missing = treated as `999`.
- `timeout` — set once, by the author, never by the claimer. Mutating it mid-flight is forbidden by convention; if the budget is wrong, release with a reason.
- `dependencies` — map only, no array. Parallel semantics: this task is takeable when every dep slug resolves to a file under `done/**`. Ordering among dependency tasks themselves is encoded in *their* frontmatter, not here.
- `claimed_at` / `claimed_by` / `branch` — written by `take.sh` atomically with the `git mv`. Stripped by `release.sh` and `reopen.sh`.
- `pr` — written by `complete.sh` if it can detect the PR (from `gh pr view` on the branch). Null otherwise.

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

Each entry starts with `### {kind} — {ISO timestamp}` and ends with `---` on its own line.

```markdown
### started — 2026-05-16T14:22:00Z

claimed by conductor:austin-v3 on branch feat/backlog-maildir

---

### progress — 2026-05-16T16:45:00Z

free-form note, any markdown allowed except a bare `---` line

---

### completed — 2026-05-17T11:03:00Z

PR #123 merged to main

---
```

Entry kinds:

- `started`     — written by `take.sh`
- `progress`    — written by `progress.sh` (the only kind the agent invokes directly)
- `released`    — written by `release.sh` (entry stays; the file moves back to `todo/`)
- `cancelled`   — written by `cancel.sh`
- `completed`   — written by `complete.sh`
- `reopened`    — written by `reopen.sh`

### Single-writer rule

Between `take` and `complete` (or `release`/`cancel`), only the claiming agent appends to the body. Enforcement is social — the maildir `git mv` is the actual lock. Two agents writing in parallel branches will collide at merge, which is the correct failure.

## Initial AGENTS.md

`init.sh` writes a short pointer at `backlog/AGENTS.md` so any agent landing in the project knows where to look:

```markdown
# backlog/

Deferred work, one markdown file per task. Location = status:

- `todo/` — available
- `doing/` — claimed, in flight
- `done/{YYYY}/` — completed

Use the backlog skill (`/backlog add|take|complete|...`) to interact. Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.
```
