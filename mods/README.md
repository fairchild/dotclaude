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
`DOTCLAUDE_MODS=none` leaves them out.

That marketplace is shared: the plugins under
[`.claude-plugin/plugins/`](../.claude-plugin/plugins/README.md) install into the same directory,
each flattened to its root, so a plugin ID in a cloud session matches one on a machine that added
this repository's marketplace from GitHub. The directory is named `mods` because it is a deployed
path, not because everything in it is a mod; `DOTCLAUDE_PLUGINS` narrows that kind separately.

The two narrowings are not quite independent, because a plugin declaring `dependencies` does not
load without them — the installer says so outright. `shipyard` depends on both mods, so
`DOTCLAUDE_MODS=none` takes `shipyard` with it rather than leaving it installed and unable to
start. The status line names the dependency that was missing. A new session's ToolSearch finds
`mcp__usage-meter__reading`, `mcp__compaction__context` and `mcp__compaction__request`, and
`~/.claude/cloud-bootstrap.status` names the mods it installed.

Neither mod's `plugin.json` pins a `version`, and neither marketplace entry does, so for an
install from this repository on GitHub the version is the commit SHA and `claude plugin update`
follows `main`. A pinned version would be compared instead of the commit, and a change that
kept it would reach the marketplace cache and stop there with installed sessions on the old
copy. Keep the field out unless these mods start wanting releases of their own.

A marketplace added from a local path is the other way to track a working copy: a plugin whose
entry is a relative path, as both of these are, loads in place from the folder, so an edit is
live at the next session start or `/reload-plugins` whatever any version says.

On a machine, install them from this repository's marketplace, as the main README's
[Install as a plugin marketplace](../README.md#install-as-a-plugin-marketplace) shows:

```
/plugin install usage-meter --marketplace fairchild/dotclaude
/plugin install compaction --marketplace fairchild/dotclaude
```

The mods load only from user settings: declared in a repository's `.claude/settings.json`, they do
not load.

## Compaction points

The mod gives the main thread the choice of when to compact. It sets a default target, the goal,
and leaves the thread free to run past it on judgement, up to the engine's own automatic
compaction. Compacting at a moment the thread picks, with instructions for the summary, keeps
more of what matters than a cut that lands mid-thought, and a thread that is in the middle of
live work can do better by carrying on than by compacting on schedule.

One number is worth setting, `goalTokens`: 300,000 unless the manifest's `userConfig` says
otherwise (`/config`, or `claude plugin configure compaction`). The two points the mod judges a
request against follow from it, and either takes an override:

| Point | Derivation | At a 300k goal | What it does |
| --- | --- | --- | --- |
| request floor | half the goal | 150,000 | below it a request is refused, since compacting that early frees too little for its cost |
| prepare point | the goal less `RUNWAY_TOKENS` (80,000) | 220,000 | where a thread that means to stop at the goal starts getting ready |
| goal | `goalTokens` | 300,000 | the default target; past it, compacting is a judgement call |
| automatic compaction | the engine's; reported, never set | `autoCompactWindow` less 33,000 | the top end, where the engine compacts without instructions |

The floor is a share because half a budget is half a budget whatever the budget is. The runway
is an absolute because what it pays for does not scale with the window: a closing turn, a resume
file, the request, `IDLE_MS = 3000` of idle wait, and the `/compact` round trip.

None of these points injects anything into the conversation. The thread sees them when it calls
`mcp__compaction__context`, or through whatever it already reads — a status line or a heartbeat
that prints the context against the goal. Past the goal, the thread compacts when what its context
holds is spent (finished work, settled reviews, tool output whose conclusions are written down)
and carries on while compacting would lose live threads.

Claude Code compacts at `min((W - 20000) * P / 100, W - 33000)`, with `W` from the
`autoCompactWindow` setting or `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `P` from
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. The mod cannot move that point — only the setting does. Set
`W` to how far a thread may run on judgement: at `W = 700000` the engine compacts at 667k, which
leaves a thread with a 300k goal about 370k of room to choose in. Setting `W` to the goal instead
(`W = 300000`, compacting at 267k) turns the goal into a hard ceiling and the choice away. When
the two differ by more than 10,000 the context report says so and names both settings; that note
describes the room, and a gap chosen on purpose needs no fix. With no window set, a 1M-token model
compacts near 967k.

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
