---
name: backlog
description: Maildir-style backlog for parallel agents. Tasks are markdown files in todo/, doing/, or done/ — location is status, claim is an atomic git mv. Use when adding deferred work, taking the next task, recording progress, completing, cancelling, reopening, releasing, or grooming. Append-only body log, graph-native dependencies, no scripts — every verb is a small bash recipe the agent runs inline.
license: Apache-2.0
---

# Backlog

A task tracker shaped like a maildir. Each task is one markdown file; its directory is its state.

- `backlog/todo/`  — available to claim
- `backlog/doing/` — claimed, in flight
- `backlog/done/`  — completed (and cancelled — the body's `### cancelled` block discriminates)

Claiming is `git mv backlog/todo/X.md backlog/doing/X.md`. Two agents racing the same task collide at merge — the right failure mode, not silent double-work.

Schema, body log format, "reading state from the log": `references/agents-schema.md`.
First-time setup and one-shot migration: `references/workflows.md`.

## Rules

- **Frontmatter is immutable after creation.** State changes are appended log blocks, never frontmatter edits.
- **Single writer per claim.** Between take and complete, only the claiming agent appends. The `git mv` is the lock; the `### started` block is documentation.
- **Commit before claiming.** Uncommitted files can't be `git mv`'d, and other agents can't see them. Add → commit → others can take.
- **Timeout is author-set, never claimer-extended.** If the budget is wrong, release with a reason.
- **Dependencies are parallel.** `dependencies: {slug: "reason"}` — task is takeable when every dep slug resolves under `done/`.

## Verbs

Each verb is a bash recipe. Run inline via the `Bash` tool from the project root (the one with `backlog/` as a sibling).

### add

Gather **slug** (kebab-case), **category** (`plan` / `followup` / `task-list` / `ideas` — filename suffix), **priority** (1 = highest, optional), **timeout** (only if there's a real budget: `4h` / `3d` / `2w`), **dependencies** (slug → one-line reason).

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
```

Fill the body. Quality: enough context for a fresh session, specific file paths, verification commands, deps declared. Commit before anyone can claim.

### take

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

**With no slug (auto-pick):** list `backlog/todo/*.md`, read each file's `priority:` (default 999) and `dependencies:` block, filter to those whose every dep slug resolves under `backlog/done/`, sort by priority ascending then oldest mtime, take the first. The agent does this with Glob+Read.

### progress

Append a timestamped note. Claimer only.

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

```bash
slug=backlog-maildir-plan
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
pr_url=$(gh pr view --json url -q .url 2>/dev/null || true)

git mv "backlog/doing/${slug}.md" "backlog/done/${slug}.md"
{
  printf '\n### completed — %s\n\n' "$ts"
  printf 'marked complete'
  [[ -n "$pr_url" ]] && printf ' (PR: %s)' "$pr_url"
  printf '\n\n---\n'
} >> "backlog/done/${slug}.md"
```

### release

Give a claimed task back to `todo/`. Requires a reason — a verb without context rots the trail.

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

Abandon (todo or doing → `done/`). Requires a reason. The `### cancelled` block discriminates from completion.

```bash
slug=this-isnt-going-to-happen-plan
reason="superseded by the X redesign"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src=$(find backlog/todo backlog/doing -name "${slug}.md" -type f | head -1)
git mv "$src" "backlog/done/${slug}.md"
cat >> "backlog/done/${slug}.md" <<EOF

### cancelled — ${ts}

${reason}

---
EOF
```

### reopen

`done/X.md` → `todo/X.md`. Requires a reason.

```bash
slug=once-was-finished-plan
reason="discovered the migration didn't cover edge case Y"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
git mv "backlog/done/${slug}.md" "backlog/todo/${slug}.md"
cat >> "backlog/todo/${slug}.md" <<EOF

### reopened — ${ts}

${reason}

---
EOF
```

### status

```bash
for pile in todo doing done; do
  printf "%s: %d\n" "$pile" "$(find backlog/$pile -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
done
ls -lt backlog/doing/*.md 2>/dev/null | head -5
```

### groom

An advisory walk over the backlog — never moves files. Buckets and per-bucket checks: `references/grooming.md`.

## References

- `references/agents-schema.md` — directory layout, frontmatter schema, body log format, dependencies syntax
- `references/workflows.md` — `init` (first-time setup) and `migrate` (from flat layout)
- `references/grooming.md` — bucket checklist for `groom`
- `references/README.md` — background, design philosophy, related projects
