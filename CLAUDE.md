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

This repo (`fairchild/dotclaude`) tracks Claude Code configuration: skills, agents, hooks, settings, and references. It has two locations:

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` | **Development** — branches, PRs, worktrees |
| `~/.claude` | `runtime` | **Live runtime** — worktree, Claude Code reads this |

`~/.claude` is a **git worktree** of `~/code/dotclaude`. Single `.git`, no drift.

### After Merging a PR

```bash
git -C ~/.claude merge main --ff-only
```

### Workflow: Developing Skills

Skills must be "live" at `~/.claude/skills/<name>` to test. Use symlinks to bridge dev and runtime:

```bash
# 1. Create a feature branch in the dev clone
git -C ~/code/dotclaude checkout -b feat/my-skill main

# 2. Create the skill in the dev clone
mkdir -p ~/code/dotclaude/skills/my-skill

# 3. Symlink into live runtime for testing
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# 4. Develop, test, commit — all in ~/code/dotclaude
# 5. Push, open PR from ~/code/dotclaude

# 6. After merge, remove symlink and fast-forward runtime
rm ~/.claude/skills/my-skill
git -C ~/.claude merge main --ff-only
```

### Runtime-Specific Changes

When settings.json or other files are modified by Claude Code at runtime:

```bash
git -C ~/.claude add settings.json
git -C ~/.claude commit -m "chore: update settings from runtime"
git -C ~/code/dotclaude cherry-pick runtime
git push origin main
git -C ~/.claude merge main --ff-only
```

### Key Rules

- **Never develop directly in `~/.claude`** — it's the deployment target, not the workspace
- **Symlink direction**: `~/.claude/skills/<name>` -> `~/code/dotclaude/skills/<name>` (live points to dev)
- **Ecosystem installs** (`npx skills install`) land in `~/.claude/skills/` as real directories, not tracked here
- **Detect untracked files**: `git -C ~/.claude status`