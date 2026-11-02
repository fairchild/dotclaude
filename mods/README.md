# mods

Two Claude Code mods, listed in this repository's `dotclaude` marketplace. A mod is a plugin whose
hooks module runs inside the engine with the session's permissions. The mod API is early access,
so rerun `claude plugin validate --json mods/<name>` when Claude Code updates.

- **`usage-meter`**: `mcp__usage-meter__reading` reads the account's five-hour and seven-day usage
  windows. It only observes.
- **`compaction`**: `mcp__compaction__context` reports the context against the thresholds below;
  `mcp__compaction__request` records a `/compact` with instructions for the summary, which the mod
  runs from a timer once the main thread's turn ends and the session goes idle.

Each mod only observes or answers its own tools, and makes no network, process or file-system call.
The compaction mod's one command call runs `compact`. The validator's notes list each mod's hooks
and `$` calls, and a change to either list is a change to what the mod can do.

## Install

In a cloud environment, paste [`scripts/cloud-environment.sh`](../scripts/cloud-environment.sh)
into the environment's Setup script. It installs the mods before the first session and sets the
auto-compaction policy described below; its header says how to change the ref, add plugins, or
append the environment's own steps. It logs to `~/.claude/dotclaude-setup.log`, and a new session's
ToolSearch finds all three tools.

On a machine, run the same script without the compaction settings:

```bash
AUTO_COMPACT_WINDOW= AUTO_COMPACT_PCT= bash scripts/cloud-environment.sh
```

The mods load only from user settings: declared in a repository's `.claude/settings.json`, they do
not load.

## Compaction points

`mcp__compaction__context` reports two points from `compaction.ts`, `floorTokens: 150_000` (a
request below it is refused, since compacting that early frees too little) and `prepareTokens:
220_000`, and a third from the engine: `autoCompactThreshold`, where automatic compaction will
run. That one follows whatever the settings give, so the mod has no value to keep in step with
them. `IDLE_MS = 3000` is the wait after a main turn before a request runs.

Claude Code compacts at `min((W - 20000) * P / 100, W - 33000)`, with `W` from
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `P` from `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. The setup script
sets `W = 300000` and `P = 100`, which gives 267k; with no window set, a 1M-token model compacts
near 967k.
