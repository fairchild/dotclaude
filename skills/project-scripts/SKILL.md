---
name: project-scripts
description: >
  Standardize project lifecycle scripts (setup, run, stop, archive) in scripts/
  so agents can manage workspaces through a single interface across runtimes
  (Conductor, Claude Code hooks, devcontainers, Cursor, Codex).
  Use when bootstrapping lifecycle scripts, auditing a project's setup/run workflow,
  or wiring scripts into a runtime config like conductor.json or devcontainer.json.
license: Apache-2.0
---

# Project Scripts

Single-file shell scripts in `scripts/` are the portable source of truth for project lifecycle actions. Runtimes (Conductor, Claude Code hooks, devcontainers, Cursor, Codex) reference them through their own config formats.

## The Four Actions

| Action | Purpose | When it runs |
|--------|---------|-------------|
| `setup` | Install deps, link env, run migrations | Workspace creation, CI start |
| `run` | Start dev server or primary workflow | Development, may be long-running |
| `stop` | Stop processes, clean transient state | Workspace pause, best-effort |
| `archive` | Package outputs, push branches, clean up | Before workspace destruction |

### setup
Idempotent. Install dependencies, copy secrets from `$CONDUCTOR_ROOT_PATH`, run `mise trust`. Should be safe to run repeatedly.

### run
Start the dev server or main workflow. May be long-running (blocks until killed). For projects without a dev server, this can run tests or a REPL.

### stop
Best-effort process cleanup. Kill dev servers, remove temp files. A missing stop script is a no-op.

### archive
Prepare for workspace teardown. Push uncommitted work, clean build artifacts, stash changes. The git-worktree skill's `wt archive` calls this via conductor.json.

## Script Conventions

- Location: `scripts/{action}` (extensionless preferred) or `scripts/{action}.sh`
- Shebang: `#!/usr/bin/env bash` with `set -euo pipefail`
- No positional args — use env vars (`$CONDUCTOR_ROOT_PATH`, `$CLAUDE_PROJECT_DIR`)
- Idempotent where possible, exit non-zero on failure
- Missing script = no-op (not all projects need all four actions)

## Detection Workflow

When this skill activates:

1. Check for `scripts/` directory
2. For each action, look for `scripts/{action}` then `scripts/{action}.sh`
3. Check existing runtime configs:
   - `conductor.json` — look for `scripts` object
   - `.devcontainer/devcontainer.json` — look for `postCreateCommand`
   - `.claude/settings.json` — look for hooks
4. Report what exists and offer to fill gaps

If no scripts exist, offer to bootstrap. If scripts exist but runtime configs are missing, offer to wire them in.

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

2. Create `scripts/` with ecosystem-appropriate defaults
3. `chmod +x` each script
4. Optionally wire into runtime config (conductor.json, devcontainer.json, etc.)

Automated scaffolding:
```bash
bash ~/.claude/skills/project-scripts/scripts/bootstrap.sh [ecosystem]
```

See [references/ecosystem-templates.md](references/ecosystem-templates.md) for per-ecosystem script and conductor.json templates.

## Wiring Into Runtimes

Each runtime has its own config format that points at the scripts:

| Runtime | Config file | setup | run |
|---------|------------|-------|-----|
| Conductor/wt.sh | `conductor.json` | `"setup": "bash scripts/setup"` | `"run": "bash scripts/run"` |
| Claude Code | `.claude/settings.json` | SessionStart hook | — |
| Devcontainer | `devcontainer.json` | `postCreateCommand` | `postStartCommand` |
| Cursor | `environment.json` | `workspace.setup` | `workspace.run` |
| Codex | `codex.yaml` | `lifecycle.setup` | `lifecycle.run` |
| GitHub Actions | `.github/workflows/*.yml` | `run: bash scripts/setup` | — |

See [references/adapters.md](references/adapters.md) for complete config snippets and env var details.

## Migrating Existing Scripts

If a project already has `bin/dev`, `Makefile`, `justfile`, or similar — wrap rather than replace:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec make setup
```

```bash
#!/usr/bin/env bash
set -euo pipefail
exec bin/dev
```

This preserves existing workflows while providing a consistent interface for runtimes.

## References

- [references/adapters.md](references/adapters.md) — Runtime adapter patterns with full config examples
- [references/ecosystem-templates.md](references/ecosystem-templates.md) — Per-ecosystem script and conductor.json templates
