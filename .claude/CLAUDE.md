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
status: experimental              # optional — absent means production-ready
```

Attribution is handled per-skill in each skill's README.md.

## Skill Status Convention

Skills use a top-level `status` key in SKILL.md frontmatter. No directory prefix needed.

| Frontmatter | Meaning |
|-------------|---------|
| (none) | Production-ready, auto-invoked |
| `status: experimental` | Usable but incomplete |

To promote a skill: remove the `status` field from frontmatter.

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

## Development Architecture

`~/.claude` is a **git worktree** of `~/code/dotclaude` on the `runtime` branch.

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` | Development — branches, PRs, worktrees |
| `~/.claude` | `runtime` | Live runtime — Claude Code reads this |

**After merging a PR**: `git -C ~/.claude merge main --ff-only`

**Detect drift**: `git -C ~/.claude status` shows anything untracked and not gitignored.

**Skill sources in runtime**:
- Git-tracked (canonical)
- Ecosystem-installed (untracked, runtime-only)
- External symlinks (`~/.agents/`, `~/code/Skill_Seekers/`)

**Key rules**:
- Never develop directly in `~/.claude`
- Keep `.gitignore` comprehensive for runtime ephemeral data
- Symlink direction for testing: `~/.claude/skills/<name>` → `~/code/dotclaude/skills/<name>`
