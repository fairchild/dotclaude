# Runtime Adapters

How to wire `scripts/` lifecycle actions into each runtime's config format.

## mise (Recommended)

**File:** `mise.toml` at project root

```toml
[task_config]
includes = ["scripts"]

[hooks]
enter = { task = "setup" }
leave = { task = "stop" }
```

**How it works:**
- `task_config.includes = ["scripts"]` makes all executables in `scripts/` available as mise tasks
- `mise run setup`, `mise run archive`, etc. invoke the scripts with mise's environment
- `enter` hook runs setup automatically when you cd into the project (requires `mise activate`)
- `leave` hook runs stop when you leave the project
- `#MISE depends=["stop"]` in archive script means `mise run archive` runs stop first automatically
- Env vars from `[env]` in mise.toml are injected into all tasks

**Env vars available:** `$MISE_PROJECT_ROOT`, `$MISE_CONFIG_ROOT`, `$MISE_TASK_NAME`

**Limitation:** `enter`/`leave` hooks only work in interactive shells with `mise activate`. CI, Claude Code sessions, and Conductor need direct invocation (`bash scripts/setup`) or the adapters below.

**TOML task wrappers (alternative):**

Instead of `task_config.includes`, you can wrap scripts as TOML tasks for richer metadata without modifying the scripts:

```toml
[tasks.setup]
description = "Install deps, link env"
file = "scripts/setup"

[tasks.archive]
description = "Teardown workspace"
depends = ["stop"]
file = "scripts/archive"
```

## Conductor

**File:** `conductor.json` at project root

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

**How it works:**
- Workspace managers read `conductor.json` and call the matching script for each lifecycle event
- `setup` runs on workspace creation; teardown runs `stop` then `archive`
- `$CONDUCTOR_ROOT_PATH` is set to the main repo path before scripts execute
- Script values are passed directly to `eval`, so they can be inline commands or script references

## Claude Code Hooks

**File:** `.claude/settings.json` in the project

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/setup"
          }
        ]
      }
    ],
    "session_end": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/stop"
          },
          {
            "type": "command",
            "command": "bash scripts/archive"
          }
        ]
      }
    ]
  }
}
```

**Mapping:**
| Action | Hook Event | Notes |
|--------|-----------|-------|
| setup | `SessionStart` | Runs once when session begins |
| stop + archive | `session_end` | Runs stop then archive when session ends |

**Env vars available:** `$CLAUDE_PROJECT_DIR`, `$CLAUDE_ENV_FILE`

## Devcontainers

**File:** `.devcontainer/devcontainer.json`

```json
{
  "postCreateCommand": "bash scripts/setup",
  "postStartCommand": "bash scripts/run"
}
```

**Mapping:**
| Action | Lifecycle Event | Notes |
|--------|----------------|-------|
| setup | `postCreateCommand` | Runs after container creation |
| run | `postStartCommand` | Runs each time container starts |
| stop | (not applicable) | Container handles stop |
| archive | (not applicable) | Container handles cleanup |

## Cursor

**File:** `environment.json` at project root

```json
{
  "workspace": {
    "setup": "bash scripts/setup",
    "run": "bash scripts/run"
  }
}
```

## Codex

**File:** `codex.yaml` or workspace config

```yaml
lifecycle:
  setup: bash scripts/setup
  run: bash scripts/run
  stop: bash scripts/stop
```

## GitHub Actions / CI

Reuse `scripts/setup` in CI pipelines for consistent environment setup:

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - name: Setup
        run: bash scripts/setup
      - name: Test
        run: bash scripts/run  # or specific test command
```

## Makefile / Justfile

Add Make or just targets as a convenience interface to scripts/:

```makefile
# Makefile
setup:
	bash scripts/setup
run:
	bash scripts/run
stop:
	bash scripts/stop
archive:
	bash scripts/archive
```

```just
# justfile
setup:
    bash scripts/setup
run:
    bash scripts/run
```

Note: If the project already has a Makefile or justfile with its own targets, have scripts/ delegate to it instead (see "Migrating Existing Scripts" in SKILL.md).

## Adding a New Adapter

To wire scripts into a new runtime:

1. Identify the runtime's lifecycle config file and format
2. Map the four actions (setup/run/stop/archive) to the runtime's events
3. Point each event at `bash scripts/{action}`
4. Document which env vars the runtime provides
