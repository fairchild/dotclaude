---
name: fable-session
description: Hand off long-arc work to a fable session — Fable orchestrates and verifies while delegating the implementation. Triggers on "fable session", "fable team session", "fable workflow session".
license: Apache-2.0
---

# Fable Session

A Fable session owning a piece of work end to end, in a worktree of its own.

## Roles

Fable holds the arc and checks coherence across pieces. It delegates the
implementation rather than doing it, keeping its own context under ~200k.

Delegation mechanism, by phrasing:

- **fable session** — Fable's call
- **fable team session** — `Agent`
- **fable workflow session** — `Workflow`

Model per delegated task:

- **Opus** — default
- **Sonnet** — simple and fully specified
- **Fable** — needs nuance

## Done

A commit plus a demonstrated run — an e2e recording where there's a UI.

## Brief

`docs/plans/<name>.handoff.md`, committed before launch: the plan, plus a short
who-does-what naming the split above. The session is pointed at the file, never
handed its contents.

## Host

Where the session runs is a separate choice from how it delegates. Default to the
surface the work already lives in.

| Host | Fits when | Mechanics |
|------|-----------|-----------|
| Orca terminal | `orca worktree current --json` resolves | `orca-cli` skill, "Fable session handoff" |
| cmux workspace | `$CMUX_WORKSPACE_ID` is set | `cmux-orchestrator` skill — `cmux new-workspace --cwd <worktree> --command <launch>` |
| Plain terminal | neither, and the work wants a session that outlives this one | `git-worktree` skill for the worktree, then a terminal tab in it |
| `Agent` subagent | the arc fits inside this session | `Agent` with `model: "fable"`, `isolation: "worktree"` |

The first three launch a CLI and share the same three failure modes:

```bash
claude --model claude-fable-5
```

Pass the model flag explicitly — bare `claude` has come up Opus. Wait for the TUI
to settle before sending. Send a one-line prompt pointing at the brief; multi-line
pastes sit unsubmitted in the composer. Read the screen once to confirm the status
line says Fable 5 and the prompt was submitted rather than left sitting in `❯`,
then stop monitoring.

A subagent host has none of those: the brief path goes in the prompt, the model is
a parameter, and there is no screen to check. The trade is that the report lands
here rather than on a surface Michael can talk to, so relay it — and the arc ends
when this session does.
