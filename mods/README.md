# mods

Two Claude Code mods, listed in this repository's `dotclaude` marketplace. A mod is a plugin whose
hooks module runs inside the engine with the session's permissions. The mod API is early access,
so rerun `claude plugin validate --json mods/<name>` when Claude Code updates.

- **`usage-meter`**: `mcp__usage-meter__reading` reads the account's five-hour and seven-day usage
  windows. It only observes.
- **`compaction`**: `mcp__compaction__context` reports the context against the points below;
  `mcp__compaction__request` records a `/compact` with instructions for the summary, which the mod
  runs from a timer once the main thread's turn ends and the session goes idle.

Each mod only observes or answers its own tools, and makes no network, process or file-system call.
The compaction mod's one command call runs `compact`. The validator's notes list each mod's hooks
and `$` calls, and a change to either list is a change to what the mod can do.

## Install

In a cloud environment, the setup script line from the main README's
[Cloud sessions](../README.md#cloud-sessions) installs both mods with the rest of the bundle, as a
directory marketplace named `dotclaude`. `DOTCLAUDE_MODS` on that line narrows them, and
`DOTCLAUDE_MODS=none` leaves them out. A new session's ToolSearch finds
`mcp__usage-meter__reading`, `mcp__compaction__context` and `mcp__compaction__request`, and
`~/.claude/cloud-bootstrap.status` names the mods it installed.

On a machine, install them from this repository's marketplace, as the main README's
[Install as a plugin marketplace](../README.md#install-as-a-plugin-marketplace) shows:

```
/plugin install usage-meter --marketplace fairchild/dotclaude
/plugin install compaction --marketplace fairchild/dotclaude
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
sets them when `DOTCLAUDE_COMPACT_WINDOW` and `DOTCLAUDE_COMPACT_PCT` are on its line: `300000` and
`100` give 267k. With no window set, a 1M-token model compacts near 967k. The prepare point comes
from the repository these mods were written for, whose Stop hook prepares there; here it is only
reported.
