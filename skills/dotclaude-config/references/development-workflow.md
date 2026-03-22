# Two-Clone Development Workflow

Manage `~/.claude` as an independent clone that deploys from `origin/main`. Develop in `~/code/dotclaude` on feature branches. One command to sync.

## Architecture

```
~/code/dotclaude          ~/.claude
(dev clone)               (deploy clone)
feature branches          always on main
PRs, commits              git pull to update
                  ← origin/main →
```

Two independent clones of the same remote. No worktrees, no branch sync, no cherry-picks.

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` + feature branches | Development — branches, PRs |
| `~/.claude` | `main` | Deploy target — Claude Code reads this |

## Deploy

After merging a PR (or anytime):

```bash
~/.claude/scripts/deploy.sh
```

The script:
1. Removes dev symlinks (skills pointing back to `~/code/dotclaude`)
2. Fetches and fast-forwards `~/.claude` to `origin/main`
3. Reports what changed (silent when nothing did)

A `SessionStart` hook runs this automatically, so merged PRs are live at next session start.

## Skill Development

Skills must be "live" at `~/.claude/skills/<name>` to test. Use symlinks to bridge dev and runtime during development.

### New Skill

```bash
# 1. Feature branch + skill in dev repo
git -C ~/code/dotclaude checkout -b feat/my-skill main
mkdir -p ~/code/dotclaude/skills/my-skill

# 2. Symlink into runtime for live testing
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# 3. Develop, test, commit in ~/code/dotclaude
# 4. Push, open PR, merge

# 5. Deploy (removes symlink automatically, pulls new code)
~/.claude/scripts/deploy.sh
```

### Existing Skill (modify on a branch)

```bash
# 1. Feature branch in dev repo
git -C ~/code/dotclaude checkout -b feat/improve-my-skill main

# 2. Swap runtime's copy for a dev symlink
rm -rf ~/.claude/skills/my-skill
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# 3. Develop, test, commit, push, PR, merge

# 4. Deploy (restores tracked version from main)
~/.claude/scripts/deploy.sh
```

### Deleting a Skill

```bash
# In dev repo: delete the skill directory, commit on branch, merge PR
# Deploy pulls the deletion:
~/.claude/scripts/deploy.sh
```

## Runtime Changes

When Claude Code modifies tracked files at runtime (e.g., `settings.json` gains a new permission):

```bash
git -C ~/.claude add settings.json
git -C ~/.claude commit -m "chore: update settings from runtime"
git -C ~/.claude push origin main

# Dev repo catches up whenever needed:
git -C ~/code/dotclaude pull
```

No cherry-pick. No hash divergence. Both clones are on `main`.

## Setup (Fresh)

```bash
DEV_REPO=~/code/dotclaude

# 1. Clone the dev repo (if not already)
git clone git@github.com:fairchild/dotclaude.git "$DEV_REPO"

# 2. Back up current ~/.claude
mv ~/.claude ~/.claude-backup

# 3. Clone the deploy target
git clone git@github.com:fairchild/dotclaude.git ~/.claude

# 4. Restore gitignored runtime data (sessions, caches, plugins)
rsync -a --exclude='.git/' --exclude='.git' --ignore-existing \
  ~/.claude-backup/ ~/.claude/

# 5. Verify
git -C ~/.claude log --oneline -1
git -C "$DEV_REPO" log --oneline -1
# Both should show the same HEAD commit
```

## Setup (Migrate from Worktree)

If `~/.claude` is currently a worktree of `~/code/dotclaude`:

```bash
DEV_REPO=~/code/dotclaude

# 1. Remove the worktree registration (keeps files in place)
git -C "$DEV_REPO" worktree remove ~/.claude --force

# 2. Re-init ~/.claude as a standalone clone
cd ~/.claude
git init
git remote add origin git@github.com:fairchild/dotclaude.git
git fetch origin
git reset --hard origin/main

# 3. Delete the runtime branch (no longer needed)
git -C "$DEV_REPO" branch -D runtime
git push origin --delete runtime

# 4. Verify
git -C ~/.claude log --oneline -1
git -C "$DEV_REPO" log --oneline -1
```

## Auto-Sync Hook

The `SessionStart` hook runs `scripts/deploy.sh` so merged PRs are live at next session start. Place it **first** so other hooks see updated code:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/scripts/deploy.sh"
          }
        ]
      }
    ]
  }
}
```

The script exits 0 on failure (offline, diverged), so sessions always start normally.

## Gitignore

The runtime generates thousands of ephemeral files. Keep `.gitignore` comprehensive so `git status` stays clean:

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

Three origins coexist in `~/.claude/skills/`:

| Source | Tracked | Notes |
|--------|---------|-------|
| **Git-tracked** | Yes | Canonical, version-controlled |
| **Ecosystem-installed** | No | From `npx skills install`, runtime-only |
| **Dev symlinks** | No | Temporary, cleaned by deploy script |

## Gotchas

- **Never develop directly in `~/.claude`** — it's the deploy target. Only commit runtime changes (settings.json, etc.) there.
- **Dev symlinks shadow tracked skills** — a symlink at `~/.claude/skills/foo` overrides a tracked `skills/foo`. The deploy script handles cleanup, but be aware during development.
- **Push runtime changes before deploying** — if `~/.claude` has unpushed commits, the deploy script warns and skips the pull.
- **`settings.json` drifts** — Claude Code modifies it at runtime. Commit and push from `~/.claude` promptly.
- **Claude Code recreates `~/.claude`** — if you move it while a session is active, Claude Code may recreate it. Close all sessions first.

## Rollback

```bash
# If something goes wrong with the deploy clone:
rm -rf ~/.claude
git clone git@github.com:fairchild/dotclaude.git ~/.claude
rsync -a --ignore-existing ~/.claude-backup/ ~/.claude/
```
