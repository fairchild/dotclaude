---
name: project-scripts
description: >
  Standardize project lifecycle scripts (setup, run, stop, archive) in scripts/
  so agents can manage workspaces through a single interface across runtimes.
  Scripts are portable bash; mise is the recommended orchestrator when available,
  with adapters for Conductor, Claude Code hooks, devcontainers, Cursor, and Codex.
  Use when bootstrapping lifecycle scripts, auditing a project's setup/run workflow,
  or wiring scripts into a runtime config like mise.toml or conductor.json.
license: Apache-2.0
---

# Project Scripts

Single-file shell scripts in `scripts/` are the portable source of truth for project lifecycle actions. When mise is available, it orchestrates them with dependency management, environment injection, and automatic lifecycle hooks. Other runtimes (Conductor, Claude Code, devcontainers) reference scripts through their own config formats.

## The Four Actions

| Action | Purpose | When it runs |
|--------|---------|-------------|
| `setup` | Install deps, link env, run migrations | Workspace creation, CI start |
| `run` | Start dev server or primary workflow | Development, may be long-running |
| `stop` | Stop processes, clean transient state | Workspace pause, session end |
| `archive` | Package outputs, push branches, clean up | Before workspace destruction |

### setup
Idempotent and fast when nothing has changed. Should check state before doing work — if deps are installed and env is linked, exit early. This matters because mise's `enter` hook runs setup on every project entry. Safe to run repeatedly.

### run
Start the dev server or main workflow. May be long-running (blocks until killed). For projects without a dev server, this can run tests or a REPL.

### stop
Idempotent process cleanup. Kill dev servers, remove temp files. Must be safe to call multiple times or when nothing is running. A missing stop script is a no-op.

### archive
Prepare for workspace teardown. Depends on `stop` — mise handles this automatically via `#MISE depends=["stop"]`. For non-mise callers, archive scripts defensively call `scripts/stop` before cleanup.

## Script Conventions

- Location: `scripts/{action}` (extensionless preferred) or `scripts/{action}.sh`
- Shebang: `#!/usr/bin/env bash` with `set -euo pipefail`
- Optional `#MISE` metadata comments for description, dependencies, tool requirements
- No positional args — use env vars (`$CONDUCTOR_ROOT_PATH`, `$CLAUDE_PROJECT_DIR`)
- Idempotent where possible, exit non-zero on failure
- `setup` must be idempotent and fast — exit early when nothing to do
- `stop` must always be idempotent — safe to call when nothing is running
- `archive` should call `scripts/stop` before cleanup (defensive fallback for non-mise callers)
- Missing script = no-op (not all projects need all four actions)

### #MISE metadata

Scripts can include optional mise metadata as comments. These are ignored by bash but enable mise features when invoked via `mise run`:

```bash
#!/usr/bin/env bash
#MISE description="Install deps, link env"
#MISE depends=["other-task"]
#MISE tools={bun="1.1"}
set -euo pipefail
bun install
```

## mise Integration (Recommended)

When mise is available, it's the best way to run lifecycle scripts. One line in `mise.toml` bridges `scripts/` to the mise task system:

```toml
[task_config]
includes = ["scripts"]
```

This makes all scripts in `scripts/` available as mise tasks: `mise run setup`, `mise run stop`, etc.

### Lifecycle hooks

mise can automatically run setup on project entry and stop on project exit (requires `mise activate` in shell):

```toml
[hooks]
enter = { task = "setup" }
leave = { task = "stop" }
```

The `enter` hook fires once when you cd into the project — not on every directory change within it. This gives automatic setup without manual invocation.

### Dependency management

With `#MISE depends=["stop"]` in the archive script, `mise run archive` automatically runs stop first. No manual chaining needed. Dependencies are resolved as a DAG.

### What mise adds

| Feature | `bash scripts/X` | `mise run X` |
|---------|-------------------|-------------|
| Dependencies | Manual (defensive calls) | Declarative (`depends`) |
| Auto-setup on cd | No | `enter` hook |
| Tool pinning | External | `#MISE tools={bun="1.1"}` |
| Task discovery | `ls scripts/` | `mise tasks ls` |
| Parallel execution | No | `mise run setup lint test` |
| Environment injection | Manual | `[env]` in mise.toml |

### Fallback

Scripts always work as `bash scripts/setup` without mise. The `#MISE` lines are just comments to bash. This ensures portability to CI, devcontainers, and any environment where mise isn't installed.

## Detection Workflow

When this skill activates:

1. Check for `scripts/` directory
2. For each action, look for `scripts/{action}` then `scripts/{action}.sh`
3. Check if mise.toml has `task_config.includes = ["scripts"]`
4. Check existing runtime configs:
   - `conductor.json` — look for `scripts` object
   - `.devcontainer/devcontainer.json` — look for `postCreateCommand`
   - `.claude/settings.json` — look for hooks
5. Report what exists and offer to fill gaps

If no scripts exist, offer to bootstrap. If scripts exist but mise integration or runtime configs are missing, offer to wire them in.

## Bootstrap Workflow

To scaffold lifecycle scripts for a project:

1. Detect ecosystem from lockfile:

| Lockfile | Ecosystem |
|----------|-----------|
| `bun.lock` | bun |
| `pnpm-lock.yaml` | pnpm |
| `uv.lock` | uv |
| `package-lock.json` | npm |
| `Cargo.lock` | cargo |

2. Create `scripts/` with ecosystem-appropriate defaults and `#MISE` metadata
3. `chmod +x` each script
4. Optionally add `task_config.includes = ["scripts"]` to mise.toml
5. Optionally wire into other runtime configs (conductor.json, devcontainer.json, etc.)

Automated scaffolding:
```bash
bash ~/.claude/skills/project-scripts/scripts/bootstrap.sh [ecosystem]
```

See [references/ecosystem-templates.md](references/ecosystem-templates.md) for per-ecosystem script and conductor.json templates.

## Wiring Into Other Runtimes

For environments without mise, each runtime has its own config format:

| Runtime | Config file | startup | teardown |
|---------|------------|---------|----------|
| Conductor | `conductor.json` | `setup` on create | `stop` then `archive` on teardown |
| Claude Code | `.claude/settings.json` | `SessionStart` hook | `session_end` hook (stop + archive) |
| Devcontainer | `devcontainer.json` | `postCreateCommand` | Container handles teardown |
| Cursor | `environment.json` | `workspace.setup` | — |
| Codex | `codex.yaml` | `lifecycle.setup` | `lifecycle.stop` |
| GitHub Actions | `.github/workflows/*.yml` | `run: bash scripts/setup` | — |

See [references/adapters.md](references/adapters.md) for complete config snippets and env var details.

## Migrating Existing Scripts

If a project already has `bin/dev`, `Makefile`, `justfile`, or similar — wrap rather than replace:

```bash
#!/usr/bin/env bash
#MISE description="Setup project"
set -euo pipefail
exec make setup
```

This preserves existing workflows while providing a consistent interface for mise and other runtimes.

## References

- [references/adapters.md](references/adapters.md) — Runtime adapter patterns (mise, Conductor, Claude Code, devcontainers, etc.)
- [references/ecosystem-templates.md](references/ecosystem-templates.md) — Per-ecosystem script and conductor.json templates
