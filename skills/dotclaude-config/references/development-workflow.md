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

## Runtime Config Changes

`main` is protected, so nothing — including `~/.claude` — pushes to it directly. When Claude Code or another app (e.g. the workspaces hook installer) modifies `~/.claude/settings.json` at runtime, codify the change through a PR from the dev repo:

```bash
cp ~/.claude/settings.json ~/code/dotclaude/settings.json
git -C ~/code/dotclaude checkout -b chore/settings-sync main
git -C ~/code/dotclaude add settings.json
git -C ~/code/dotclaude commit -m "chore: sync settings.json from runtime"
git -C ~/code/dotclaude push -u origin chore/settings-sync
gh pr create --fill   # review, merge
```

After merge, discard the now-redundant runtime drift so the tree is clean, then deploy:

```bash
git -C ~/.claude checkout settings.json
~/.claude/scripts/deploy.sh
```

Until you do this, `~/.claude` shows `settings.json` as modified and the `SessionStart` auto-deploy skips. Everything else (new skills, workflow changes, doc updates) goes through feature branches and PRs in `~/code/dotclaude` the same way.

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

- **Never develop directly in `~/.claude`** — it's the deploy target, read/fast-forward only. `main` is protected; never commit there, even runtime `settings.json` drift goes through a dev-repo PR.
- **Dev symlinks shadow tracked skills** — a symlink at `~/.claude/skills/foo` overrides a tracked `skills/foo`. The deploy script handles cleanup, but be aware during development.
- **Keep `~/.claude` clean before deploying** — the deploy script fast-forwards only when the runtime tree has no local commits and no uncommitted drift; otherwise it warns and skips.
- **`settings.json` drifts** — Claude Code (and the workspaces app) modify it at runtime. Codify the drift via a dev-repo PR, then `git -C ~/.claude checkout settings.json` and deploy; `main` rejects direct pushes.
- **Claude Code recreates `~/.claude`** — if you move it while a session is active, Claude Code may recreate it. Close all sessions first.

## Preventing Common Mistakes

### Pre-commit Hooks via prek

This repo uses [prek](https://prek.j178.dev) (a Rust-based pre-commit framework) to catch mistakes before they land. The `prek.toml` config runs:

- **`no-commit-to-branch`** — blocks direct commits to `main` (use feature branches)
- **`check-json`** / **`check-yaml`** / **`check-toml`** — validates config file syntax
- **`backlog-dep-validation`** — rejects touched backlog tasks whose `dependencies:` slugs do not resolve

Install prek and set up hooks after cloning:

```bash
brew install prek   # or: cargo install prek, uv tool install prek
prek install
```

Run manually against all files:

```bash
prek run --all-files
```

### Quick Verification Checklist

Before committing:

1. `prek run --all-files` — all hooks pass
2. `git diff --cached` — review staged changes
3. Branch is not `main` — feature branches only
4. Conventional commit message (`feat:`, `fix:`, `chore:`)

### Recovery: Accidental Commit to Main

If you committed to `main` before hooks were installed:

```bash
# 1. Create a feature branch from current state
git branch feat/my-work

# 2. Reset main back to remote
git checkout main
git reset --hard origin/main

# 3. Switch to the feature branch and continue
git checkout feat/my-work
```

If the commit was already pushed to `origin/main`, you'll need to force-push to reset it — coordinate with any collaborators first:

```bash
git push --force-with-lease origin main
```

### Why prek?

prek is the recommended pre-commit tool for this repo:

- Fast — written in Rust, parallel hook execution
- Compatible — runs standard pre-commit hooks from the ecosystem
- Simple — single `prek.toml` config, `prek install` setup
- No Python dependency — unlike `pre-commit`, prek is a standalone binary

## Rollback

```bash
# If something goes wrong with the deploy clone:
rm -rf ~/.claude
git clone git@github.com:fairchild/dotclaude.git ~/.claude
rsync -a --ignore-existing ~/.claude-backup/ ~/.claude/
```
