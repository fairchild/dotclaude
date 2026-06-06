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

## Hook Boundaries

Passive event forwarders may observe lifecycle events, but they must not own
active lifecycle hooks. In particular, `WorktreeCreate` and `WorktreeRemove`
replace Claude Code's built-in worktree behavior; handlers for those events must
perform the worktree action and emit the expected result. Do not register the
WorkSpaces `event-forwarder.sh` on those events.

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

## Gitignore

The runtime generates ~30k+ ephemeral files (session history, debug logs, chronicle blocks, caches). The `.gitignore` covers all of them. When new runtime artifacts appear, add patterns so `git -C ~/.claude status` stays clean.

## Rollback

```bash
rm -rf ~/.claude
git clone https://github.com/fairchild/dotclaude.git ~/.claude
```
