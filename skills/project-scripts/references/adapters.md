# Runtime Adapters

How to wire `scripts/` lifecycle actions into each runtime's config format.

## Conductor / wt.sh

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
- `wt.sh` reads `conductor.json` via `get_conductor_script()` (see `skills/git-worktree/scripts/wt.sh:136`)
- `setup` runs automatically on `wt <branch>` (worktree creation)
- `archive` runs on `wt archive` (worktree teardown)
- `$CONDUCTOR_ROOT_PATH` is set to the main repo path before scripts execute
- If no conductor.json exists, wt.sh falls back to copying `.env` files

**Key detail:** conductor.json `scripts` values are passed directly to `eval`, so they can be inline commands or script references.

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
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/stop"
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
| stop | `Stop` | Runs when agent completes |

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
