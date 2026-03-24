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

## Safety

- `~/.claude` must always be a standalone git clone on `main`. Never symlink, move, or replace it. Worktrees go in `~/.worktrees/`, never at `~/.claude`.

## References

- `~/.claude/skills/dotclaude-config/references/permission-templates.md` - Copy-paste permission blocks
- `~/.claude/skills/dotclaude-config/references/hook-patterns.md` - Standard hook configurations
- `~/.claude/skills/dotclaude-config/references/project-config-checklist.md` - New project setup
- `bun ~/.claude/skills/dotclaude-config/scripts/inventory.ts` - Scan projects for config status

