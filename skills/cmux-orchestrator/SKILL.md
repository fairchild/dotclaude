---
name: cmux-orchestrator
description: "Orchestrate the cmux terminal — named layouts (workshop, ops-deck), sidebar dashboarding (status, progress, logs), browser automation, cross-workspace agent coordination, and theme customization. Use this skill whenever inside a cmux terminal (CMUX_WORKSPACE_ID is set), the user mentions cmux, asks to set up a workspace layout, open a browser pane, update sidebar status/progress, spawn agents across workspaces, change themes, or says 'workshop' or 'ops deck'. Also use when other skills need to update the sidebar or rename the workspace tab."
---

# cmux Orchestrator

cmux is a terminal multiplexer built for coding agents. This skill teaches you how to *think* about cmux — the patterns, conventions, and workflows that make it powerful. For command syntax, run `cmux --help` and `cmux browser --help`.

## Before You Act: Orient

Always start by understanding where you are. This prevents creating duplicate panes or targeting the wrong surface.

```bash
cmux tree --all    # full hierarchy — shows what exists
cmux identify      # your current workspace/pane/surface
```

Read the tree output carefully. It marks `[selected]`, `[focused]`, and `◀ here` for your position. Know the landscape before changing it.

## Core Mental Model

```
Window → Workspace → Pane → Surface
```

- **Workspace** = a sidebar tab. Has its own cwd, status, progress, and logs. This is what the user sees at a glance.
- **Pane** = a split region within a workspace. Split further with `new-split <direction>`.
- **Surface** = the content: terminal or browser. Panes can hold multiple surfaces as tabs.

**Addressing**: Use short refs (`workspace:3`, `surface:5`) or environment defaults (`$CMUX_WORKSPACE_ID`, `$CMUX_SURFACE_ID`).

**Split order matters**: To get a full-width bottom row, split down *first*, then split the top pane right. Reversing this puts the bottom pane under only one side.

**Name everything**: Every workspace and tab you create should get a short, semantic name via `cmux rename-workspace` and `cmux rename-tab`. The user scans these labels to orient — `"tests"`, `"dev server"`, `"API docs"` are useful; `"surface:14"` is not.

## The Sidebar is Your Dashboard

The sidebar is the most important cmux feature for agents. It's visible without switching workspaces — the user can glance at it to know what every agent is doing. Use it proactively.

### Status — what's happening

```bash
cmux set-status "phase" "running tests" --icon "checkmark.circle" --color "#00FF00"
cmux clear-status "phase"
```

Icons are SF Symbols: `bolt.fill` (active), `checkmark.circle` (done), `xmark.circle` (error), `hourglass` (waiting), `hammer.fill` (building), `cloud.fill` (deploy).

### Progress — how far along

```bash
cmux set-progress 0.5 --label "Running tests (3/6)"
cmux clear-progress
```

Use at every phase transition so the user never wonders "did it start?"

### Logs — what happened

```bash
cmux log "Deployment started"
cmux log --level error --source "test-runner" "3 tests failed"
```

Logs create a timeline in the sidebar. Use `--source` to identify which process logged.

### Workspace title — what this is

```bash
cmux rename-workspace "bread-builder tests"
```

Keep it descriptive and current. Other skills (session-titles) can update this too.

### Notifications — cross-workspace alerts

```bash
cmux notify --title "Tests Complete" --body "All 42 tests passed"
```

Use sparingly — only for events that need attention from another workspace.

## Verify After Acting

After sending commands to other surfaces, **always read the screen to confirm they worked**. Commands can fail silently — wrong directory, missing dependency, typo in the command. Don't assume success.

```bash
# Send a command
cmux send --surface surface:5 "npm test -- --watch"
cmux send-key --surface surface:5 Enter

# Wait a moment for output, then verify
cmux read-screen --surface surface:5 --lines 15

# If it failed (e.g., "command not found", "ENOENT", error output):
#   1. Read the error to understand what went wrong
#   2. Send a corrective command (cd to right dir, install deps, fix the command)
#   3. Read the screen again to confirm the fix worked
```

This applies to every `cmux send` — whether setting up a workshop, spawning agents, or running any command in another surface. The sidebar should reflect reality: if a command failed, update the status to show it.

## Browser: Discover, Don't Guess

cmux embeds a Playwright-powered browser. The key pattern: **use snapshots to discover elements before interacting**.

```bash
# Open a browser
cmux browser open-split https://hono.dev

# DON'T guess selectors. DO discover them:
cmux browser --surface surface:5 snapshot --interactive --compact

# Now click what you found:
cmux browser --surface surface:5 click "a:has-text('Middleware')"

# Read the result, scoped to avoid nav chrome:
cmux browser --surface surface:5 snapshot --selector "main" --compact
```

Always `wait --load-state complete` before snapshotting. For full browser command reference: `cmux browser --help`.

## Convention: "Workshop"

A focused development layout for a single project. Say **"set up a workshop for [project]"** and get:

```
+---------------------+---------------------+
|                     |                      |
|  Terminal (code)    |  Browser (preview)   |
|                     |                      |
+---------------------+---------------------+
|          Test/Dev Watcher (full width)     |
+--------------------------------------------+

Sidebar:
  Title: "[project] workshop"
  Status: dev-server: running, tests: watching
  Progress: (cleared — used during setup only)
```

### How to build it

1. Orient: `cmux tree --all`, `cmux identify`
2. Create a workspace for the project:
   ```bash
   cmux new-workspace --cwd ~/code/<project>
   ```
   Note the returned ref (e.g., `workspace:9`). **Pass `--workspace <ref>` to all subsequent commands** — your `$CMUX_WORKSPACE_ID` still points to the calling workspace.
3. **Detect the project's commands** using this priority:

   | Check | Setup command | Dev server command | Test watch command |
   |-------|--------------|-------------------|-------------------|
   | `scripts/setup` + `scripts/run` exist | `scripts/setup && scripts/run` | (combined above) | `scripts/test` or fall back below |
   | `bun.lock` exists | `bun install && bun run dev` | (combined above) | `bun run test -- --watch` or `bunx vitest --watch` |
   | `pnpm-lock.yaml` exists | `pnpm install && pnpm dev` | (combined above) | `pnpm test -- --watch` |
   | `package-lock.json` exists | `npm install && npm run dev` | (combined above) | `npm test -- --watch` |
   | `uv.lock` exists | `uv sync && uv run dev` | (combined above) | `uv run pytest --watch` |
   | `Cargo.lock` exists | `cargo build && cargo run` | (combined above) | `cargo watch -x test` |

   Also read `package.json` scripts (or equivalent) to confirm — the table above is a starting point, not gospel. Some projects use `wrangler dev`, `vite dev`, etc.

4. Split down first (full-width bottom): `cmux new-split down --workspace <ws>`
5. `cmux list-panes --workspace <ws>` — note the top pane and bottom pane refs
6. Run setup + dev server in the top pane:
   ```bash
   cmux send --workspace <ws> --surface <top> "<setup-and-run-cmd>"
   cmux send-key --workspace <ws> --surface <top> Enter
   ```
7. **Verify and discover the URL**: Wait a few seconds, then read the screen to confirm the server started and find its URL:
   ```bash
   cmux read-screen --workspace <ws> --surface <top> --lines 15
   ```
   Look for output like `Ready on http://localhost:8787`, `listening on port 3000`, etc. If setup failed (missing deps, permission error), fix it before continuing.
8. Open browser at the discovered URL:
   ```bash
   cmux new-pane --type browser --direction right --workspace <ws> --url <discovered-url>
   ```
9. Start test watcher in bottom pane:
   ```bash
   cmux send --workspace <ws> --surface <bottom> "<test-watch-cmd>"
   cmux send-key --workspace <ws> --surface <bottom> Enter
   ```
10. **Verify tests started**: `cmux read-screen --workspace <ws> --surface <bottom> --lines 15`
11. Resize bottom smaller: `cmux resize-pane --pane <bottom> --workspace <ws> -U --amount 10`
12. Name everything:
    ```bash
    cmux rename-workspace --workspace <ws> "[project] workshop"
    cmux rename-tab --workspace <ws> --surface <top> "dev server"
    cmux rename-tab --workspace <ws> --surface <bottom> "tests"
    ```
13. Set up the sidebar dashboard — only mark things as "running" if you verified they actually started:
    ```bash
    cmux set-status "dev-server" "<discovered-url>" --icon "bolt.fill" --color "#00FF00" --workspace <ws>
    cmux set-status "tests" "watching" --icon "magnifyingglass" --color "#FFB800" --workspace <ws>
    cmux log --workspace <ws> "Workshop ready"
    ```
14. Focus the dev server pane: `cmux focus-pane --pane <top> --workspace <ws>`

### Launching agents into workshop panes

You can send a `claude -p` command into any workshop pane to have an agent investigate or fix issues autonomously. But **`-p` mode is non-interactive** — the agent cannot prompt for permission approvals. Before launching:

1. Check the project's `.claude/settings.local.json` has permissions for the commands the agent will need (e.g., `Bash(bun install:*)`, `Bash(bun run:*)`)
2. If permissions are missing, add them first — the agent will silently fail otherwise
3. Update the sidebar to reflect the agent is working:
   ```bash
   cmux set-status "dev-server" "agent fixing build" --icon "hammer.fill" --color "#FFB800"
   ```

**After the agent finishes**: `claude -p` exits when done, which kills any long-running process (like a dev server) it started for verification. Restart the process yourself using whichever command originally started it (`scripts/run`, `bun run dev`, etc.).

### Adapting the workshop

- **No browser preview?** Skip the right split, use the full top pane as terminal
- **Multiple browsers?** Add tabs to the browser pane: `cmux new-surface --type browser --pane <right> --url <url>`
- **Docs instead of preview?** Point the browser URL at docs instead of localhost
- **Different test runner?** Swap the send command: `vitest --watch`, `bun test --watch`, `cargo watch -x test`

## Convention: "Ops Deck"

A multi-agent monitoring layout for parallel work. Say **"set up an ops deck for [task] on [project]"** and get:

```
Orchestrator workspace (you are here):
  Sidebar: title, progress bar, agent status per spawned workspace

Agent workspace 1 ("tests"):
  Sidebar: status, progress, logs
  Inbox: .agents/inbox/test-runner/

Agent workspace 2 ("lint"):
  Sidebar: status, progress, logs
  Inbox: .agents/inbox/linter/

All connected via agent-inbox protocol.
```

### How to build it

1. Orient: `cmux tree --all`, `cmux identify`
2. Set up agent-inbox directories in the project root:
   ```bash
   mkdir -p .agents/inbox/orchestrator/{new,tmp,archive}
   mkdir -p .agents/inbox/test-runner/{new,tmp,archive}
   mkdir -p .agents/inbox/linter/{new,tmp,archive}
   ```
3. Set initial sidebar state:
   ```bash
   cmux rename-workspace "[project] ops deck"
   cmux set-progress 0.0 --label "Spawning agents..."
   cmux set-status "test-runner" "spawning" --icon "hourglass" --color "#FFB800"
   cmux set-status "linter" "spawning" --icon "hourglass" --color "#FFB800"
   ```
4. Spawn agent workspaces with inbox instructions baked into the prompt:
   ```bash
   cmux new-workspace --cwd ~/code/myproject \
     --command "claude -p 'Run npm test. When done, send results to .agents/inbox/orchestrator/ using agent-inbox protocol (write to tmp/, mv to new/). Your name is test-runner. Include pass/fail counts.'"

   cmux new-workspace --cwd ~/code/myproject \
     --command "claude -p 'Run the linter. When done, send results to .agents/inbox/orchestrator/ using agent-inbox protocol. Your name is linter.'"
   ```
5. Name everything so the user can identify each workspace and tab at a glance:
   ```bash
   cmux rename-workspace --workspace <ref1> "tests"
   cmux rename-workspace --workspace <ref2> "lint"
   cmux rename-tab --surface <surface1> "test-runner"
   cmux rename-tab --surface <surface2> "linter"
   ```
6. **Verify each workspace started correctly**: `cmux read-screen --surface <agent-surface> --lines 15` — confirm the agent is running, not stuck on an error. If a workspace failed to start (wrong cwd, missing deps, command error), fix it before proceeding.
7. Update progress as agents come online:
   ```bash
   cmux set-progress 0.33 --label "Agents running..."
   cmux set-status "test-runner" "running" --icon "bolt.fill" --color "#00BFFF"
   cmux set-status "linter" "running" --icon "bolt.fill" --color "#00BFFF"
   ```
8. Monitor with dual channels:
   - **Quick check**: `cmux read-screen --surface <agent-surface> --lines 20`
   - **Structured results**: `ls .agents/inbox/orchestrator/new/`
9. When inbox messages arrive, read and archive:
   ```bash
   cat .agents/inbox/orchestrator/new/<message>.md
   mv .agents/inbox/orchestrator/new/<message>.md .agents/inbox/orchestrator/archive/
   ```
10. Update sidebar with final results:
   ```bash
   cmux set-progress 1.0 --label "All agents complete"
   cmux set-status "test-runner" "42 passed" --icon "checkmark.circle" --color "#00FF00"
   cmux set-status "linter" "clean" --icon "checkmark.circle" --color "#00FF00"
   cmux notify --title "Ops Deck Complete" --body "Tests: 42 passed, Lint: clean"
   ```

### Dual-channel monitoring

The ops deck uses two communication channels:

- **`cmux read-screen`** — real-time "what's on screen right now." Fast, ephemeral, good for progress updates.
- **agent-inbox** — structured "here's what I finished." Durable, parseable, good for results and handoffs.

Use screen reading for quick checks while agents run. Use inbox messages for final results and coordination.

### Scaling the ops deck

- **More agents?** Add more inbox directories and workspace spawns. The sidebar tracks them all.
- **Bidirectional?** Each inbox message has `reply_to` — agents can talk back and forth.
- **Auto-notification?** Configure the agent-inbox stop hook so agents see `"📬 N unread"` automatically.

## Themes & Appearance

```bash
cmux themes list          # hundreds of themes (Ghostty-based)
cmux themes set "Tokyo Night"
cmux themes clear         # reset to default
```

Config: `~/Library/Application Support/com.cmuxterm.app/config.ghostty`

## Integration with Other Skills

When inside cmux (`$CMUX_WORKSPACE_ID` is set), other skills should use the sidebar:

```bash
# Conditional cmux usage pattern
if [ -n "$CMUX_WORKSPACE_ID" ]; then
  cmux set-status "phase" "running" --icon "bolt.fill"
  cmux rename-workspace "descriptive title"
fi
```

- **session-titles** → `cmux rename-workspace` to sync sidebar title
- **agent-inbox** → `.agents/inbox/` for structured cross-workspace messaging
- **Any multi-step task** → `cmux set-progress` + `cmux log` for sidebar trail

## Quick Reference

| Need | Command |
|------|---------|
| Full help | `cmux --help` |
| Browser help | `cmux browser --help` |
| What exists | `cmux tree --all` |
| Where am I | `cmux identify` |
| Keyboard shortcuts | `cmux shortcuts` |
| Open a directory | `cmux /path/to/dir` |
| View markdown | `cmux markdown open file.md` |
