# dotclaude

**THIS IS ~/.claude** - the global Claude Code configuration directory.

You are working inside the user's home Claude config, not a regular project.
Everything here affects ALL Claude Code sessions globally:

- `skills/` → available in every session
- `commands/` → slash commands everywhere
- `agents/` → background agents everywhere
- `settings.json` → global permissions, hooks, model
- `CLAUDE.md` (root) → personal instructions for all projects

This repo is public on GitHub but serves as Michael's actual working config.

## Licensing

All skills are Apache 2.0 - consistent with Anthropic skills.

## Frontmatter

```yaml
license: Apache 2.0              # all skills (root LICENSE applies)
origin: https://github.com/...   # provenance URL (absence = mine)
status: wip                      # work in progress (absence = ready)
```

### From Anthropic (untouched)
- canvas-design, frontend-design, mcp-builder
- skill-creator, web-artifacts-builder, webapp-testing

### WIP
- rate-title, session-title-eval

## Conventions

- New skills: `/skill-creator`
- Commands: `commands/{name}.md`
- Scripts: black-box, use `--help`

## Testing

```bash
bun webui/scan.ts && bun webui/serve.ts  # visualize
bunx playwright test -c webui/           # E2E
```

## Cloning

See README.md - customize CLAUDE.md + settings.json, prune unwanted skills.
