# mods: Claude Code mods for any session

A mod is a Claude Code plugin whose hooks module runs inside the engine, with the session's
permissions. This folder is a `directory` marketplace named `dotclaude-mods`
(`.claude-plugin/marketplace.json`) holding two mods. The mod API is early access: hook modules
load only while Claude Code's rollout flag for them is on, so rerun the checks below when Claude
Code updates.

## The mods

**`usage-meter`** gives the session one tool, `mcp__usage-meter__reading`, that reads the
account's five-hour and seven-day usage windows (percent used and reset time) from the session's
last API response. An agent reads the meter at a checkpoint with one tool call instead of asking a
person. It only observes.

**`compaction`** lets the main thread ask for `/compact` with instructions naming what the summary
must keep. `mcp__compaction__context` reports the context's tokens, window and percent against the
thresholds below, plus the pending and last request. `mcp__compaction__request` records one pending
request (a second replaces it), refused from a subagent, below the request floor, or before the
context is measured. Once the main thread's turn ends with an answer and the session stays idle for
`IDLE_MS`, a timer re-reads the context and runs `/compact` with the instructions; a turn that
starts first cancels the timer and the request waits for that turn's end. Automatic compaction stays
the backstop. State lives in memory and is lost on a reload.

## The rules each mod keeps

- It only observes, or answers its own tools. It never approves, denies or rewrites another tool
  call, a permission, a prompt or the settings, and adds nothing to model calls, so prompt caching
  holds.
- It makes no network, process or file-system call. `$` is a module's only way out of the engine,
  and each mod's `$` calls are the short list `claude plugin validate --json` reports.
- The compaction mod's only command call is the one that runs `compact`, in `runPending`.

To check a mod, run `claude plugin validate --json mods/<name>` and read the notes under
`contents`: `hooks`, `calls` and any `env reads`/`env writes`.

| Mod | Hooks | `$` calls |
|-----|-------|-----------|
| usage-meter | `session.start`, `tool.call{tool=mcp__usage-meter__reading}` | `$.session.usage`, `$.tool.register` |
| compaction | `session.start`, `tool.call{tool=mcp__compaction__context}`, `tool.call{tool=mcp__compaction__request}`, `turn.start`, `turn.complete` | `$.clock.after`, `$.command.run`, `$.session.usage`, `$.tool.register` |

Neither reads or writes the environment. A change to either column is a change to what the mod can
do and deserves a review of its own.

## Compaction thresholds

`compaction.ts` holds these constants:

```ts
export const POINTS = { floorTokens: 150_000, prepareTokens: 220_000, compactAtTokens: 267_000 };
export const IDLE_MS = 3000;
export const MAX_INSTRUCTIONS = 2000;
```

`floorTokens` is the least context a request is taken at, since a compaction earlier than that
frees too little for its cost. `prepareTokens` is reported as the point a session starts preparing
for compaction. `compactAtTokens` is where automatic compaction is expected to land. `IDLE_MS` is
the idle wait after a main turn, and `MAX_INSTRUCTIONS` the longest instructions accepted, in
characters.

The thresholds assume automatic compaction at 267k of a 280k effective window. Claude Code
compacts at `min(floor((W - 20000) * p / 100), W - 33000)`, where `W` is
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `p` is `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. Cloud sessions
inherit `p = 80`, which with a 300k window would compact at 224k, just past the prepare point. An
environment using these mods sets both, in the project's `.claude/settings.json` or the user's:

```json
{
  "env": {
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "300000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "100"
  }
}
```

That gives `min(280000, 267000) = 267000`. In a cloud session a subagent ignores `p` and compacts at
`W - 33000`, the same 267k. With other settings the mod still works, but its report of where the
context sits against the points is off by however far the real compaction point moved.

## Install in a cloud environment

1. Add `fairchild/dotclaude` under Repositories in the environment's settings. A setup script can
   read a private repository only when it is listed there; the clone lands at
   `/home/user/dotclaude`.
2. Add one line to the environment's setup script:

   ```bash
   bash /home/user/dotclaude/mods/install-cloud.sh
   ```

   The script finds the clone from its own path, fetches `main`, and copies `mods/` as
   `origin/main` holds it into `~/.claude/dotclaude-mods/`. It then merges into
   `~/.claude/settings.json`, keeping every other key:

   ```json
   {
     "extraKnownMarketplaces": {
       "dotclaude-mods": {
         "source": { "source": "directory", "path": "/root/.claude/dotclaude-mods/mods" }
       }
     },
     "enabledPlugins": {
       "usage-meter@dotclaude-mods": true,
       "compaction@dotclaude-mods": true
     }
   }
   ```

   Each run logs to `~/.claude/dotclaude-mods.log`. A failed copy leaves
   `~/.claude/dotclaude-mods/` empty and the settings unchanged, so no mod loads half-installed. It
   exits 0 either way so the rest of the setup script runs, and running it twice gives the same
   result. `DOTCLAUDE_MODS_REF=<ref>` copies from another ref, for trying a branch.
3. Check it in a new session: `~/.claude/dotclaude-mods.log` exists and ends with a `settings:`
   line, and ToolSearch finds `mcp__usage-meter__reading`, `mcp__compaction__context` and
   `mcp__compaction__request`.

## Install locally

```bash
claude plugin marketplace add <path-to-dotclaude>/mods
```

```bash
claude plugin install usage-meter@dotclaude-mods
```

```bash
claude plugin install compaction@dotclaude-mods
```
