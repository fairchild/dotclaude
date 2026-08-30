# Two-Clone Development Workflow

Manage `~/.claude` as an independent clone that deploys from `origin/main`. Develop in `~/code/dotclaude` on feature branches. One command to sync. <!-- portability: allow -->

## Architecture

```
~/code/dotclaude          ~/.claude  # portability: allow
(dev clone)               (deploy clone)
feature branches          always on main
PRs, commits              git pull to update
                  ← origin/main →
```

Two independent clones of the same remote. No worktrees, no branch sync, no cherry-picks.

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` + feature branches | Development — branches, PRs |
| `~/.claude` | `main` | Deploy target — Claude Code reads this <!-- portability: allow --> |

## Deploy

After merging a PR (or anytime):

```bash
~/.claude/scripts/deploy.sh  # portability: allow
```

The script:
1. Removes dev symlinks (skills pointing back to `~/code/dotclaude`)
2. Fetches and fast-forwards `~/.claude` to `origin/main` <!-- portability: allow -->
3. Reports what changed (silent when nothing did)

A `SessionStart` hook runs this automatically, so merged PRs are live at next session start.

## Skill Development

Skills must be "live" at `~/.claude/skills/<name>` to test. Use symlinks to bridge dev and runtime during development. <!-- portability: allow -->

### New Skill

```bash
# 1. Feature branch + skill in dev repo
git -C ~/code/dotclaude checkout -b feat/my-skill main
mkdir -p ~/code/dotclaude/skills/my-skill

# 2. Symlink into runtime for live testing
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill  # portability: allow

# 3. Develop, test, commit in ~/code/dotclaude
# 4. Push, open PR, merge

# 5. Deploy (removes symlink automatically, pulls new code)
~/.claude/scripts/deploy.sh  # portability: allow
```

### Existing Skill (modify on a branch)

```bash
# 1. Feature branch in dev repo
git -C ~/code/dotclaude checkout -b feat/improve-my-skill main

# 2. Swap runtime's copy for a dev symlink
rm -rf ~/.claude/skills/my-skill  # portability: allow
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill  # portability: allow

# 3. Develop, test, commit, push, PR, merge

# 4. Deploy (restores tracked version from main)
~/.claude/scripts/deploy.sh  # portability: allow
```

The symlink target is whatever checkout holds the branch — the dev clone, a worktree, or a tool-managed session:

| Context | Target |
|---------|--------|
| Direct development | `~/code/dotclaude/skills/<name>` |
| Worktree branch | `~/.worktrees/dotclaude/<branch>/skills/<name>` |
| Conductor / Orca / workspaces session | `<session-root>/skills/<name>` |

`deploy.sh` removes any symlink under `~/.claude/skills/` regardless of where it points. <!-- portability: allow -->

### Deleting a Skill

```bash
# In dev repo: delete the skill directory, commit on branch, merge PR
# Deploy pulls the deletion:
~/.claude/scripts/deploy.sh  # portability: allow
```

## Runtime Config Changes

`settings.json` is **not tracked**. It is the live runtime file: Claude Code writes to it
(`/model`, `/config`), other apps rewrite their own hooks in it, and it is the only place an
`autoMode.environment` description of this machine's infrastructure can live — the classifier
reads `autoMode` from user or managed settings, never from a repository. Keeping that out of a
public repo is why the file is gitignored, and it also means app drift no longer dirties the
tree, so `deploy.sh` can fast-forward.

`settings.example.json` is the shareable shape: this repo's own hooks, permissions, plugins,
and defaults, with machine-specific forwarders and the environment block removed. Change it
when the shape changes, through a PR like any other file.

Never `cp ~/.claude/settings.json` into this repo. <!-- portability: allow --> To seed a new machine, copy the example the
other way and fill it in:

```bash
cp ~/code/dotclaude/settings.example.json ~/.claude/settings.json  # portability: allow
```

Everything else (new skills, workflow changes, doc updates) goes through feature branches and
PRs in `~/code/dotclaude` the same way.

## Setup (Fresh)

```bash
DEV_REPO=~/code/dotclaude

# 1. Clone the dev repo (if not already)
git clone git@github.com:fairchild/dotclaude.git "$DEV_REPO"

# 2. Back up the current runtime clone
mv ~/.claude ~/.claude-backup  # portability: allow

# 3. Clone the deploy target
git clone git@github.com:fairchild/dotclaude.git ~/.claude  # portability: allow

# 4. Restore gitignored runtime data (sessions, caches, plugins)
rsync -a --exclude='.git/' --exclude='.git' --ignore-existing \
  ~/.claude-backup/ ~/.claude/  # portability: allow

# 5. Verify
git -C ~/.claude log --oneline -1  # portability: allow
git -C "$DEV_REPO" log --oneline -1
# Both should show the same HEAD commit
```

## Setup (Migrate from Worktree)

If `~/.claude` is currently a worktree of `~/code/dotclaude`: <!-- portability: allow -->

```bash
DEV_REPO=~/code/dotclaude

# 1. Remove the worktree registration (keeps files in place)
git -C "$DEV_REPO" worktree remove ~/.claude --force  # portability: allow

# 2. Re-init the runtime clone as standalone
cd ~/.claude  # portability: allow
git init
git remote add origin git@github.com:fairchild/dotclaude.git
git fetch origin
git reset --hard origin/main

# 3. Delete the runtime branch (no longer needed)
git -C "$DEV_REPO" branch -D runtime
git push origin --delete runtime

# 4. Verify
git -C ~/.claude log --oneline -1  # portability: allow
git -C "$DEV_REPO" log --oneline -1
```

## Auto-Sync Hook

The `SessionStart` hook runs `scripts/deploy.sh` so merged PRs are live at next session start. Place it **first** so other hooks see updated code:

```jsonc
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/scripts/deploy.sh"  // portability: allow
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

Three origins coexist in `~/.claude/skills/`: <!-- portability: allow -->

| Source | Tracked | Notes |
|--------|---------|-------|
| **Git-tracked** | Yes | Canonical, version-controlled |
| **Ecosystem-installed** | No | From `npx skills install`, runtime-only |
| **Dev symlinks** | No | Temporary, cleaned by deploy script |

## Gotchas

- **Never develop directly in `~/.claude`** — it's the deploy target, read/fast-forward only. `main` is protected; never commit there. <!-- portability: allow -->
- **Dev symlinks shadow tracked skills** — a symlink at `~/.claude/skills/foo` overrides a tracked `skills/foo`. The deploy script handles cleanup, but be aware during development. <!-- portability: allow -->
- **Keep `~/.claude` clean before deploying** — the deploy script fast-forwards only when the runtime tree has no local commits and no uncommitted drift; otherwise it warns and skips. <!-- portability: allow -->
- **`settings.json` drifts, and that is fine** — Claude Code and the workspaces app modify it at runtime. It is gitignored, so the drift never dirties the tree or blocks a fast-forward. Change `settings.example.json` by PR when the shareable shape changes.
- **Claude Code recreates `~/.claude`** — if you move it while a session is active, Claude Code may recreate it. Close all sessions first. <!-- portability: allow -->

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
rm -rf ~/.claude  # portability: allow
git clone git@github.com:fairchild/dotclaude.git ~/.claude  # portability: allow
rsync -a --ignore-existing ~/.claude-backup/ ~/.claude/  # portability: allow
```
