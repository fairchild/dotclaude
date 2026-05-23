---
name: backlog
description: Markdown task backlog (backlog/{todo,doing,done}/) for parallel agents. Use when adding, taking, recording progress, completing, cancelling, reopening, releasing, or grooming.
license: Apache-2.0
---

# Backlog

A task tracker shaped like a maildir. Each task is one markdown file; its directory is its state.

- `backlog/todo/`  — available to claim
- `backlog/doing/` — claimed, in flight
- `backlog/done/`  — completed (and cancelled — the log line discriminates)

Claiming is `git mv backlog/todo/X.md backlog/doing/X.md`. Two agents racing the same task collide at merge — the right failure mode, not silent double-work.

## File shape

Two halves, divided by `---` with blank lines around it so markdown renders it as a horizontal rule.

```markdown
---
priority: 2
dependencies:
  schema-migration: ""
---

# Backlog Maildir

[problem statement, key decisions, phases, acceptance criteria]

---

- 2026-05-16T14:22:00Z started claimer=conductor:austin-v3 branch=feat/foo
- 2026-05-16T16:45:00Z progress | auth prototype passing locally
- 2026-05-17T11:03:00Z completed PR=https://github.com/.../pull/123
```

Frontmatter and description are **author-set and immutable**. Below the divider, each line is an append-only event log entry. `cat` tells the story in place; `git log -- backlog/.../X.md` tells the same story with author + commit context. They mirror because every recipe both appends a bullet AND commits.

**Frontmatter is optional** — every field has a default (`priority: 999`, `timeout: 7d`, `dependencies: {}`). A minimal task is just a title, description, and the divider. Authors declare a field only when overriding the default matters. Defaults and override guidance: `references/agents-schema.md`.

## Log line format

```
- {ISO ts} {kind} key=value ... [| free prose]
```

Kinds: `started`, `progress`, `completed`, `released`, `cancelled`, `reopened`.

- **KV fields** are unambiguous to grep: `grep 'branch=feat/foo'`, `grep '^- .*completed'`.
- **Free prose** goes after `|` for human notes.
- Long-form detail belongs in the **commit body** (`git commit -m subject -m body`). The bullet is the index; git is the archive. `git show <sha>` pulls it out.

## Rules

- **Frontmatter and description are immutable.** State changes go to the log below the divider.
- **Commit after each log line.** That's what keeps `cat` and `git log` synchronized.
- **Single writer per claim.** The `git mv` is the lock; bullets are documentation.
- **Commit before claiming.** Uncommitted files can't be `git mv`'d, and other agents can't see them.
- **Timeout is author-set, never claimer-extended.** Default `7d` if not declared. If the budget is wrong, release with a reason.
- **Dependencies are parallel.** Task is takeable when every dep slug resolves under `done/`.

Schema details: `references/agents-schema.md`.
First-time setup and migration: `references/workflows.md`.
Grooming buckets: `references/grooming.md`.

## Verbs

### add

Gather **slug** (kebab-case), **category** (`plan` / `followup` / `task-list` / `ideas`, filename suffix), **priority** (1 = highest, optional), **timeout** (`4h` / `3d` / `2w`, only if there's a real budget), **dependencies** (slug → one-line reason).

```bash
slug=backlog-maildir
category=plan
filename="backlog/todo/${slug}-${category}.md"
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

Fill the body, then commit.

### take

Optional preamble: release any timed-out tasks first, so the failure-recovery and the take are one operation. Skip if a separate janitor is running on a schedule. See `references/parallel-agents.md` for the full pattern.

```bash
slug=backlog-maildir-plan
branch=$(git rev-parse --abbrev-ref HEAD)
claimer=${CONDUCTOR_WORKSPACE_NAME:+conductor:$CONDUCTOR_WORKSPACE_NAME}
claimer=${claimer:-${CMUX_WORKSPACE_ID:+cmux:$CMUX_WORKSPACE_ID}}
claimer=${claimer:-$(whoami)@$(hostname -s)}
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

git mv "backlog/todo/${slug}.md" "backlog/doing/${slug}.md"
echo "- $ts started claimer=$claimer branch=$branch" >> "backlog/doing/${slug}.md"
git add "backlog/doing/${slug}.md"
git commit -m "take($slug) $claimer @ $branch"
```

**With no slug (auto-pick):** glob `backlog/todo/*.md`, read each frontmatter's `priority:` (default `999`) and `dependencies:` block (default empty), filter to those whose every dep slug resolves under `backlog/done/`, sort by priority ascending then oldest mtime, take the first. The agent does this with Glob+Read.

### progress

```bash
slug=backlog-maildir-plan
note="auth prototype passing locally"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "- $ts progress | $note" >> "backlog/doing/${slug}.md"
git add "backlog/doing/${slug}.md"
git commit -m "progress($slug) $note"
```

If the slug isn't known, find the doing/ file on the current branch via the latest `branch=` field:

```bash
b=$(git rev-parse --abbrev-ref HEAD)
for f in backlog/doing/*.md; do
  last=$(grep -oE 'branch=[^ ]+' "$f" | tail -1 | cut -d= -f2)
  [[ "$last" == "$b" ]] && echo "$f"
done
```

### complete

```bash
slug=backlog-maildir-plan
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
pr_url=$(gh pr view --json url -q .url 2>/dev/null || true)

git mv "backlog/doing/${slug}.md" "backlog/done/${slug}.md"
echo "- $ts completed${pr_url:+ PR=$pr_url}" >> "backlog/done/${slug}.md"
git add "backlog/done/${slug}.md"
git commit -m "complete($slug)${pr_url:+ PR=$pr_url}"
```

### release

Give a claimed task back to `todo/`. Requires a reason.

```bash
slug=backlog-maildir-plan
reason="blocked on legal review"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

git mv "backlog/doing/${slug}.md" "backlog/todo/${slug}.md"
echo "- $ts released | $reason" >> "backlog/todo/${slug}.md"
git add "backlog/todo/${slug}.md"
git commit -m "release($slug) $reason"
```

### cancel

Abandon (todo or doing → `done/`). Requires a reason. The `cancelled` log line discriminates from completion.

```bash
slug=this-isnt-going-to-happen-plan
reason="superseded by the X redesign"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src=$(find backlog/todo backlog/doing -name "${slug}.md" -type f | head -1)

git mv "$src" "backlog/done/${slug}.md"
echo "- $ts cancelled | $reason" >> "backlog/done/${slug}.md"
git add "backlog/done/${slug}.md"
git commit -m "cancel($slug) $reason"
```

### reopen

`done/X.md` → `todo/X.md`. Requires a reason.

```bash
slug=once-was-finished-plan
reason="edge case Y discovered"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

git mv "backlog/done/${slug}.md" "backlog/todo/${slug}.md"
echo "- $ts reopened | $reason" >> "backlog/todo/${slug}.md"
git add "backlog/todo/${slug}.md"
git commit -m "reopen($slug) $reason"
```

### status

```bash
for pile in todo doing done; do
  printf "%s: %d\n" "$pile" "$(find backlog/$pile -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
done
ls -lt backlog/doing/*.md 2>/dev/null | head -5
```

### groom

Advisory walk; never moves files. Buckets and per-bucket checks: `references/grooming.md`.

## References

- `references/agents-schema.md` — directory layout, frontmatter schema (with defaults), bullet log format, dependencies syntax
- `references/parallel-agents.md` — mental model, failure detection, cleanup patterns, worker design sketch
- `references/workflows.md` — `init` (first-time setup) and `migrate` (from flat layout)
- `references/grooming.md` — bucket checklist for `groom`
- `references/README.md` — background, design philosophy, related projects
