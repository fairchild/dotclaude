# Worktree-Based Runtime Pattern

A pattern for managing `~/.claude` as a git worktree instead of an independent clone. Eliminates drift between development and runtime environments.

## Setup

Given a dotclaude repo at `~/code/dotclaude`:

```bash
# Create a runtime branch (worktrees require separate branches)
git -C ~/code/dotclaude branch runtime main
git -C ~/code/dotclaude push origin runtime

# Create the worktree
git -C ~/code/dotclaude worktree add ~/.claude runtime

# Restore gitignored runtime data (if migrating from an existing clone)
rsync -a --exclude='.git/' --exclude='.git' --ignore-existing \
  ~/.claude-backup/ ~/.claude/
```

Result:

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` | Development — branches, PRs |
| `~/.claude` | `runtime` | Live runtime — Claude Code reads this |

## Auto-Sync Hook

Add a `SessionStart` hook to `settings.json` that fast-forwards the runtime on every session start:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "git -C ~/.claude fetch origin main --quiet 2>/dev/null; git -C ~/.claude merge origin/main --ff-only --quiet 2>/dev/null; true"
          }
        ]
      }
    ]
  }
}
```

Place this **first** in the SessionStart list so other hooks see updated code. The trailing `; true` prevents offline failures from blocking sessions.

## Skill Development with Symlinks

Skills must be "live" at `~/.claude/skills/<name>` to test. Symlink from runtime to dev:

```bash
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill
```

After PR merge, remove the symlink — auto-sync delivers the tracked version.

## Runtime-Specific Changes

When Claude Code modifies tracked files at runtime:

```bash
git -C ~/.claude add <file>
git -C ~/.claude commit -m "chore: update <file> from runtime"
git -C ~/code/dotclaude cherry-pick runtime
git push origin main
git -C ~/.claude merge main --ff-only
```

## Gitignore

The runtime generates thousands of ephemeral files. Keep `.gitignore` comprehensive so `git -C ~/.claude status` stays clean and useful as a drift detector. Common patterns:

```gitignore
# Session data
history.jsonl
plans/
todos/
session-env/

# Debug and logs
debug/
shell-snapshots/

# Generated/cached
cache/
projects/
plugins/

# Temporary
tmp/
*.tmp
*.cache
```

## Skill Sources in Runtime

Three origins can coexist in `~/.claude/skills/`:

| Source | Tracked | Notes |
|--------|---------|-------|
| **Git-tracked** | Yes | Canonical, version-controlled |
| **Ecosystem-installed** | No | From `npx skills install`, runtime-only |
| **External symlinks** | No | From other repos — fragile, document them |

Untracked skills are expected in `git status` — don't force-add them.

## Gotchas

- **Never develop directly in `~/.claude`** — it's the deployment target
- **Worktree branch constraint** — git disallows two worktrees on the same branch; dev stays on `main`, runtime on `runtime`
- **External symlinks can shadow tracked skills** — a symlink at `~/.claude/skills/foo` overrides a tracked `skills/foo`
- **`settings.json` drifts** — Claude Code modifies it at runtime; sync regularly via cherry-pick workflow

## Rollback

```bash
git -C ~/code/dotclaude worktree remove ~/.claude --force
git clone <remote> ~/.claude
```
