# Worktree-Based Runtime Pattern

Manage `~/.claude` as a git worktree of your dotclaude development repo. Eliminates drift between where you develop and where Claude Code reads configuration.

## Detect Current State

```bash
# Is ~/.claude a worktree already?
if [ -f ~/.claude/.git ]; then
  echo "WORKTREE — linked to $(cat ~/.claude/.git | sed 's/gitdir: //')"
elif [ -d ~/.claude/.git ]; then
  echo "STANDALONE CLONE — candidate for migration"
else
  echo "NOT A REPO — no git tracking"
fi
```

## Why Worktree

With two independent clones (dev repo + `~/.claude`), tracked files drift silently. You merge a PR but `~/.claude` doesn't know. Settings.json diverges. Skills get out of sync.

A worktree gives you:
- **Single `.git`** — one history, one set of branches, no drift
- **`git status` as drift detector** — untracked files in `~/.claude` are visible immediately
- **Fast-forward sync** — `runtime` branch always moves forward to match `main`
- **Auto-sync on session start** — zero manual maintenance

## Setup

Replace `DEV_REPO` with the path to your dotclaude development clone:

```bash
DEV_REPO=~/code/dotclaude  # adjust to your location

# 1. Back up current ~/.claude
mv ~/.claude ~/.claude-backup

# 2. Create a runtime branch (worktrees require separate branches)
git -C "$DEV_REPO" branch runtime main
git -C "$DEV_REPO" push origin runtime

# 3. Create the worktree
git -C "$DEV_REPO" worktree add ~/.claude runtime

# 4. Restore gitignored runtime data (session history, caches, etc.)
rsync -a --exclude='.git/' --exclude='.git' --ignore-existing \
  ~/.claude-backup/ ~/.claude/

# 5. Verify
git -C "$DEV_REPO" worktree list
git -C ~/.claude status
```

Result:

| Path | Branch | Role |
|------|--------|------|
| `$DEV_REPO` | `main` | Development — branches, PRs |
| `~/.claude` | `runtime` | Live runtime — Claude Code reads this |

## Auto-Sync Hook

Add a `SessionStart` hook to `settings.json` that fast-forwards the runtime on every session start. Place it **first** so other hooks see updated code:

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

The trailing `; true` ensures offline sessions start normally.

After this, merged PRs are live at next session start — no manual sync needed.

## Skill Development with Symlinks

Skills must be "live" at `~/.claude/skills/<name>` to test. Symlink from runtime to your dev branch:

```bash
ln -s "$DEV_REPO/skills/my-skill" ~/.claude/skills/my-skill
```

After PR merge, remove the symlink — auto-sync delivers the tracked version.

## Runtime-Specific Changes

When Claude Code modifies tracked files at runtime (e.g., `settings.json` gains a new field):

```bash
git -C ~/.claude add <file>
git -C ~/.claude commit -m "chore: update <file> from runtime"
git -C "$DEV_REPO" cherry-pick runtime
git push origin main
git -C ~/.claude merge main --ff-only
```

## Gitignore

The runtime generates thousands of ephemeral files. Keep `.gitignore` comprehensive so `git status` stays clean and useful as a drift detector. Common patterns:

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
- **Claude Code recreates `~/.claude`** — if you `mv ~/.claude` while a session is active, Claude Code may recreate it before you can create the worktree. Close all sessions first.

## Rollback

```bash
git -C "$DEV_REPO" worktree remove ~/.claude --force
mv ~/.claude-backup ~/.claude  # if backup still exists
# or fresh clone:
git clone <remote> ~/.claude
```
