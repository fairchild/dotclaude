# dotclaude

**THIS IS ~/.claude** — the global Claude Code configuration directory.

Everything here affects ALL Claude Code sessions globally:

- `skills/` → available in every session
- `commands/` → slash commands everywhere
- `agents/` → background agents everywhere
- `settings.json` → global permissions, hooks, model (gitignored; `settings.example.json` is the tracked shape)
- `CLAUDE.md` (root) → personal instructions for all projects

This repo is public on GitHub but serves as Michael's actual working config.

## Opensource

**This repo is public.** Never commit secrets, credentials, or personal data.

- Session data is gitignored (see [docs/session-data.md](../docs/session-data.md))
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

See `.github/copilot-instructions.md` for code review style (shared with Copilot).

## Development Architecture

Two independent clones of this repo, both on `main`:

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

`settings.json` is **not tracked**. It is the live runtime file: Claude Code writes to it
(`/model`, `/config`), other apps rewrite their own hooks in it, and it is the only
place an `autoMode.environment` description of this machine's infrastructure can live — the
classifier reads `autoMode` from user or managed settings, never from a repository. Keeping
that out of a public repo is why the file is gitignored, and it also means app drift no longer
dirties the tree, so `deploy.sh` can fast-forward.

`settings.example.json` is the shareable shape: this repo's own hooks, permissions, plugins,
and defaults, with machine-specific forwarders and the environment block removed. Change it
when the shape changes, through a PR like any other file.

Never `cp ~/.claude/settings.json` into this repo. To seed a new machine, copy the example the
other way and fill it in:

```bash
cp ~/code/dotclaude/settings.example.json ~/.claude/settings.json
```

Everything else (new skills, workflow changes, doc updates) goes through feature branches and
PRs in `~/code/dotclaude` the same way.

### Key Rules

- **All development happens in `~/code/dotclaude`** — feature branches, PRs, code review
- **`~/.claude` is deploy-only** — read and fast-forward only; never commit there. `settings.json` is gitignored, so runtime drift no longer needs codifying; change `settings.example.json` when the shareable shape changes
- **Symlink direction**: `~/.claude/skills/<name>` → `~/code/dotclaude/skills/<name>`
- **Ecosystem installs**: `npx skills add <repo>` places content at `~/.agents/skills/<name>/`, symlinked into `~/.claude/skills/<name>`. Provenance (origin URL, commit hash, install timestamps) is tracked by the CLI in `~/.agents/.skill-lock.json`. This repo does not vendor third-party skill content; the lockfile is the source of truth.
- **Full workflow docs**: `skills/dotclaude-config/references/development-workflow.md`

## Agent skills

Per-repo configuration for the engineering skills (`to-issues`, `triage`, `to-prd`, `diagnose`, `tdd`, `improve-codebase-architecture`, `zoom-out`).

### Issue tracker

Work lives as markdown files under `backlog/{todo,doing,done,failed}/` via the `backlog` skill — not GitHub Issues. State is directory location; the strategic layer is `backlog/ROADMAP.md`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map to position in the pipeline + `priority:` frontmatter, not a separate label axis. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root, created lazily by `/grill-with-docs`. See `docs/agents/domain.md`.
