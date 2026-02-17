# About Me

My name is Michael.

## Development Tools

- **Python**: uv for dependencies and scripts
- **TypeScript**: bun for runtime and package management
- **mise** for runtimes and environment variables (`.mise.toml`)
- Prefer single-file scripts over MCP servers

Detect package manager from lockfile: `bun.lock` → bun, `pnpm-lock.yaml` → pnpm, `uv.lock` → uv

## Code Philosophy

- Keep code well type hinted and concise
- Avoid comments and documentation that is clearly expressed by type hints and structure
- Code can be poetry

## Testing

Test behavior over implementation details

## Dependencies

- Minimal, stdlib-preferred
- Reach for external packages only when they provide clear value
- Clone repos to `~/code/github/*` when docs are insufficient

## Git

- Conventional commits (`feat:`, `fix:`, `chore:`, etc.)

## References

- `~/.claude/references/permission-templates.md` - Copy-paste permission blocks
- `~/.claude/references/hook-patterns.md` - Standard hook configurations
- `~/.claude/references/project-config-checklist.md` - New project setup
- `bun ~/.claude/skills/dotclaude-config/scripts/inventory.ts` - Scan projects for config status

## dotclaude Development

This repo (`fairchild/dotclaude`) tracks Claude Code configuration: skills, agents, hooks, settings, and references. It has two locations:

| Path | Role |
|------|------|
| `~/.claude` | **Live runtime** — Claude Code reads this directly |
| `~/code/dotclaude` | **Development clone** — where branches, PRs, and worktrees happen |

### Workflow: Developing Skills

Skills must be "live" at `~/.claude/skills/<name>` to test (visible in skills list, scripts runnable). Use symlinks to bridge dev and runtime:

```bash
# 1. Create a feature branch in the dev clone
git -C ~/code/dotclaude checkout -b feat/my-skill main

# 2. Create the skill in the dev clone
mkdir -p ~/code/dotclaude/skills/my-skill

# 3. Symlink into live runtime for testing
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# 4. Develop, test, commit — all in ~/code/dotclaude
# 5. Push, open PR from ~/code/dotclaude

# 6. After merge, pull in dev clone and remove symlink
git -C ~/code/dotclaude checkout main && git -C ~/code/dotclaude pull
rm ~/.claude/skills/my-skill  # remove symlink
# The skill arrives in ~/.claude via next pull/sync
```

For worktree or conductor-based development:
```bash
# Point symlink at a worktree
ln -s ~/.worktrees/dotclaude/feat-branch/skills/my-skill ~/.claude/skills/my-skill

# Or at a conductor session workspace
ln -s ~/conductor/<session>/skills/my-skill ~/.claude/skills/my-skill
```

Working directories by context:

| Context | Base Dir |
|---------|----------|
| Direct development | `~/code/dotclaude` |
| Worktree branches | `~/.worktrees/dotclaude/<branch>` |
| Conductor sessions | `~/conductor/<session>` |

### Key Rules

- **Never develop directly in `~/.claude`** — it's the deployment target, not the workspace
- **Symlink direction**: `~/.claude/skills/<name>` -> `~/code/dotclaude/skills/<name>` (live points to dev)
- **Ecosystem installs** (`npx skills install`) land in `~/.claude/skills/` as real directories, not tracked here
- **After merge**: pull `~/code/dotclaude`, then sync to `~/.claude` (pull or copy)