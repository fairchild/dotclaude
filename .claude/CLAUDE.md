# dotclaude

This repo is the source of `~/.claude`, the global Claude Code configuration directory. What merges to `main` deploys there and reaches every Claude Code session:

- `skills/` → available in every session
- `commands/` → slash commands everywhere
- `agents/` → background agents everywhere
- `settings.json` → global permissions, hooks, model (gitignored; `settings.example.json` is the tracked shape)
- `CLAUDE.md` (root) → personal instructions for all projects

This repo is public on GitHub but serves as the owner's actual working config.

## Opensource

**This repo is public.** Never commit secrets, credentials, or personal data.

- Commits, PR bodies, review comments, and tracked text refer to the owner as "the user", never by name; `LICENSE` and authorship metadata are the exception
- Private repositories stay out of tracked files, commit messages, and PR text: no names, paths, issue numbers, or run IDs
- Session data is gitignored (see [session-data.md](../skills/chronicle/assets/docs/session-data.md))
- Run `/opensource-precheck` before major changes
- Use `.gitignore` patterns for any new sensitive data

## Licensing

All skills are Apache 2.0 — consistent with Anthropic skills. Attribution is handled per-skill in each skill's README.md.

## Skill Tiers

Every first-party skill is in one tier, declared in `SKILL.md` frontmatter. The README tables are generated from this (`mise run catalog`); CI fails when they drift.

| Tier | Declared by | Meaning |
|------|-------------|---------|
| stable | no `metadata.status` | Has a skill eval, a deterministic eval, or sustained real use (`analyze-usage` shows invocations) |
| experimental | `metadata.status: experimental` + `metadata.experimental_reason` | Usable; the reason states what keeps it from stable |
| superseded | `metadata.status: superseded` + `metadata.superseded_reason` | Something else does the job now; kept on disk and reachable as `/name` |
| local | listed in `skills/.gitignore` | Lives only in `~/.claude`; personal or not ready to publish |

Promotion is removing `metadata.status` once the gate is met. Demotion is adding it back with a reason. A skill nobody has invoked in months is a candidate for deletion, not for experimental — git keeps it.

Superseded is the tier for a skill whose job moved somewhere else while the text stays worth reading — a carried-in voice guide folded into a local one, an approach replaced by a better one. It is not a synonym for unused: a skill nobody replaced and nobody invokes still gets deleted. Because the successor is the one that should load, a superseded skill normally sets `disable-model-invocation: true`; validation warns when it does not.

`disable-model-invocation: true` is orthogonal: it says a skill runs only as `/name`, not how mature it is.

Skills carried from another repo declare `origin:` (copied) or `inspired-by:` (reworked) and carry a `README.md` with credits; CI checks both.

## Conventions

- New skills: `/skill-building`
- Commands: `commands/{name}.md`
- Scripts: black-box, use `--help`
- After editing any frontmatter: `mise run catalog`

## Testing

```bash
bun webui/scan.ts && bun webui/serve.ts  # visualize
bunx playwright test -c webui/           # E2E
```

## PR Reviews

Review with `/review-pr`; drive your own PR to merge-ready with `pr-closeout`. The review bot follows `.github/copilot-instructions.md`, which uses the same blocking / deferrable / nit marks.

## Development

Two independent clones, both on `main`: `~/code/dotclaude` for development (branches, PRs) and
`~/.claude` as the deploy target Claude Code reads. A `SessionStart` hook runs
`~/.claude/scripts/deploy.sh`, which removes dev symlinks and fast-forwards to `origin/main`.
[docs/development.md](../docs/development.md) has the full workflow.

- **All development happens in `~/code/dotclaude`**: feature branches, PRs, code review.
- **`~/.claude` is deploy-only**: read and fast-forward, never commit there.
- **Live-test a skill** by symlinking `~/.claude/skills/<name>` → `~/code/dotclaude/skills/<name>`; deploy removes the link.
- **`settings.json` is not tracked.** It is the live runtime file, and the only place an `autoMode.environment` description of this machine can live. Never copy it into this repo; change `settings.example.json`, the shareable shape, through a PR.
- **Ecosystem installs**: `npx skills add <repo>` places content in `~/.agents/skills/<name>/`, linked into `~/.claude/skills/` per `dotagents.toml`. This repo doesn't vendor third-party skill content; `~/.agents/.skill-lock.json` holds provenance.

## Agent skills

Per-repo configuration for the engineering skills (`to-issues`, `triage`, `to-prd`, `diagnose`, `tdd`, `improve-codebase-architecture`, `zoom-out`).

### Issue tracker

Work lives as markdown files under `backlog/{inbox,todo,doing,done,failed}/` via the `backlog` skill — not GitHub Issues. State is directory location; the strategic layer is `backlog/ROADMAP.md`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map to position in the pipeline + `priority:` frontmatter, not a separate label axis. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `GLOSSARY.md` + `docs/adr/` at the repo root, created lazily by `/grill-with-docs`; `CONTEXT.md` is a redirect stub. See `docs/agents/domain.md`.
