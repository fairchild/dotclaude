# Developing Chronicle

Guide for working on the Chronicle skill itself.

## Ports

| Mode | Port | Purpose |
|------|------|---------|
| Development | 3456 | Local dev, tests |
| Service | 3457 | launchd background service |

The dashboard reads `PORT` env variable, defaulting to 3456.

## Quick Start

```bash
# Start development server (auto-reload on changes)
/chronicle dev

# Or manually:
bun --watch ~/.claude/skills/chronicle/scripts/dashboard.ts
```

Opens browser to http://localhost:3456

## Development Modes

### watch (recommended)
```bash
bun --watch ~/.claude/skills/chronicle/scripts/dashboard.ts
```
Full process restart when files change. Reliable.

### hot
```bash
bun --hot ~/.claude/skills/chronicle/scripts/dashboard.ts
```
In-place hot reload. Faster but may have state issues.

## Running Tests

```bash
./skills/chronicle/tests/run_tests.sh
```

This will:
1. Kill any existing process on port 3456
2. Start the dashboard server
3. Run flows.py (12 behavioral tests)
4. Run edge_cases.py (7 edge case tests)
5. Stop the server

Tests use Playwright and are self-contained uv scripts (PEP 723).

### Running Individual Test Files

```bash
# Start server manually first
bun skills/chronicle/scripts/dashboard.ts &

# Run specific test file
./skills/chronicle/tests/flows.py
./skills/chronicle/tests/edge_cases.py

# Stop server
kill %1
```

## Service vs Development

When developing, **stop the service first** to avoid port conflicts:

```bash
# Stop service
launchctl unload ~/Library/LaunchAgents/com.chronicle.dashboard.plist

# Develop on port 3456
bun --watch ~/.claude/skills/chronicle/scripts/dashboard.ts

# When done, restart service (runs on port 3457)
launchctl load ~/Library/LaunchAgents/com.chronicle.dashboard.plist
```

Or run both simultaneously:
- Service: http://localhost:3457 (production, from ~/.claude)
- Dev: http://localhost:3456 (your worktree changes)

## File Structure

```
skills/chronicle/
├── SKILL.md                 # Skill documentation
├── scripts/
│   ├── dashboard.ts         # Main dashboard (single-file Bun server)
│   ├── queries.ts           # Shared query utilities
│   ├── extract.ts           # Session extraction
│   ├── extract-lib.ts       # Extraction utilities
│   └── publish.ts           # Digest generation
├── config/
│   └── com.chronicle.dashboard.plist  # launchd service config
├── docs/
│   ├── chronicle-design.md  # Original design document
│   ├── dashboard-service.md # Service management docs
│   └── development.md       # This file
└── tests/
    ├── run_tests.sh         # Test runner
    ├── flows.py             # Behavioral flow tests
    └── edge_cases.py        # Edge case tests
```

## Dashboard Architecture

The dashboard (`dashboard.ts`) is a single-file Bun server with:
- Embedded HTML/CSS/JS (no build step)
- REST API endpoints for data
- Worktree management endpoints
- Chronicle block queries

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | HTML dashboard |
| `/api/data` | GET | Chronicle blocks + stats |
| `/api/worktrees` | GET | Worktree list |
| `/api/worktrees/create` | POST | Create new worktree |
| `/api/worktrees/archive` | POST | Archive worktree |

## Making Changes

1. **Stop service** if running
2. **Start dev server**: `bun --watch skills/chronicle/scripts/dashboard.ts`
3. **Make changes** - server auto-restarts
4. **Run tests**: `./skills/chronicle/tests/run_tests.sh`
5. **Commit** when tests pass

## Common Tasks

### Add a new API endpoint

1. Add route handler in the `fetch()` function (~line 2079)
2. Add corresponding frontend fetch call in the `<script>` section
3. Add test in `flows.py` or `edge_cases.py`

### Modify the UI

1. CSS: Edit the `<style>` section (~line 497)
2. HTML: Edit the `<body>` section (~line 1306)
3. JS: Edit the `<script>` section (~line 1333)

### Update test expectations

Tests are in Python using Playwright:
- `flows.py`: Main user flow tests
- `edge_cases.py`: Edge case and stress tests

Both are self-contained uv scripts - just edit and run.
