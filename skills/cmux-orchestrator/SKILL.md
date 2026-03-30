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

## Pattern: Prompt via Inbox

When launching an agent into a pane, **write the prompt to the agent's inbox first**, then start the agent with a simple command to check its inbox. This gives you:

- A persisted, readable record of what was asked
- The agent can re-read its instructions at any time
- The orchestrator has a log of what it dispatched
- Consistent with inbox-first communication across all conventions

```bash
# 1. Create the inbox
mkdir -p .agents/inbox/coder/{new,tmp,archive}

# 2. Write the prompt as an inbox message
TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)
cat > .agents/inbox/coder/tmp/${TIMESTAMP}-task.md << 'EOF'
---
from: orchestrator
to: coder
reply_to: ../orchestrator/tmp/
timestamp: 2026-03-21T18:00:00Z
thread: workshop
---

Fix the failing auth tests. The JWT validation is rejecting valid tokens.
Check the test output in the "tests" pane via `cmux read-screen`.
Report back when done.
EOF
mv .agents/inbox/coder/tmp/${TIMESTAMP}-task.md .agents/inbox/coder/new/

# 3. Launch the agent — the inbox message has all the detail
cmux send --surface <agent-surface> "echo 'Check your inbox at .agents/inbox/coder/new/ and execute the task. Reply to .agents/inbox/orchestrator/ when done.' | claude -p -n coder --add-dir .agents/inbox --dangerously-skip-permissions"
cmux send-key --surface <agent-surface> Enter
```

This pattern applies everywhere — workshop agents, ops deck agents, any spawned agent.

## Convention: "Workshop"

A focused development layout for a single project. Say **"set up a workshop for [project]"** and get:

```
+---------------------+---------------------+
|                     |                      |
|  Agent / Coding     |  Browser (preview)   |
|  (top-left, tall)   |  (top-right, tall)   |
|                     |                      |
+---------------------+---------------------+
|  Dev Server (compact, full width)          |
+--------------------------------------------+
|  Test Watcher (compact, full width)        |
+--------------------------------------------+

Sidebar:
  Title: "[project] workshop"
  Status: agent: ready, dev-server: running, tests: watching
  Progress: (cleared — used during setup only)

Inbox: .agents/inbox/coder/ (always created)
```

The top-left pane is the agent's workspace — typically launched from the orchestrator via prompt-via-inbox, but the human can switch to it and take over at any time. The agent can use `cmux browser` to validate its work in the browser pane, `cmux read-screen` to check test output, and agent-inbox to report back to the orchestrator.

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

4. **Build the layout** — split down twice first for the two compact rows, then split the top pane right for the browser:
   ```bash
   # First split: creates dev-server row (bottom)
   cmux new-split down --workspace <ws>
   # Second split: creates test-watcher row (bottom-bottom)
   cmux new-split down --workspace <ws>
   cmux list-panes --workspace <ws>
   # Note: top pane (agent), middle pane (dev-server), bottom pane (tests)
   ```
5. Resize the bottom rows compact — they're output-only, don't need much height:
   ```bash
   cmux resize-pane --pane <middle> --workspace <ws> -U --amount 15
   cmux resize-pane --pane <bottom> --workspace <ws> -U --amount 10
   ```
6. Run dev server in the middle pane:
   ```bash
   cmux send --workspace <ws> --surface <middle> "<setup-and-run-cmd>"
   cmux send-key --workspace <ws> --surface <middle> Enter
   ```
7. **Verify and discover the URL**: Wait a few seconds, then read the screen:
   ```bash
   cmux read-screen --workspace <ws> --surface <middle> --lines 15
   ```
   Look for output like `Ready on http://localhost:8787`, `listening on port 3000`, etc.
8. Open browser at the discovered URL — split right from the top (agent) pane:
   ```bash
   cmux new-pane --type browser --direction right --workspace <ws> --url <discovered-url>
   ```
9. Start test watcher in the bottom pane:
   ```bash
   cmux send --workspace <ws> --surface <bottom> "<test-watch-cmd>"
   cmux send-key --workspace <ws> --surface <bottom> Enter
   ```
10. **Verify tests started**: `cmux read-screen --workspace <ws> --surface <bottom> --lines 15`
11. **Set up the agent inbox** — always, even if no agent is launched yet:
    ```bash
    mkdir -p ~/code/<project>/.agents/inbox/coder/{new,tmp,archive}
    mkdir -p ~/code/<project>/.agents/inbox/orchestrator/{new,tmp,archive}
    ```
12. Name everything:
    ```bash
    cmux rename-workspace --workspace <ws> "[project] workshop"
    cmux rename-tab --workspace <ws> --surface <top> "agent"
    cmux rename-tab --workspace <ws> --surface <middle> "dev server"
    cmux rename-tab --workspace <ws> --surface <bottom> "tests"
    ```
13. Set up the sidebar dashboard — only mark things as "running" if you verified they actually started:
    ```bash
    cmux set-status "agent" "ready" --icon "person.fill" --color "#888888" --workspace <ws>
    cmux set-status "dev-server" "<discovered-url>" --icon "bolt.fill" --color "#00FF00" --workspace <ws>
    cmux set-status "tests" "watching" --icon "magnifyingglass" --color "#FFB800" --workspace <ws>
    cmux log --workspace <ws> "Workshop ready — agent pane idle, inbox at .agents/inbox/coder/"
    ```

### Launching an agent into the workshop

Use the prompt-via-inbox pattern to dispatch work to the agent pane:

1. Write the task to the coder's inbox (see "Prompt via Inbox" above)
2. Launch the agent — the inbox message has all the detail:
   ```bash
   cmux send --workspace <ws> --surface <top> "echo 'Check your inbox at .agents/inbox/coder/new/ and execute the task. Reply to .agents/inbox/orchestrator/ when done.' | claude -p -n coder --add-dir .agents/inbox --dangerously-skip-permissions"
   cmux send-key --workspace <ws> --surface <top> Enter
   ```
3. Update sidebar:
   ```bash
   cmux set-status "agent" "working" --icon "hammer.fill" --color "#FFB800" --workspace <ws>
   ```

The agent has full access to the workshop — it can read the test watcher output via `cmux read-screen`, interact with the browser via `cmux browser snapshot/click/fill`, and report back via agent-inbox. The human can switch to the agent pane at any time to observe or take over.

**`-p` mode is non-interactive** — the agent cannot prompt for permission approvals.

- `--add-dir .agents/inbox` grants filesystem visibility but NOT tool permissions
- `--allowedTools` must include every tool the agent will use: `Bash(cmux:*)` for cmux, `Write` for creating inbox replies, `Read` and `Glob` and `Grep` for exploring code
- For agents that need broad access (most workshop/ops-deck agents), use `--dangerously-skip-permissions` instead of enumerating tools — it's simpler and avoids silent permission blocks
- If you use `--allowedTools`, test that the agent can complete the *full* task including writing its reply to the inbox

**After the agent finishes**: `claude -p` exits when done. Check the orchestrator inbox for results, then update sidebar status.

### Adapting the workshop

- **No browser preview?** Skip the right split, give the agent the full top row
- **Multiple browsers?** Add tabs to the browser pane: `cmux new-surface --type browser --pane <right> --url <url>`
- **Docs instead of preview?** Point the browser URL at docs instead of localhost
- **Human-only mode?** Use the agent pane as a regular terminal — the inbox is still there if you want to dispatch later

## Convention: "Worktree Workshop"

A Workshop that starts from a branch name instead of an existing directory. Creates an isolated worktree, then sets up the full Workshop layout inside it. Say **"set up a worktree workshop for `<branch>` on `<project>`"** and get:

```
~/.worktrees/<repo>/<branch>/
  ├── Full Workshop layout (agent, dev server, tests, browser)
  ├── Sidebar: "<repo>: <branch>"
  └── .agents/inbox/ (ready for dispatch)
```

The flow: create worktree via `git worktree add` → `cmux new-workspace --cwd <worktree>` → standard Workshop layout. Supports both in-repo (default) and cross-repo (`--repo`) entry points. Self-contained — uses `git worktree` directly, no external scripts required.

**Detailed flow:** See [`references/worktree-workshop.md`](references/worktree-workshop.md) for the full phased build instructions, edge case handling, and cleanup.

## Convention: "PR Review Workshop"

A Worktree Workshop variant for responding to PR code review. Say **"set up a pr-review workshop for PR #\<number\>"** and get:

```
~/.worktrees/<repo>/<branch>/
  ├── Workshop layout (agent + browser on PR Files Changed + verification pane)
  ├── Sidebar: "PR #<number>: <title>" with comment progress tracking
  ├── Review comments pre-loaded as agent context
  ├── Permissions pre-configured for autonomous verification
  └── Re-review flow: commit → push → comment → request re-review
```

The flow: fetch PR context (`gh pr view` + `gh api`) → create/reuse worktree (idempotent) → Workshop layout with browser on PR → launch agent with review context → agent addresses feedback → agent requests re-review.

**Key differences from Worktree Workshop:**
- **Idempotent worktree**: reuses existing worktree on same branch instead of erroring
- **Permission profile**: pre-approved tools for verification scripts (`swift test`, `uv run`, `python`)
- **Re-review closing**: agent posts summary comment and requests re-review via helper script
- **Context helper**: `uv run ~/.claude/skills/cmux-orchestrator/scripts/pr-fetch-context.py <number>` generates agent prompt

**Detailed flow:** See [`references/pr-review-workshop.md`](references/pr-review-workshop.md) for the full phased build instructions, permission profile, and re-review protocol.

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
4. **Write task prompts to each agent's inbox** (prompt-via-inbox pattern):
   ```bash
   TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)

   cat > .agents/inbox/test-runner/tmp/${TIMESTAMP}-task.md << 'EOF'
   ---
   from: orchestrator
   to: test-runner
   reply_to: ../orchestrator/tmp/
   timestamp: 2026-03-21T18:00:00Z
   thread: ops-deck
   ---
   Run the test suite. Include pass/fail counts and any failure details in your reply.
   EOF
   mv .agents/inbox/test-runner/tmp/${TIMESTAMP}-task.md .agents/inbox/test-runner/new/

   cat > .agents/inbox/linter/tmp/${TIMESTAMP}-task.md << 'EOF'
   ---
   from: orchestrator
   to: linter
   reply_to: ../orchestrator/tmp/
   timestamp: 2026-03-21T18:00:00Z
   thread: ops-deck
   ---
   Run the linter. Report any warnings or errors in your reply.
   EOF
   mv .agents/inbox/linter/tmp/${TIMESTAMP}-task.md .agents/inbox/linter/new/
   ```
5. **Spawn agent workspaces** — each checks its inbox on start:
   ```bash
   cmux new-workspace --cwd ~/code/myproject \
     --command "echo 'Check your inbox at .agents/inbox/test-runner/new/ and execute the task. Reply to .agents/inbox/orchestrator/ when done.' | claude -p -n test-runner --add-dir .agents/inbox --dangerously-skip-permissions"

   cmux new-workspace --cwd ~/code/myproject \
     --command "echo 'Check your inbox at .agents/inbox/linter/new/ and execute the task. Reply to .agents/inbox/orchestrator/ when done.' | claude -p -n linter --add-dir .agents/inbox --dangerously-skip-permissions"
   ```
6. Name everything so the user can identify each workspace and tab at a glance:
   ```bash
   cmux rename-workspace --workspace <ref1> "tests"
   cmux rename-workspace --workspace <ref2> "lint"
   cmux rename-tab --surface <surface1> "test-runner"
   cmux rename-tab --surface <surface2> "linter"
   ```
7. **Verify each workspace started correctly**: `cmux read-screen --surface <agent-surface> --lines 15` — confirm the agent is running, not stuck on an error. If a workspace failed to start (wrong cwd, missing deps, command error), fix it before proceeding.
8. Update progress as agents come online:
   ```bash
   cmux set-progress 0.33 --label "Agents running..."
   cmux set-status "test-runner" "running" --icon "bolt.fill" --color "#00BFFF"
   cmux set-status "linter" "running" --icon "bolt.fill" --color "#00BFFF"
   ```
9. Monitor with dual channels:
   - **Quick check**: `cmux read-screen --surface <agent-surface> --lines 20`
   - **Structured results**: `ls .agents/inbox/orchestrator/new/`
10. When inbox messages arrive, read and archive:
   ```bash
   cat .agents/inbox/orchestrator/new/<message>.md
   mv .agents/inbox/orchestrator/new/<message>.md .agents/inbox/orchestrator/archive/
   ```
11. Update sidebar with final results:
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

## Convention: "Status Sweep"

A quick reconnaissance pass across all workspaces to summarize what's in flight. Say **"what do I have in flight"** or **"status sweep"**. Uses `cmux tree --all` + `cmux read-screen` per workspace to build a scannable briefing.

**Detailed flow:** See [`references/status-sweep.md`](references/status-sweep.md) for the steps and reporting format.

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
