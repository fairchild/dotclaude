# Scripts

Lifecycle and utility scripts for dotclaude.

## Usage

```bash
# Direct
bash scripts/setup

# Via conductor
# conductor.json wires setup/run/stop/archive automatically
```

## Lifecycle Scripts

| Script | Description |
|--------|-------------|
| `setup` | Install deps (uv sync), link env, trust mise |
| `run` | Start webui dev server |
| `stop` | Stop webui server |
| `archive` | Teardown workspace — stops processes, syncs git changes |

## Utility Scripts

| Script | Description |
|--------|-------------|
| `claude-usage.py` | Check Claude usage limits (`uv run scripts/claude-usage.py --human`) |
| `pr-status.ts` | Fetch PR status, review comments, CI checks (`bun scripts/pr-status.ts`) |
