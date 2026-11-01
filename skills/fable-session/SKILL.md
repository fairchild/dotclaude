---
name: fable-session
description: Hand off long-arc work to a fable session — an Opus 5.5 orchestrator at xhigh effort verifies while delegating the implementation. Triggers on "fable session", "fable team session", "fable workflow session".
license: Apache-2.0
---

# Fable Session

A session owning a piece of work end to end, in a worktree of its own. Its
orchestrator runs on Opus 5.5 at `xhigh` effort unless the brief names another.

## Roles

The orchestrator holds the arc and checks coherence across pieces. It delegates the
implementation rather than doing it, keeping its own context under ~200k.

Delegation mechanism, by phrasing:

- **fable session** — the orchestrator's call
- **fable team session** — `Agent`
- **fable workflow session** — `Workflow`

Model per delegated task:

- **Opus** — default
- **Sonnet** — simple and fully specified
- **Fable** — needs nuance

Each worker is short-lived: one task, its own worktree and scratch folder, and a
brief naming the goal, the files in and out of scope, the done criterion and the
evidence expected. Run the first task of a kind alone and fan out once it has
passed review. After two failures for the same reason, move the task up a model.
A review runs on a model at least as strong as the work it reviews.

## Review

Each change passes these in order:

1. **Reflect.** While the worker's context is warm, send it once: "Read your
   change with fresh eyes. Look for inconsistencies, untrue claims and ways to
   simplify. Act on what you find, then report what changed."
2. **Pre-review.** A fresh agent that did not build the change checks every claim
   it makes and reports to you, before the change is marked ready.
3. **Review.** One fresh reviewer marks each finding blocking, deferrable or nit.
   Blocking findings hold the merge. Each deferrable finding gets a fix or a
   tracked home, named in a reply. Re-checks go to the same reviewer and cover
   only the change since their last review, plus their own earlier findings.

## Decisions

Stop and ask the owner for these: publishing or anything else visible outside the
repository, spending money, deleting what can't be recovered, legal questions,
and loosening a gate. Decide everything else, record the decision and its reason
beside the work, and carry on.

## Context

Before the session nears its limit, write a local, untracked resume file: the
agents running and what each is doing, decisions not yet recorded, blockers, and
what must survive. After a compaction or a handoff, rebuild state from live reads
of branches, pull requests and checks; the resume file is a guide to them.

## Done

A commit plus a demonstrated run — an e2e recording where there's a UI. The arc
closes once a fresh verifier that did not build it has reproduced each done
criterion from a tag or commit, and its findings are fixed or tracked.

## Brief

A written plan the session can read, pointed at rather than pasted, plus a
short who-does-what naming the split above. Point at whatever already holds the
plan — a backlog map, a PRD, the tracking issue. The handoff itself is not
committed: post it as a "Session handoff" comment on the
arc's tracking issue and have the first prompt say "read the session handoff
comment on #N", or keep it as a local untracked file. Durable findings go to
`docs/research/<topic>/`.

## Host

Where the session runs is a separate choice from how it delegates. Default to the
surface the work already lives in.

| Host | Fits when | Mechanics |
|------|-----------|-----------|
| Orca terminal | `orca worktree current --json` resolves | `orca-cli` skill, "Fable session handoff" |
| cmux workspace | `$CMUX_WORKSPACE_ID` is set | `cmux-orchestrator` skill — `cmux new-workspace --cwd <worktree> --command <launch>` |
| WorkSpaces | the repo is registered with the `workspaces` CLI (`workspaces repo list`) | `scripts/launch-session.sh <repo> <name> <brief>`, relative to this skill's base directory |
| Plain terminal | none of the above, and the work wants a session that outlives this one | `git-worktree` skill for the worktree, then a terminal tab in it |
| `Agent` subagent | the arc fits inside this session | `Agent` with `model: "opus"`, `effort: "xhigh"`, `isolation: "worktree"` |

WorkSpaces is the first choice when it fits. The script creates the workspace from
`origin/main`, launches the orchestrator clear of this session's identity, and
exits 0 only once `ws check` proves one session on the requested model and effort.
Exit 3 means a person has to answer a prompt in the row. Run it again to bring a
session back after it quits or the machine restarts. Pass `--model` and `--effort`
to override the defaults.

The other CLI hosts share the same three failure modes:

```bash
claude --model claude-opus-5-5 --effort xhigh
```

Pass both flags explicitly, since bare `claude` starts on the account's default. Wait for the TUI
to settle before sending. Send a one-line prompt pointing at the brief; multi-line
pastes sit unsubmitted in the composer. Read the screen once to confirm the status
line says Opus 5.5 and the prompt was submitted rather than left sitting in `❯`,
then stop monitoring. A launch from inside a Claude session passes on that session's
`CLAUDE*` variables, which turns off transcript saving, so clear them first. Confirm
one process, a transcript on disk and the expected model.

Wait-then-send is a verb per host: Orca `terminal wait --for tui-idle` then
`terminal send`; cmux `read-screen` then `send` and `send-key Enter`; a plain
terminal you type into yourself.

A subagent host has none of those: the brief path goes in the prompt, the model is
a parameter, and there is no screen to check. The trade is that the report lands
here rather than on a surface the user can talk to, so relay it — and the arc ends
when this session does.
