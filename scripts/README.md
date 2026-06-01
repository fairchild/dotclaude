# Scripts

Lifecycle and utility scripts for dotclaude.

## Usage

```bash
# Direct
bash setup.sh        # full bootstrap (installs mise, runtimes, claude code)
bash scripts/run     # start webui

# Via mise (.mise.toml)
mise run setup       # → setup.sh
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
| `pr-status.ts` | Fetch PR status, review comments, CI checks (`bun scripts/pr-status.ts`) |
| `skill_competition.py` | Create skill-vs-baseline run packs from `evals/evals.json` (`uv run --script scripts/skill_competition.py --challenger <skill> --baseline none`) |
