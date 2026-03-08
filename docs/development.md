# Development

`~/.claude` is a git worktree of `~/code/dotclaude`, not an independent clone. One `.git`, two working directories, no drift.

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` | Development — branches, PRs, worktrees |
| `~/.claude` | `runtime` | Live runtime — Claude Code reads this |

## Auto-Sync

A `SessionStart` hook keeps the runtime current. Every time Claude Code starts a session (in any project), it runs `hooks/runtime-sync.sh`, which fast-forwards the `runtime` branch to match `main` using the shared local object store (~0.08s, no network):

```bash
#!/usr/bin/env bash
git -C ~/.claude merge main --ff-only --quiet 2>/dev/null
exit 0
```

This is the first hook in the SessionStart list — it runs before chronicle or anything else, so updated skills are available immediately. The script always exits 0 so sessions start normally even if the merge fails.

Note: since this is local-only, the runtime sees new commits after you `git pull` in `~/code/dotclaude`, not immediately after a PR merges on GitHub.

After merging a PR, you don't need to do anything. The next session start picks it up automatically.

## Skill Sources

Three origins coexist in `~/.claude/skills/`:

| Source | Tracked | Example |
|--------|---------|---------|
| **Git-tracked** | Yes | `chronicle/`, `release/`, `dotclaude-config/` |
| **Ecosystem-installed** | No | `capture-screens/` (from `npx skills install`) |
| **External symlinks** | No | `slidev` → `~/.agents/skills/slidev` |

Ecosystem-installed and symlinked skills appear as untracked in `git status` — this is expected.

## Developing a Skill

```bash
# 1. Branch in dev clone
git -C ~/code/dotclaude checkout -b feat/my-skill main

# 2. Create skill
mkdir -p ~/code/dotclaude/skills/my-skill

# 3. Symlink for live testing
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# 4. Develop, test, commit in ~/code/dotclaude
# 5. Push, open PR

# 6. After merge: remove symlink (auto-sync handles the rest)
rm ~/.claude/skills/my-skill
```

## Runtime-Specific Changes

Claude Code sometimes modifies tracked files at runtime (e.g., `settings.json` gains a new `effortLevel`). To get those changes back into `main`:

```bash
git -C ~/.claude add settings.json
git -C ~/.claude commit -m "chore: update settings from runtime"
git -C ~/code/dotclaude cherry-pick runtime
git push origin main
git -C ~/.claude merge main --ff-only
```

## Gitignore

The runtime generates ~30k+ ephemeral files (session history, debug logs, chronicle blocks, caches). The `.gitignore` covers all of them. When new runtime artifacts appear, add patterns to `.gitignore` so `git -C ~/.claude status` stays clean.

## Why Worktree Over Two Clones

The previous setup had two independent clones of the same repo. They drifted — the runtime fell 10+ commits behind, tracked files diverged, and there was no sync mechanism. The worktree approach gives:

- **Single `.git`** — one history, one set of branches
- **`git status` as drift detection** — untracked files in `~/.claude` are visible immediately
- **Fast-forward merges** — `runtime` branch always moves forward to match `main`
- **Auto-sync on session start** — zero manual maintenance

## Rollback

If the worktree setup breaks:

```bash
git -C ~/code/dotclaude worktree remove ~/.claude --force
git clone https://github.com/fairchild/dotclaude.git ~/.claude
```
