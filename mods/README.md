# mods

Two Claude Code mods, listed in this repository's `dotclaude` marketplace. A mod is a plugin whose
hooks module runs inside the engine with the session's permissions. The mod API is early access,
so rerun `claude plugin validate --json mods/<name>` when Claude Code updates.

- **`usage-meter`**: `mcp__usage-meter__reading` reads the account's five-hour and seven-day usage
  windows. It only observes.
- **`compaction`**: `mcp__compaction__context` reports the context against the points below;
  `mcp__compaction__request` records a `/compact` with instructions for the summary and the
  reasoning for compacting now, which the mod runs from a timer once the main thread's turn ends
  and the session goes idle. Each request is kept in the mod's store, reasoning included.

Each mod only observes or answers its own tools, and makes no network or process call, and no
file-system call of its own: the compaction mod's reading goes through `$.store`, the JSON file
the engine keeps for a plugin under the configuration directory, and nothing else is written.
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

One number is worth setting, `goalTokens`: the context a session means to stay under, 300,000
unless the manifest's `userConfig` says otherwise (`/config`, or
`claude plugin configure compaction`). The two points the mod judges a request against follow
from it, and either takes an override:

| Point | Derivation | At a 300k goal |
| --- | --- | --- |
| request floor | half the goal | 150,000 |
| prepare point | the goal less `RUNWAY_TOKENS` (80,000) | 220,000 |
| automatic compaction | the engine's; reported, never set | 267,000 |

The floor is a share because half a budget is half a budget whatever the budget is. The runway
is an absolute because what it pays for does not scale with the window: a closing turn, a resume
file, the request, `IDLE_MS = 3000` of idle wait, and the `/compact` round trip. A request below
the floor is refused, since compacting that early frees too little for its cost.

Claude Code compacts at `min((W - 20000) * P / 100, W - 33000)`, with `W` from the
`autoCompactWindow` setting or `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `P` from
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. At `W = 300000` the `W - 33000` arm binds and the engine
compacts at 267k, which is why a 300k goal and that setting belong at the same number: the goal
decides when the thread compacts on purpose, with instructions, and the engine's point is the
backstop that compacts without them. The mod cannot move it — only the setting does — so when
the two disagree by more than 10,000 the report says so and names both ways to line them up.
With no window set, a 1M-token model compacts near 967k, which leaves a 300k goal advising a
compaction 700k before anything would have happened on its own.

## What a request leaves behind

`mcp__compaction__request` takes `reasoning` beside `instructions`: why compacting now beats
carrying on. Each request is appended to `$.store` under `requests` — the newest `LOG_LIMIT`
(200), the oldest dropped — with the outcome (`recorded`, `refused`, `ran`, `dropped`, `failed`),
the context and the points it was judged against, the instructions and the reasoning.

That reading is what makes the points answerable rather than asserted: a floor that refuses
requests the thread keeps making is too high, a prepare point the engine's backstop keeps
beating is too low. The store is a JSON file, `~/.claude/plugins/store/compaction_*.json`.

`log` lets a store that refuses go, since a reading is worth less than the compaction it
describes: a file still empty after the tool has been used means the writes are failing, and
`claude --debug` carries the reason.
