# Development

`~/.claude` and `~/code/dotclaude` are two independent clones of the same repo, both on `main`. One is for development, the other is the deploy target.

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` + feature branches | Development — branches, PRs |
| `~/.claude` | `main` | Deploy target — Claude Code reads this |

## Auto-Deploy

A `SessionStart` hook runs `hooks/dotclaude-deploy.sh`, which delegates to `scripts/deploy.sh`. On every session start it:

1. Removes dev symlinks (skills pointing back to `~/code/dotclaude`)
2. Fetches and fast-forwards `~/.claude` to `origin/main`
3. Reports what changed (silent when nothing did)

After merging a PR, the next session start picks it up automatically.

## Skill Sources

Three origins coexist in `~/.claude/skills/`:

| Source | Tracked | Example |
|--------|---------|---------|
| **Git-tracked** | Yes | `chronicle/`, `release/`, `dotclaude-config/` |
| **Ecosystem-installed** | No | `capture-screens/` (from `npx skills install`) |
| **Dev symlinks** | No | Temporary, cleaned by deploy script |

Ecosystem-installed skills appear as untracked in `git status` — this is expected.

## Developing a Skill

```bash
# 1. Branch in dev clone
git -C ~/code/dotclaude checkout -b feat/my-skill main

# 2. Create skill
mkdir -p ~/code/dotclaude/skills/my-skill

# 3. Symlink for live testing
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# 4. Develop, test, commit in ~/code/dotclaude
# 5. Push, open PR, merge

# 6. Deploy (removes symlink automatically, pulls new code)
~/.claude/scripts/deploy.sh
```

## Runtime Config Changes

Claude Code sometimes modifies `settings.json` automatically (adding permissions, changing model, etc.). These small mechanical changes push directly — no branch or PR needed:

```bash
git -C ~/.claude add settings.json
git -C ~/.claude commit -m "chore: update settings from runtime"
git -C ~/.claude push origin main

# Dev repo catches up whenever needed:
git -C ~/code/dotclaude pull
```

All other development (new skills, workflow changes, doc updates) goes through feature branches and PRs in `~/code/dotclaude`.

## Gitignore

The runtime generates ~30k+ ephemeral files (session history, debug logs, chronicle blocks, caches). The `.gitignore` covers all of them. When new runtime artifacts appear, add patterns so `git -C ~/.claude status` stays clean.

## Rollback

```bash
rm -rf ~/.claude
git clone https://github.com/fairchild/dotclaude.git ~/.claude
```
