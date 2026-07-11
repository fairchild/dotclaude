# Scripts

Lifecycle and utility scripts for dotclaude.

## Usage

```bash
# Direct
bash setup.sh        # full bootstrap (installs mise, runtimes, claude code)
bash scripts/run     # start webui

# Via mise (.mise.toml)
mise run setup       # → setup.sh
mise run bootstrap   # reconcile independent ~/.claude clone
mise run sync        # fast-forward tracked runtime source
mise run doctor      # classify source/runtime drift read-only
mise run run         # → scripts/run
mise tasks ls        # list all tasks

# Via conductor
# conductor.json wires setup/run/stop/archive automatically
```

## Lifecycle Scripts

| Script | Description |
|--------|-------------|
| `setup.sh` (root) | Bootstrap environment — mise, runtimes, Claude Code, clone `~/.claude` |
| `run` | Start webui dev server |
| `stop` | Stop webui server |
| `archive` | Teardown workspace — stops processes, syncs git changes |

## Utility Scripts

| Script | Description |
|--------|-------------|
| `claude-usage.py` | Check Claude usage limits (`uv run scripts/claude-usage.py --human`) |
| `dotclaude.py` | Bootstrap, sync, and diagnose the independent runtime clone |
| `pr-status.ts` | Fetch PR status, review comments, CI checks (`bun scripts/pr-status.ts`) |
