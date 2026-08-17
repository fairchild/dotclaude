---
name: fable-session
description: Hand off long-arc work to a fable session — Fable orchestrates and verifies while delegating the implementation. Triggers on "fable session", "fable team session", "fable workflow session".
license: Apache-2.0
---

# Fable Session

A fresh Fable terminal in the target worktree, owning a piece of work end to end.

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

## Launch

Brief at `docs/plans/<name>.handoff.md`, committed before launch.

```bash
claude --model claude-fable-5
```

Pass the model flag explicitly — bare `claude` has come up Opus.

Send a one-line prompt pointing at the brief; multi-line pastes sit unsubmitted
in the composer.

Orca mechanics (worktree, terminal, tui-idle wait, send): `orca-cli` skill,
"Fable session handoff".
