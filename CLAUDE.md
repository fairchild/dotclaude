# About Me

My name is Michael.

## Development Tools

- **Python**: uv for dependencies and scripts
- **TypeScript**: bun for runtime and package management
- **mise** for runtimes and environment variables (`.mise.toml`)
- Prefer single-file scripts over MCP servers

Detect package manager from lockfile: `bun.lock` → bun, `pnpm-lock.yaml` → pnpm, `uv.lock` → uv

## Coordination, Scripts, and Memory

- **Use agent-inbox for cross-agent coordination** when `.agents/inbox/*` is present or when the task benefits from explicit file-based messaging between agents.
- **Use cmux-orchestrator when available** for multi-pane or multi-session orchestration workflows. Confirm the local skill/package shape before depending on it.
- **Prefer project-scripts** when a repo supports them: use standardized `scripts/` entrypoints for setup, run, stop, and archive, with `mise` as the preferred orchestrator when present.
- **Memory is available**. Use `chronicle`, `team-memory`, or `persona-memory` when continuity across sessions, recall, or durable context would help.

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

- `~/.claude/skills/dotclaude-config/references/permission-templates.md` - Copy-paste permission blocks
- `~/.claude/skills/dotclaude-config/references/hook-patterns.md` - Standard hook configurations
- `~/.claude/skills/dotclaude-config/references/project-config-checklist.md` - New project setup
- `bun ~/.claude/skills/dotclaude-config/scripts/inventory.ts` - Scan projects for config status

## dotclaude Development

This repo (`fairchild/dotclaude`) tracks Claude Code configuration: skills, agents, hooks, settings, and references. Two independent clones, connected by `origin/main`:

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` + feature branches | **Development** — branches, PRs |
| `~/.claude` | `main` | **Deploy target** — Claude Code reads this |

### After Merging a PR

```bash
~/.claude/scripts/deploy.sh
```

The deploy script removes dev symlinks and fast-forwards `~/.claude` to `origin/main`. A `SessionStart` hook runs this automatically.

### Developing Skills

```bash
# 1. Feature branch in dev repo
git -C ~/code/dotclaude checkout -b feat/my-skill main
mkdir -p ~/code/dotclaude/skills/my-skill

# 2. Symlink into runtime for live testing
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# 3. Develop, test, commit, push, PR, merge

# 4. Deploy (removes symlink, pulls new code)
~/.claude/scripts/deploy.sh
```

### Runtime Config Changes

Claude Code sometimes modifies `settings.json` automatically (adding permissions, changing model, etc.). These small mechanical changes push directly from `~/.claude` — no branch or PR needed:

```bash
git -C ~/.claude add settings.json
git -C ~/.claude commit -m "chore: update settings from runtime"
git -C ~/.claude push origin main
# Dev repo catches up: git -C ~/code/dotclaude pull
```

All other development (new skills, workflow changes, doc updates) goes through feature branches and PRs in `~/code/dotclaude`.

### Key Rules

- **All development happens in `~/code/dotclaude`** — feature branches, PRs, code review
- **`~/.claude` is deploy-only** — only commit small runtime config changes there
- **Symlink direction**: `~/.claude/skills/<name>` → `~/code/dotclaude/skills/<name>`
- **Ecosystem installs** (`npx skills install`) land in `~/.claude/skills/` as real directories, not tracked
- **Full workflow docs**: `skills/dotclaude-config/references/development-workflow.md`