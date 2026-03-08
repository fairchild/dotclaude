# dotclaude Development Workflow

## Architecture

Two locations, single `.git`, shared via worktree:

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` | Development — branches, PRs, worktrees |
| `~/.claude` | `runtime` | Live runtime — Claude Code reads this |

`git -C ~/.claude status` detects untracked/unignored files. The `.gitignore` covers ~30k+ ephemeral runtime files.

## Skill Sources

Three origins coexist in `~/.claude/skills/`:

| Source | Tracked | Example |
|--------|---------|---------|
| **Git-tracked** | Yes | `chronicle/`, `release/`, `dotclaude-config/` |
| **Ecosystem-installed** | No | `capture-screens/` (from `npx skills install`) |
| **External symlinks** | No | `slidev` → `~/.agents/skills/slidev` |

Ecosystem-installed and symlinked skills appear as untracked in `git status` — this is expected.

## Development Workflow

### Feature Development

```bash
# 1. Branch in dev clone
git -C ~/code/dotclaude checkout -b feat/my-skill main

# 2. Create skill
mkdir -p ~/code/dotclaude/skills/my-skill

# 3. Symlink for live testing
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# 4. Develop, test, commit in ~/code/dotclaude
# 5. Push, open PR

# 6. After merge: remove symlink, fast-forward runtime
rm ~/.claude/skills/my-skill
git -C ~/.claude merge main --ff-only
```

### After Merging Any PR

```bash
git -C ~/.claude merge main --ff-only
```

### Runtime-Specific Changes

When Claude Code modifies `settings.json` or other tracked files at runtime:

```bash
git -C ~/.claude add settings.json
git -C ~/.claude commit -m "chore: update settings from runtime"
git -C ~/code/dotclaude cherry-pick runtime
git push origin main
git -C ~/.claude merge main --ff-only
```

## Gotchas

- **Never develop directly in `~/.claude`** — it's the deployment target
- **Keep `.gitignore` comprehensive** — runtime generates ~30k ephemeral files; new patterns need adding when new runtime artifacts appear
- **External symlinks can shadow tracked skills** — if `~/.agents/skills/foo` and `~/code/dotclaude/skills/foo` both exist, the symlink wins in runtime
- **`settings.json` drifts** — Claude Code modifies it at runtime (effort level, plugins); sync regularly via cherry-pick workflow
- **Worktree branch constraint** — `~/code/dotclaude` must stay on `main`, `~/.claude` on `runtime`; git disallows two worktrees on the same branch

## Rollback

If the worktree setup breaks:

```bash
git -C ~/code/dotclaude worktree remove ~/.claude --force
# Restore from backup or re-clone
git clone https://github.com/fairchild/dotclaude.git ~/.claude
```
