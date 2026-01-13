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
- `bun ~/.claude/scripts/config-inventory.ts` - Scan projects for config status