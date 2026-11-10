# mods

Two Claude Code mods, listed in this repository's `dotclaude` marketplace. A mod is a plugin whose
hooks module runs inside the engine with the session's permissions. The mod API is early access,
so rerun `claude plugin validate --json mods/<name>` when Claude Code updates.

- **`usage-meter`**: `mcp__usage-meter__reading` reads the account's five-hour and seven-day usage
  windows. It only observes.
- **`compaction`**: `mcp__compaction__context` reports the context against the points below;
  `mcp__compaction__request` records a `/compact` with instructions for the summary and the
  reasoning for compacting now, which the mod runs from a timer once the main thread's turn ends
  and the session goes idle. Once `/compact` has run, the mod submits the request's `resume`
  prompt, or a generic one, so the first turn after the compaction starts on its own instead of
  waiting for the next event to arrive. A main-thread `/compact` typed during the wait, or the
  engine's automatic compaction, drops a pending request instead of compacting twice; a
  subagent's compaction does not. Each request is kept in the mod's store, reasoning included.
  At or past the prepare point, and after any compaction but its own resumed one, it attaches a
  short note to the next prompt (below, [Asking for a compaction](#asking-for-a-compaction)).

`usage-meter` only observes. `compaction` answers its own tools and acts on its own tool's
request: its one command call runs `compact`, and its one prompt call submits the resume prompt
after it, which starts a model turn as a typed prompt would. Its `prompt.submit` hook adds
context beside a prompt and never changes the prompt's text. Neither mod makes a network or
process call of its own, nor a file-system call: the compaction mod's reading goes through
`$.store`, the JSON file the engine keeps for a plugin under the configuration directory, and
nothing else is written. The validator's notes list each mod's hooks
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

## Taking an update

An install from GitHub tracks commits (no pinned `version`, above), so a merge to `main` reaches an
installed copy only once the marketplace is refreshed, the plugin updated and the session
restarted:

```
claude plugin marketplace update dotclaude && claude plugin update compaction@dotclaude
```

Then restart Claude Code; `usage-meter@dotclaude` updates the same way.

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
| prepare point | the goal less `RUNWAY_TOKENS` (80,000), never below the floor | 220,000 | where a thread that means to stop at the goal starts getting ready |
| goal | `goalTokens` | 300,000 | the default target; past it, compacting is a judgement call |
| automatic compaction | the engine's; reported, never set | `autoCompactWindow` less 33,000, when that arm binds | the top end, where the engine compacts without instructions |

The prepare point is `max(floor, goal − 80,000)`, so below a 160k goal, or under a floor override
above the goal less 80k, it sits at the floor. The floor is a share because half a budget is half
a budget whatever the budget is. The runway is an absolute because what it pays for does not
scale with the window: a closing turn, a resume file, the request, `IDLE_MS = 3000` of idle wait,
and the `/compact` round trip.

The prepare point is the one that speaks: the first prompt at or past it carries a note (below). The
others the thread sees when it calls `mcp__compaction__context`, or through whatever it already
reads — a status line or a heartbeat that prints the context against the goal. Past the goal, the thread compacts when what its context
holds is spent (finished work, settled reviews, tool output whose conclusions are written down)
and carries on while compacting would lose live threads.

Claude Code compacts at `min((W - 20000) * P / 100, W - 33000)`, with `W` from the
`autoCompactWindow` setting or `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `P` from
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. The mod cannot move that point — only the settings do. That
point, not `W` itself, is the top end a thread may run into on judgement. The figures below
assume the `W - 33000` arm binds, which holds while `P` is at least `100 * (W - 33000) / (W -
20000)`: 98.1 at `W = 700000`, 95.4 at `W = 300000`, 98.7 at `W = 1000000`. Below that the
percentage arm binds and the engine compacts earlier. At `W = 700000` and `P = 100` the engine
compacts at 667k, which leaves a thread with a 300k goal about 367k of room to choose in.
Setting `W` to the goal instead (`W = 300000`, compacting at 267k) turns the goal into a hard
ceiling and the choice away. With no window set, a 1M-token model compacts near 967k, if its
default `P` lets that arm bind.

The context report reads the engine's point in three bands against the goal:

| Engine's point, at a 300k goal | Band | What the report says |
| --- | --- | --- |
| above 300,000 | room | "the engine compacts at 667,000; past the 300,000 goal, compacting is the thread's call up to there" |
| 257,000 to 300,000 | the goal's own backstop, from its implied point (the goal less 33,000) less 10,000 up to the goal | nothing |
| below 257,000 | a fault | the goal is never reached; it names `autoCompactWindow`, then `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` for when the window already reaches the goal, and the goal that would fit |

## Asking for a compaction

The mod hands the thread the procedure when it is due, as context beside a prompt that the model
reads and the person never sees, so a session that loaded no skill still gets it:

- **The prepare note.** The first prompt at or past the prepare point, with no request pending,
  carries it once until the next compaction: write what must survive to disk first (to a pushed
  branch or the tracker only where the repo or the user has granted that), then call
  `mcp__compaction__request` with `instructions` (what the summary keeps, named exactly),
  `reasoning`, and `resume` (what to pick up first and where its state lives); carry on instead
  while compacting would lose live work.
- **The after note.** The first prompt after a main-loop compaction that went through — a typed
  `/compact`, the engine's own, another plugin's — carries it once: the summary carries what the
  session believed, so rebuild from live reads before acting on it. The mod's own cut owes none
  once its resume prompt has gone in: that prompt is the thread's own word, and the generic one
  says the same. When the resume prompt does not go in, the next prompt carries the note.

A slash command's prompt carries neither. A prompt that a hook beneath the mod drops, or throws
on, after the mod attached a note leaves it owed to the next one; a hook above the mod that drops
the prompt after the mod's hook returns is not seen, and that note counts as given. The notes are kept with the rest of the mod's state, which a
reload loses: after `/reload-plugins` or an update, a prepare note may come again and an owed
after note is forgotten. A note rides on a prompt, so a session working through a
long turn of tool calls with no prompt arriving meets the prepare note at the next one, and a
typed `/compact` still waits for whatever event comes next before anything runs; a background
timer started before the cut bounds that wait. The
[`compaction-handoff`](../skills/compaction-handoff/SKILL.md) skill is the long form: reflecting
back before the cut, and the manual cut when the mod is not installed.

## What a request leaves behind

`mcp__compaction__request` takes `reasoning` beside `instructions`: why compacting now beats
carrying on. Each request is appended to `$.store` under `requests` — the newest `LOG_LIMIT`
(200), the oldest dropped — with the outcome (`recorded`, `refused`, `ran`, `dropped`, `failed`; `dropped` also when another compaction runs first),
the context and the points it was judged against, the instructions, the reasoning and the resume
prompt when one was given. A request that ran adds a second entry for the resume prompt: `resumed`
when it was submitted, `unresumed`, with the reason, when the submit failed or a hook dropped it.
`ran` means the compaction went through: a `/compact` that answers "Not enough messages to
compact." is `failed`, and nothing is submitted after it.

That reading is what makes the points answerable rather than asserted: a floor that refuses
requests the thread keeps making is too high, a prepare point the engine's backstop keeps
beating is too high. The store is a JSON file, `~/.claude/plugins/store/compaction_*.json`.

`log` lets a store that refuses go, since a reading is worth less than the compaction it
describes: a file still empty after the tool has been used means the writes are failing, and
`claude --debug` carries the reason.
