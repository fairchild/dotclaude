# Ecosystem Templates

Per-ecosystem defaults for lifecycle scripts and conductor.json.

## Lockfile Detection

| Lockfile | Ecosystem | Setup | Run |
|----------|-----------|-------|-----|
| `bun.lock` | Bun | `bun install` | `bun dev` |
| `pnpm-lock.yaml` | pnpm | `pnpm install` | `pnpm dev` |
| `package-lock.json` | npm | `npm install` | `npm run dev` |
| `uv.lock` | uv/Python | `uv sync` | `uv run dev` |
| `Cargo.lock` | Cargo/Rust | `cargo build` | `cargo run` |

## Script Templates

### Bun / TypeScript

```bash
# scripts/setup
#!/usr/bin/env bash
#MISE description="Install deps, link env"
set -euo pipefail
[[ -f .mise.toml ]] && mise trust && mise install
bun install
[[ -n "${CONDUCTOR_ROOT_PATH:-}" && -f "$CONDUCTOR_ROOT_PATH/.env" ]] && cp "$CONDUCTOR_ROOT_PATH/.env" .env

# scripts/run
#!/usr/bin/env bash
#MISE description="Start dev server"
set -euo pipefail
bun dev

# scripts/stop (must be idempotent — safe when nothing is running)
#!/usr/bin/env bash
#MISE description="Stop processes"
set -euo pipefail
pkill -f "bun dev" 2>/dev/null || true

# scripts/archive (mise handles stop dep; defensive call for non-mise callers)
#!/usr/bin/env bash
#MISE description="Teardown workspace"
#MISE depends=["stop"]
set -euo pipefail
[[ -x scripts/stop ]] && bash scripts/stop
rm -rf node_modules .turbo
```

### pnpm / TypeScript

```bash
# scripts/setup
#!/usr/bin/env bash
#MISE description="Install deps, link env"
set -euo pipefail
[[ -f .mise.toml ]] && mise trust && mise install
pnpm install
[[ -n "${CONDUCTOR_ROOT_PATH:-}" && -f "$CONDUCTOR_ROOT_PATH/.env" ]] && cp "$CONDUCTOR_ROOT_PATH/.env" .env

# scripts/run
#!/usr/bin/env bash
#MISE description="Start dev server"
set -euo pipefail
pnpm dev
```

### uv / Python

```bash
# scripts/setup
#!/usr/bin/env bash
#MISE description="Install deps, link env"
set -euo pipefail
[[ -f .mise.toml ]] && mise trust && mise install
uv sync
[[ -n "${CONDUCTOR_ROOT_PATH:-}" && -f "$CONDUCTOR_ROOT_PATH/.env" ]] && cp "$CONDUCTOR_ROOT_PATH/.env" .env

# scripts/run
#!/usr/bin/env bash
#MISE description="Start dev server"
set -euo pipefail
uv run python -m app  # or: uv run uvicorn app:app --reload
```

### npm / Node

```bash
# scripts/setup
#!/usr/bin/env bash
#MISE description="Install deps, link env"
set -euo pipefail
npm install
[[ -n "${CONDUCTOR_ROOT_PATH:-}" && -f "$CONDUCTOR_ROOT_PATH/.env" ]] && cp "$CONDUCTOR_ROOT_PATH/.env" .env

# scripts/run
#!/usr/bin/env bash
#MISE description="Start dev server"
set -euo pipefail
npm run dev
```

### Cargo / Rust

```bash
# scripts/setup
#!/usr/bin/env bash
#MISE description="Build project"
set -euo pipefail
cargo build

# scripts/run
#!/usr/bin/env bash
#MISE description="Run project"
set -euo pipefail
cargo run
```

## mise.toml Integration

Add to your `mise.toml` to make scripts available as mise tasks:

```toml
[task_config]
includes = ["scripts"]
```

Then: `mise run setup`, `mise run archive`, `mise tasks ls`

For projects not managed by a harness, you can optionally add enter/leave hooks — see [adapters.md](adapters.md#mise-recommended) for details.

## conductor.json Templates

Each ecosystem's conductor.json points at the scripts:

```json
{
  "scripts": {
    "setup": "bash scripts/setup",
    "run": "bash scripts/run",
    "stop": "bash scripts/stop",
    "archive": "bash scripts/archive"
  }
}
```

For inline conductor.json (projects that don't need separate script files):

**Bun:**
```json
{
  "scripts": {
    "setup": "cp $CONDUCTOR_ROOT_PATH/.env .env && mise trust && bun install",
    "run": "bun dev",
    "archive": "rm -rf node_modules"
  }
}
```

**uv/Python:**
```json
{
  "scripts": {
    "setup": "cp $CONDUCTOR_ROOT_PATH/.env .env && mise trust && uv sync",
    "run": "uv run python -m app"
  }
}
```

## mise Integration

When `.mise.toml` is present, setup scripts should include:

```bash
mise trust && mise install
```

This ensures the correct runtime versions are available before installing dependencies.

## Secrets Handling

Use `$CONDUCTOR_ROOT_PATH` to symlink or copy secrets from the main repo:

```bash
# Copy approach (simple, works everywhere)
cp "$CONDUCTOR_ROOT_PATH/.env" .env

# Symlink approach (always up-to-date, but some tools don't follow symlinks)
ln -sf "$CONDUCTOR_ROOT_PATH/.env" .env
```

Common secret files: `.env`, `.env.local`, `.dev.vars`
