# dotclaude

**THIS IS ~/.claude** — the global Claude Code configuration directory.

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

All skills are Apache 2.0 — consistent with Anthropic skills. Attribution is handled per-skill in each skill's README.md.

## Skill Tiers

Every first-party skill is in one tier, declared in `SKILL.md` frontmatter. The README tables are generated from this (`mise run catalog`); CI fails when they drift.

| Tier | Declared by | Meaning |
|------|-------------|---------|
| stable | no `metadata.status` | Has a skill eval, a deterministic eval, or sustained real use (`analyze-usage` shows invocations) |
| experimental | `metadata.status: experimental` + `metadata.experimental_reason` | Usable; the reason states what keeps it from stable |
| local | listed in `skills/.gitignore` | Lives only in `~/.claude`; personal or not ready to publish |

Promotion is removing `metadata.status` once the gate is met. Demotion is adding it back with a reason. A skill nobody has invoked in months is a candidate for deletion, not for experimental — git keeps it.

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

`main` is protected, so nothing — including `~/.claude` — pushes to it directly. When Claude Code or another app (e.g. the workspaces hook installer) modifies `~/.claude/settings.json` at runtime, codify the change through a PR from the dev repo:

```bash
cp ~/.claude/settings.json ~/code/dotclaude/settings.json
git -C ~/code/dotclaude checkout -b chore/settings-sync main
git -C ~/code/dotclaude add settings.json
git -C ~/code/dotclaude commit -m "chore: sync settings.json from runtime"
git -C ~/code/dotclaude push -u origin chore/settings-sync
gh pr create --fill   # review, merge
```

After merge, discard the now-redundant runtime drift so the tree is clean, then deploy:

```bash
git -C ~/.claude checkout settings.json
~/.claude/scripts/deploy.sh
```

Until you do this, `~/.claude` shows `settings.json` as modified and the `SessionStart` auto-deploy skips. Everything else (new skills, workflow changes, doc updates) goes through feature branches and PRs in `~/code/dotclaude` the same way.

### Key Rules

- **All development happens in `~/code/dotclaude`** — feature branches, PRs, code review
- **`~/.claude` is deploy-only** — read and fast-forward only; never commit there. `main` is protected, so even runtime `settings.json` drift is codified via a dev-repo PR
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
