---
name: backlog
description: Maildir-style backlog for parallel agents. Tasks are markdown files in todo/, doing/, or done/{YYYY}/ — location is status, claim is an atomic git mv. Use when adding deferred work, taking the next task, recording progress, completing, cancelling, reopening, releasing, or grooming the backlog. Append-only body log, graph-native dependencies, no scripts — every verb is a small bash recipe the agent runs inline.
license: Apache-2.0
---

# Backlog

A task tracker shaped like a maildir. Each task is one markdown file; its directory is its state:

- `backlog/todo/`        — available to claim
- `backlog/doing/`       — claimed, in flight
- `backlog/done/{YYYY}/` — completed, year-partitioned at write time

Claiming a task is `git mv backlog/todo/X.md backlog/doing/X.md`. Two agents racing the same task collide at merge — the right failure mode, not silent double-work.

## Schema

Frontmatter is **author-set at creation, never edited after**. The body grows by append-only log blocks. Claim metadata (claimer, branch, PR URL) lives inside those log blocks, not in frontmatter.

```markdown
---
priority: 2
timeout: 3d
dependencies:
  schema-migration: "needs new claim block format"
---

# Backlog Maildir Refactor

[problem statement, key decisions, phases, acceptance criteria]

---

### started — 2026-05-16T14:22:00Z

claimed by conductor:austin-v3 on branch feat/backlog-maildir

---

### progress — 2026-05-16T16:45:00Z

take + complete recipes working; starting groom prompt

---
```

Every block — frontmatter, description, log entries — ends with a bare `^---$` line so the file stays greppable and append-friendly via heredoc.

Full schema in `references/agents-schema.md`.

## Reading state

- "Is X claimed?" — does it live under `doing/`?
- "Who claims X?" — the body of the last `### started` block.
- "How old is the claim?" — the ISO in the heading of that block.
- "What's its PR?" — the body of the last `### completed` block.

## Verbs

Each verb is a short bash recipe. Run them inline via the `Bash` tool from the project root (the one with `backlog/` as a sibling).

### add

Create a task in `todo/`. Gather context first (don't dump the user into editor-of-empty-file mode):

1. **Slug** (kebab-case, will be the filename minus `.md`)
2. **Category**: `plan`, `followup`, `task-list`, or `ideas` — appended to slug as `{slug}-{category}.md`
3. **Priority** (1 = highest, optional)
4. **Timeout** (only if there's a real budget: `4h`, `3d`, `2w`)
5. **Dependencies** (slugs of tasks that must finish first, with a one-line reason each)

Then write the file directly:

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
echo "$filename"
```

Commit before claiming. The maildir lock is committed git state — uncommitted files can't be `git mv`'d, and other agents can't see them.

Then open the file and fill the body. Quality bar:

- Enough context that a fresh session can execute without the original conversation
- Specific file paths (with line numbers when relevant)
- Verification commands or acceptance criteria
- Dependencies declared if any

### take

Claim a task (todo → doing). The `git mv` is the lock; the `started` block is documentation.

```bash
slug=backlog-maildir-plan
branch=$(git rev-parse --abbrev-ref HEAD)
claimer=${CONDUCTOR_WORKSPACE_NAME:+conductor:$CONDUCTOR_WORKSPACE_NAME}
claimer=${claimer:-${CMUX_WORKSPACE_ID:+cmux:$CMUX_WORKSPACE_ID}}
claimer=${claimer:-$(whoami)@$(hostname -s)}
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

git mv "backlog/todo/${slug}.md" "backlog/doing/${slug}.md"
cat >> "backlog/doing/${slug}.md" <<EOF

### started — ${ts}

claimed by ${claimer} on branch ${branch}

---
EOF
```

**Take with no slug (auto-pick)**: list `backlog/todo/*.md`, read each file's `priority:` (default 999) and `dependencies:` block, filter to those whose every dep slug resolves to a file under `backlog/done/**/`, sort by priority ascending then oldest mtime, pick the first. Then run the take recipe above. The agent does this with `Glob` + `Read`; no script.

### progress

Append a timestamped note to the doing/ file. Only the claimer should call this — the maildir invariant is single-writer between take and complete.

```bash
slug=backlog-maildir-plan
note="auth migration prototype passing locally"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat >> "backlog/doing/${slug}.md" <<EOF

### progress — ${ts}

${note}

---
EOF
```

If the slug isn't known, find the doing/ file on the current branch via the *last* `### started` block (a released-then-re-taken file has two):

```bash
b=$(git rev-parse --abbrev-ref HEAD)
for f in backlog/doing/*.md; do
  last=$(awk '/^### started — /{cap=1; next} cap && /^claimed by .* on branch /{line=$0; cap=0} END{print line}' "$f")
  [[ "$last" == *" on branch $b" ]] && echo "$f"
done
```

### complete

Finish (doing → `done/{YYYY}/`). Detects the PR via `gh` if available.

```bash
slug=backlog-maildir-plan
year=$(date -u +%Y)
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
pr_url=$(gh pr view --json url -q .url 2>/dev/null || true)

mkdir -p "backlog/done/${year}"
git mv "backlog/doing/${slug}.md" "backlog/done/${year}/${slug}.md"
{
  printf '\n### completed — %s\n\n' "$ts"
  printf 'marked complete'
  [[ -n "$pr_url" ]] && printf ' (PR: %s)' "$pr_url"
  printf '\n\n---\n'
} >> "backlog/done/${year}/${slug}.md"
```

### release

Give a claimed task back to todo/. Requires a reason — a verb without context rots the audit trail.

```bash
slug=backlog-maildir-plan
reason="blocked on legal review"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
git mv "backlog/doing/${slug}.md" "backlog/todo/${slug}.md"
cat >> "backlog/todo/${slug}.md" <<EOF

### released — ${ts}

${reason}

---
EOF
```

### cancel

Abandon a task (todo or doing → `done/{YYYY}/`). Requires a reason. The `### cancelled` log block tells you from completion, no separate directory needed.

```bash
slug=this-isnt-going-to-happen-plan
reason="superseded by the X redesign"
year=$(date -u +%Y)
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src=$(find backlog/todo backlog/doing -name "${slug}.md" -type f | head -1)
mkdir -p "backlog/done/${year}"
git mv "$src" "backlog/done/${year}/${slug}.md"
cat >> "backlog/done/${year}/${slug}.md" <<EOF

### cancelled — ${ts}

${reason}

---
EOF
```

### reopen

`done/**/X.md` → `todo/X.md`. Lands in the *current* year if re-completed later.

```bash
slug=once-was-finished-plan
reason="discovered the migration didn't cover edge case Y"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src=$(find backlog/done -name "${slug}.md" -type f | head -1)
git mv "$src" "backlog/todo/${slug}.md"
cat >> "backlog/todo/${slug}.md" <<EOF

### reopened — ${ts}

${reason}

---
EOF
```

### status

Pile counts and recent activity. One-liner:

```bash
for pile in todo doing; do printf "%s: %d\n" "$pile" "$(find backlog/$pile -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"; done
printf "done: %d\n" "$(find backlog/done -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
ls -lt backlog/doing/*.md 2>/dev/null | head -5
```

### groom

An advisory walk over the backlog — never moves files automatically. See `references/grooming.md` for the buckets and the per-bucket checks.

### init

Set up `backlog/` in a fresh project.

```bash
mkdir -p backlog/{todo,doing,done}
cat > backlog/AGENTS.md <<'EOF'
# backlog/

Deferred work, one markdown file per task. Location = status:

- `todo/` — available
- `doing/` — claimed, in flight
- `done/{YYYY}/` — completed

Use the `backlog` skill (add / take / progress / complete / release / cancel / reopen / groom / status) to interact. Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.
EOF
```

### migrate (one-shot)

For a project with the old flat layout (items at `backlog/*.md`, completed at `backlog/done/*.md`):

```bash
mkdir -p backlog/todo backlog/doing
# Pending items: anything directly under backlog/ that isn't AGENTS.md/CLAUDE.md/ROADMAP.md
for f in backlog/*.md; do
  base=$(basename "$f")
  case "$base" in AGENTS.md|CLAUDE.md|ROADMAP.md) continue ;; esac
  git mv "$f" "backlog/todo/$base"
done
# Completed items: backlog/done/*.md → backlog/done/{year}/X.md
# Use the file's last git-log timestamp for the year.
for f in backlog/done/*.md; do
  [[ -f "$f" ]] || continue
  year=$(git log -1 --format=%cd --date=format:%Y -- "$f" 2>/dev/null || date -u +%Y)
  mkdir -p "backlog/done/${year}"
  git mv "$f" "backlog/done/${year}/$(basename "$f")"
done
```

## Rules

- **Frontmatter is immutable after creation.** No script, no agent should `Edit` frontmatter mid-flight. If you need to record a state change, append a log block.
- **Single writer per claim.** Between take and complete, only the claiming agent appends to the body. The maildir `git mv` is the actual lock.
- **Timeout is set by the task author.** Absent = unbounded. Claimers cannot extend; if the budget is wrong, release with a reason.
- **Dependencies are parallel.** `dependencies: {slug: "reason"}` is a map of slugs that must resolve under `done/**` before the task is takeable. No array form.
- **Year partition at write time.** `complete` uses `date -u +%Y`. Reopen-then-recomplete lands in the current year, not the original.

## References

- `references/agents-schema.md` — Directory layout, frontmatter schema, body log format, dependencies syntax
- `references/grooming.md` — Bucket checklist for the groom verb
- `references/README.md` — Background, design philosophy, related projects
