---
name: fable-session
description: Michael's default handoff shape for long-arc work — a fresh Fable terminal that orchestrates and verifies while delegating the implementation. Use when he says "hand off to a fable session", "fable team session", "fable workflow session", or asks who should own a multi-step piece of work.
license: Apache-2.0
---

# Fable Session

The shape Michael reaches for when work has a long arc: a fresh Claude terminal
running Fable in the target worktree, pointed at a brief, owning the piece end
to end.

The reason it's Fable at the top and something else underneath is context.
Judgment degrades as a context window fills, and the orchestrator's judgment is
the thing you can least afford to lose — it's what catches the delegated result
that's subtly wrong. So the orchestrator holds the arc and stays light; the
implementation, which is where the tokens actually go, happens somewhere else.

## The split

Fable orchestrates. It holds the long arc, coordinates the pieces, and checks
quality and consistency across them. It does *not* do most of the implementation
itself — that's what keeps its context under roughly 200k, where its judgment
still holds.

It delegates the work, with these model defaults per task:

| Model | When |
|-------|------|
| Opus | Default |
| Sonnet | The task is simple and fully specified |
| Fable | The task needs more nuance and care |

Three phrasings select how it delegates:

- **fable session** — unspecified, Fable's call
- **fable team session** — directly via `Agent`
- **fable workflow session** — via the `Workflow` tool

## Verification is the orchestrator's job

Fable verifies every delegated result itself: runs the checks, looks at the
rendered output. A subagent's claim that something works is not evidence that it
works, and the orchestrator is the only party positioned to notice when a result
is locally correct but doesn't fit the arc.

Done means a commit plus a demonstrated run — an end-to-end recording where
there's a UI — not a report that it's finished.

## Launching one

The brief lives at `docs/plans/<name>.handoff.md` and is committed before
launch, so the session starts from something in history rather than something in
a chat log.

Launch with the model flag explicitly:

```bash
claude --model claude-fable-5
```

Bare `claude` opens on the terminal's default model, which has come up Opus.

Send a **one-line** prompt pointing at the brief. Multi-line pastes tend to land
in the composer unsubmitted, which looks like a session that started and then
did nothing.

The Orca mechanics — creating the worktree, creating the terminal, waiting for
tui-idle, sending the prompt, confirming the status line reads "Fable 5" — are
in the `orca-cli` skill under "Fable session handoff". Use those rather than
raw PTY work when the worktree is Orca-managed.
