# Workflows

One-shot recipes that aren't part of the daily verb loop — first-time setup in a fresh project, and migration from the older flat layout.

## init

Set up `backlog/` in a fresh project.

```bash
mkdir -p backlog/{todo,doing,done}
cat > backlog/AGENTS.md <<'EOF'
# backlog/

Deferred work, one markdown file per task. Location = status:

- `todo/`  — available
- `doing/` — claimed, in flight
- `done/`  — completed (and cancelled — discriminated by the `cancelled` log line)

Use the `backlog` skill (add / take / recover / progress / complete / release / cancel / fail / reopen / groom / status) to interact. Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.

## Defaults

Frontmatter is optional; recipes apply these defaults when fields are omitted:

- `priority: 999` (low — declare to drive auto-pick ordering)
- `timeout: 7d` (override per-task: shorter for fast agent work, longer for human-paced or human-blocked)
- `dependencies: {}` (declare only hard preconditions)

Override the project default by stating it here (e.g., "default timeout in this project: 24h") and declaring `timeout:` per-task accordingly.

## ROADMAP

Strategic counterpart at `backlog/ROADMAP.md` — Intent, Principles, Current Focus, Priorities (named arcs), Non-goals. Tasks optionally link via `arc: <name>` frontmatter. See `~/.claude/skills/backlog/references/roadmap.md`.
EOF
ln -s AGENTS.md backlog/CLAUDE.md

# Scaffold ROADMAP.md if missing — comment-skeleton so the file exists even if
# the operator skips the guided interview. To populate via interview instead,
# hand control to `references/reflect.md`'s initialization submode (project-wide
# scan, then walk the six sections one question at a time).
[[ -f backlog/ROADMAP.md ]] || cat > backlog/ROADMAP.md <<'EOF'
# ROADMAP

## Intent
<!-- One paragraph. What this project ultimately intends to be. -->

## Principles
<!-- 3–7 short statements. What values guide decisions when tradeoffs come up. -->

## Glossary
<!-- Optional. Only terms with real ambiguity in this project. -->

## Current Focus
<!-- 1–3 paragraphs. The active arc — what we're pushing on, why now,
     what "done with this arc" looks like. -->

## Priorities
<!-- Ordered list of named arcs (kebab-case) with one or two sentences of
     reasoning. Tasks queued under an arc declare `arc: <name>` in frontmatter. -->

## Non-goals
<!-- Things we are explicitly *not* doing right now. -->
EOF
```

The symlink lets Claude Code auto-load these conventions via its `CLAUDE.md` convention while keeping a single source of truth in `AGENTS.md` (the cross-tool default). Commit the new directories, `AGENTS.md`, the symlink, and `ROADMAP.md` so collaborators see them.

To populate `ROADMAP.md` properly rather than leaving the skeleton, hand control to `references/reflect.md`'s initialization submode: it runs a project-wide scan first (README, docs/, CONTEXT.md, ADRs, root AGENTS.md), synthesizes candidate principles and goals, then walks the six sections as a guided interview. Initialization is the highest-leverage moment — getting principles and goals right here shapes everything that follows.

## migrate

For a project on the older flat layout (pending items at `backlog/*.md`, completed at `backlog/done/*.md`, possibly with `backlog/done/{YYYY}/` year subdirs from an interim version):

```bash
mkdir -p backlog/todo backlog/doing

# Pending items: anything directly under backlog/ that isn't AGENTS.md/CLAUDE.md/ROADMAP.md
for f in backlog/*.md; do
  base=$(basename "$f")
  case "$base" in AGENTS.md|CLAUDE.md|ROADMAP.md) continue ;; esac
  git mv "$f" "backlog/todo/$base"
done

# Flatten any year subdirs back into backlog/done/
for d in backlog/done/*/; do
  [[ -d "$d" ]] || continue
  for f in "$d"*.md; do
    [[ -f "$f" ]] || continue
    git mv "$f" "backlog/done/$(basename "$f")"
  done
  # Drop the now-empty year (or quarter, or cancelled/) subdir
  rmdir "$d" 2>/dev/null || true
done
```

Review the result with the `status` recipe in `worker.md`, then commit as a single "chore(backlog): migrate to maildir layout" commit. Reversible via `git revert` if anything looks wrong.
