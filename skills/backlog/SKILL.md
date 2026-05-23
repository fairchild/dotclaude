---
name: backlog
description: Markdown task backlog and project roadmap (backlog/{todo,doing,done,failed}/, backlog/ROADMAP.md) for adding, taking, recovering, recording progress, completing, cancelling, reopening, releasing, failing, grooming, or reflecting on backlog priorities and roadmap direction.
license: Apache-2.0
---

# Backlog

A task tracker shaped like a maildir. Each task is one markdown file; its directory is its state.

- `backlog/todo/`   — available to claim
- `backlog/doing/`  — claimed, in flight
- `backlog/done/`   — completed (and cancelled — the log line discriminates)
- `backlog/failed/` — dead-letter for tasks that exhausted retries (created on demand)

Claiming is `git mv backlog/todo/X.md backlog/doing/X.md`. Two agents racing the same task collide at merge — the right failure mode, not silent double-work.

## File shape

Two halves, divided by `---` with blank lines around it so markdown renders it as a horizontal rule.

```markdown
---
priority: 2
dependencies:
  other-task-slug: "why we depend on it"
---

# Task Title

[problem statement, key decisions, phases, acceptance criteria]

---

- 2026-05-16T14:22:00Z started claimer=conductor:austin-v3 branch=feat/foo
- 2026-05-16T16:45:00Z progress | auth prototype passing locally
- 2026-05-17T11:03:00Z completed PR=https://github.com/.../pull/123
```

Frontmatter and description above the divider are author-set and frozen after first commit (one exception: `reopen` may edit them). Below the divider is an append-only event log written by workers — see `references/worker.md` for the verb recipes that maintain it.

## Frontmatter (optional)

Every field has a default, so a minimal task can omit frontmatter entirely:

```markdown
# Quick fix

The login button is misaligned on mobile.

---
```

Defaults: `priority=999`, `timeout=7d`, `dependencies={}`. Add fields above the title to override.

- **`priority`** — integer, 1 = highest. Default `999` (sorts after every declared priority). Declare a number when scheduling order matters.
- **`timeout`** — humanish: `4h`, `3d`, `2w`. Default `7d`. Starts at the most recent `started` log line. Use shorter for automated agent tasks; longer for tasks needing synchronous human input or external dependencies. Project-wide defaults can be stated in `backlog/AGENTS.md`.
- **`dependencies`** — map of slug → reason. Default empty. Declare only hard preconditions; a task is takeable when every dep slug resolves to a file under `done/`.

Additional keys an author writes are preserved but not interpreted by any recipe. Full schema, kinds table, and "reading state" queries: `references/agents-schema.md`.

## Add a task

Gather **slug** (kebab-case), **category** (`plan` / `followup` / `task-list` / `ideas`, filename suffix), and a description.

```bash
slug=backlog-maildir
category=plan
filename="backlog/todo/${slug}-${category}.md"
mkdir -p backlog/todo
cat > "$filename" <<'EOF'
---
priority: 2
# timeout: 3d
# dependencies:
#   other-slug: "why it blocks this"
---

# Backlog Maildir

[problem statement, key decisions, phases, references, acceptance criteria]

---

EOF
git add "$filename" && git commit -m "add($slug)"
```

Quality: enough context that a fresh session can execute without the original conversation; specific file paths; verification commands; deps declared if any. Commit before anyone can claim.

## Working the backlog

For take, recover, progress, complete, release, cancel, fail, reopen, status, and groom — the verb recipes plus the rules workers must follow — see `references/worker.md`.

## Roadmap and reflection

`backlog/ROADMAP.md` sits above the queue — North Star, Principles, Current Focus, Priorities (named arcs), Non-goals — and answers *why these tasks, in this order*. Tasks optionally link via `arc:` frontmatter. Shape and conventions: `references/roadmap.md`. For reflecting on the backlog, adding to the roadmap, or initializing one, load `references/reflect.md` and follow its posture.

## References

- `references/worker.md` — verb recipes for workers (take, recover, progress, complete, release, cancel, fail, reopen, status, groom)
- `references/agents-schema.md` — frontmatter schema, log line format, kinds table, reading-state queries
- `references/parallel-agents.md` — distributed-systems patterns and design rationale
- `references/workflows.md` — `init` (first-time setup) and `migrate` (from flat layout)
- `references/maintain.md` — advisory walk buckets (mechanical maintenance)
- `references/roadmap.md` — `backlog/ROADMAP.md` shape and the `arc:` linkage convention
- `references/reflect.md` — critical-collaborative planning posture for reflecting on the backlog or editing the roadmap
- `references/README.md` — background, design philosophy, related projects
