# Workflows

One-shot recipes that aren't part of the daily verb loop — first-time setup in a fresh project, and migration from the older flat layout.

## init

Set up `backlog/` in a fresh project.

```bash
mkdir -p backlog/{todo,doing,done}
cat > backlog/AGENTS.md <<'EOF'
# backlog/

`CLAUDE.md` here is a symlink to this file — read one, not both.

Deferred work, one markdown file per task. Location = status:

- `todo/`  — available
- `doing/` — claimed, in flight
- `done/`  — completed (and cancelled — discriminated by the `cancelled` log line)

Use the `backlog` skill (add / advance / progress / cancel / fail / rescue / retry / groom / status) to interact. There is no backward verb — work that can't proceed is `fail`ed and may be `retry`ed back to `todo/`. Schema and rules: the `backlog` skill's `references/agents-schema.md`.

## Backend

`maildir-git` — the default. Everything in this directory is committed to git; claim is `git mv`. See the `backlog` skill's `references/backends/maildir-git.md`. Multi-worktree projects should consider `maildir-shared` instead — see `references/backends/maildir-shared.md`.

## Defaults

Frontmatter is optional; recipes apply these defaults when fields are omitted:

- `priority: 999` (low — declare to drive auto-pick ordering)
- `timeout: 7d` (override per-task: shorter for fast agent work, longer for human-paced or human-blocked)
- `dependencies: {}` (declare only hard preconditions)

Override the project default by stating it here (e.g., "default timeout in this project: 24h") and declaring `timeout:` per-task accordingly.

## Pipeline

`todo → doing → done`

The default pipeline. To add intermediate states (e.g. `reviewing/`), create the directory and update this line — `advance` reads it. See the `backlog` skill's `references/pipeline.md`.

## ROADMAP

Strategic counterpart at `backlog/ROADMAP.md` — Intent, Principles, Current Focus, Priorities (named arcs), Non-goals. Tasks optionally link via `arc: <name>` frontmatter. See the `backlog` skill's `references/roadmap.md`.
EOF
ln -s AGENTS.md backlog/CLAUDE.md

# Scaffold ROADMAP.md if missing. For a guided interview instead, load references/reflect.md.
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

`AGENTS.md` is the cross-tool source of truth; `CLAUDE.md` symlinks to it so Claude Code auto-loads the same conventions. Commit everything so collaborators see it.

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
