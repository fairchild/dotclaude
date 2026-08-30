---
name: cmux-orchestrator
description: "Orchestrate the cmux terminal — named layouts (workshop, ops-deck), sidebar dashboarding (status, progress, logs), browser automation, cross-workspace agent coordination, and theme customization. Use this skill whenever inside a cmux terminal (CMUX_WORKSPACE_ID is set), the user mentions cmux, asks to set up a workspace layout, open a browser pane, update sidebar status/progress, spawn agents across workspaces, change themes, or says 'workshop' or 'ops deck'. Also use when other skills need to update the sidebar or rename the workspace tab."
license: Apache-2.0
---

# cmux Orchestrator

cmux is a terminal multiplexer built for coding agents. This skill keeps the live rules in first-load context; longer layout recipes live in `references/`.

## Orient First

Always inspect the current cmux state before creating panes, browser surfaces, or agent workspaces:

```bash
cmux tree --all
cmux identify
```

Read the tree output carefully. It marks `[selected]`, `[focused]`, and the current position. Avoid duplicate panes and wrong-workspace actions by knowing the current landscape first.

## Core Model

```
Window -> Workspace -> Pane -> Surface
```

- **Workspace**: sidebar tab with cwd, status, progress, and logs.
- **Pane**: split region inside a workspace.
- **Surface**: terminal or browser tab inside a pane.
- **Addressing**: use refs like `workspace:3` / `surface:5`, or `$CMUX_WORKSPACE_ID` / `$CMUX_SURFACE_ID`.
- **Split order**: split down first for full-width bottom rows, then split the top pane right for a browser.
- **Naming**: rename every workspace and tab with semantic labels such as `tests`, `dev server`, or `API docs`.

## Sidebar Dashboard

Use the sidebar proactively. It is the user's at-a-glance status surface.

```bash
cmux set-status "phase" "running tests" --icon "bolt.fill" --color "#00BFFF"
cmux clear-status "phase"

cmux set-progress 0.5 --label "Running tests (3/6)"
cmux clear-progress

cmux log "Deployment started"
cmux log --level error --source "test-runner" "3 tests failed"

cmux rename-workspace "bread-builder tests"
cmux notify --title "Tests Complete" --body "All 42 tests passed"
```

Use notifications sparingly. Use status/progress/logs at every meaningful phase transition.

## Verify After Acting

After sending commands to another surface, read the screen to confirm the command actually ran:

```bash
cmux send --surface surface:5 "npm test -- --watch"
cmux send-key --surface surface:5 Enter
cmux read-screen --surface surface:5 --lines 15
```

If the command failed, read the error, correct the command or cwd, and verify again. The sidebar should reflect reality, not intent.

## Browser Pattern

cmux embeds a Playwright-powered browser. Discover elements before interacting:

```bash
cmux browser open-split https://hono.dev
cmux browser --surface surface:5 wait --load-state complete
cmux browser --surface surface:5 snapshot --interactive --compact
cmux browser --surface surface:5 click "a:has-text('Middleware')"
cmux browser --surface surface:5 snapshot --selector "main" --compact
```

For full syntax, run `cmux browser --help`.

## Prompt Via Inbox

When launching an agent into a pane, write the detailed prompt to the repo-shared agent inbox first, then start the agent with a short instruction to check its inbox. The inbox protocol and its helpers come from the `agent-inbox` skill; `<agent-inbox base dir>` below is that skill's base directory, wherever the host installed it.

```bash
. <agent-inbox base dir>/scripts/lib.sh
inbox_root="$(agent_inbox_root)"
mkdir -p "$inbox_root/coder"/{new,tmp,archive}
mkdir -p "$inbox_root/orchestrator"/{new,tmp,archive}
```

This creates a durable dispatch record, lets the child re-read instructions, and keeps cross-workspace communication consistent. See `references/workshop.md` and `references/ops-deck.md` for full examples.

## Conventions

### Workshop

A focused layout for one project: agent pane, browser preview, dev server row, test watcher row, and a repo-shared inbox. Use when the user says "set up a workshop for X".

Detailed flow: `references/workshop.md`.

### Worktree Workshop

Creates an isolated worktree from a branch name, then sets up the standard Workshop layout inside it.

Detailed flow: `references/worktree-workshop.md`.

### Respond to PR Review Workshop

Fetches unresolved PR review context, creates or reuses the PR worktree, opens a workshop around the PR, and launches an agent with review response context.

Detailed flow: `references/pr-review-workshop.md`.

### Ops Deck

A multi-agent monitoring layout for parallel work. The orchestrator writes inbox tasks, spawns agent workspaces, watches screen output, and collects structured replies.

Detailed flow: `references/ops-deck.md`.

### Status Sweep

Quick reconnaissance across workspaces using `cmux tree --all` and `cmux read-screen`.

Detailed flow: `references/status-sweep.md`.

### Wake-on-Reply

When a child writes a reply to the parent inbox, it can wake the parent session if needed.

Detailed flow: `references/wake-on-reply.md`.

## Themes

```bash
cmux themes list
cmux themes set "Tokyo Night"
cmux themes clear
```

Config: `~/Library/Application Support/com.cmuxterm.app/config.ghostty`

## Integration With Other Skills

When inside cmux, other skills should update the sidebar:

```bash
if [ -n "$CMUX_WORKSPACE_ID" ]; then
  cmux set-status "phase" "running" --icon "bolt.fill"
  cmux rename-workspace "descriptive title"
fi
```

- `session-titles`: use `cmux rename-workspace`.
- `agent-inbox`: use repo-shared `.agents/inbox/`.
- Multi-step tasks: use `cmux set-progress` and `cmux log`.

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
