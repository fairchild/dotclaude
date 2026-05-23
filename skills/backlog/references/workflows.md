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
- `done/`  — completed (and cancelled — discriminated by the `### cancelled` log block)

Use the `backlog` skill (add / take / progress / complete / release / cancel / reopen / groom / status) to interact. Schema and rules: `~/.claude/skills/backlog/references/agents-schema.md`.
EOF
ln -s AGENTS.md backlog/CLAUDE.md
```

The symlink lets Claude Code auto-load these conventions via its `CLAUDE.md` convention while keeping a single source of truth in `AGENTS.md` (the cross-tool default). Commit the new directories, `AGENTS.md`, and the symlink so collaborators see them.

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

Review the result with the `status` recipe in `SKILL.md`, then commit as a single "chore(backlog): migrate to maildir layout" commit. Reversible via `git revert` if anything looks wrong.
