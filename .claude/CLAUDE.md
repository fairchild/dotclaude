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

## Opensource

**This repo is public.** Never commit secrets, credentials, or personal data.

- Session data is gitignored (see [docs/session-data.md](../docs/session-data.md))
- Run `/opensource-precheck` before major changes
- Use `.gitignore` patterns for any new sensitive data

## Licensing

All skills are Apache 2.0 - consistent with Anthropic skills.

## Frontmatter

```yaml
license: Apache 2.0              # all skills (root LICENSE applies)
origin: https://github.com/...   # provenance URL (absence = mine)
status: wip                      # work in progress (absence = ready)
```

### From Anthropic (untouched)
- canvas-design, frontend-design
- skill-creator, web-artifacts-builder, webapp-testing

## Skill Status Convention

| Prefix | Frontmatter | Meaning |
|--------|-------------|---------|
| (none) | (none) | Production-ready, auto-invoked |
| `wip-` | `status: wip` | Experimental, usable but incomplete |

WIP skills use **both** the directory prefix and frontmatter flag:
- `skills/wip-rate-title/` with `status: wip` in SKILL.md
- `skills/wip-session-title-eval/` with `status: wip` in SKILL.md

To promote a skill: remove `wip-` prefix and `status: wip` frontmatter.

## Conventions

- New skills: `/skill-creator`
- Commands: `commands/{name}.md`
- Scripts: black-box, use `--help`

## Testing

```bash
bun webui/scan.ts && bun webui/serve.ts  # visualize
bunx playwright test -c webui/           # E2E
```

## PR Reviews

See `.github/copilot-instructions.md` for code review style (shared with Copilot).

## Cloning

See README.md - customize CLAUDE.md + settings.json, prune unwanted skills.
