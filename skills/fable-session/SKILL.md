---
name: fable-session
description: >-
  Hand off long-arc work to a fable session — a Fable orchestrator at xhigh
  effort verifies while delegating the implementation — and the operating rules
  for any agent fan-out — whether to fan out at all, a model named per spawn,
  one port and one writer per agent, and the lenses a review looks through.
  Triggers on "fable session", "fable team session", "fable workflow session",
  "fan out", "orchestrate".
license: Apache-2.0
---

# Fable Session

A session owning a piece of work end to end, in a worktree of its own. Its
orchestrator runs on Fable at `xhigh` effort unless the session brief names
another.

## Fan out

Fan out only where the work has that shape. Serial and coupled work — one config
hub, a feedback loop where each step's output decides the next edit, a rewrite
that has to go green as a whole — goes to one agent at high effort, since
fanning it out buys merge overhead and no wall clock. Independent items — docs
alongside code, N review lenses, N host cutovers, design options for a judge —
fan out. The usual shape is hybrid: one implementer, a parallel docs writer in
an isolated worktree, then a review fan-out. Say which parts are which in the
plan you show the owner, and name the cost in rough agent count and wall clock.

## Roles

The orchestrator holds the arc and checks coherence across pieces. It delegates the
implementation rather than doing it, keeping its own context inside the goal the
`compaction` mod reports rather than a number carried here (Context, below).

Delegation mechanism, by phrasing:

- **fable session** — the orchestrator's call
- **fable team session** — `Agent`
- **fable workflow session** — `Workflow`

## Model

A model is named on every delegated call, with one line in the brief saying why
that one. As a backstop, the launch lines under Host set
`CLAUDE_CODE_SUBAGENT_MODEL=opus`, so an `Agent` call that omits `model` lands on
the worker default instead of inheriting the orchestrator's Fable, while a named
model still wins over it. The variable lives on the launch command, which a resume
does not repeat, so a resumed session, one launched without it, or an `Agent`
subagent host may not carry it; there an omission costs Fable. Either way silence
is the one choice nobody weighed.

A worker's default is Opus, and the burden of proof sits on stepping down from
it: quality is the thing being bought, and the budget constrains how much of
it you can buy rather than competing with it. Step down to Sonnet only where
that line can say what makes it safe — something other than the model's
judgement settles correctness: a test shown failing on a mutant, a gate, a
reviewer's exact wording to apply, a named file to sweep, a mechanical merge, a
screenshot to capture. There the check decides and the model only executes, so a
stronger one reaches the same answer. Where the worker has to hold several
moving parts at once and decide something the brief has not named, a stronger
model does reach a different answer, and that is worth paying for. Between
Sonnet and Opus, uncertainty resolves upward: if you cannot say what makes Sonnet
safe, that is the answer. Fable where the work needs nuance, with the brief line
naming which; doubt about Opus does not reach it.

## Worker brief

Each worker is short-lived: one task, its own worktree and scratch folder, and a
brief naming the goal, the files in and out of scope, the done criterion and the
evidence expected. The brief also names what is off limits — no push, tag, PR or
`main`, and no file another agent owns — says to commit only its own files by
explicit path under conventional commits with the trailer, and asks for facts it
ran, with inferences and unknowns labelled and no pass claimed it did not read.
Its final message is data for an orchestrator rather than prose: `status`,
`commits`, `verification` with a line per command (pass / fail: why / not run:
why), `deviations`, `handoff`.

Run the first task of a kind alone and fan out once it has passed review. After
two failures for the same reason, move the task up a model. A review runs on a
model at least as strong as the work it reviews.

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

A reviewer is pointed at lenses rather than left to browse: residue (stale paths
and names), contract (the script or module against its documented contract — run
it), docs truthfulness (every command, path and claim against the tree; present
tense is true), CI parity (the workflow runs exactly the local sequence),
boundary (module and host rules, checked mechanically), and one lens for anything
new against its own contract. A finding needs file:line evidence and a concrete
fix; style is not a finding. Each one goes to a verifier told to refute by
default, and a 100% confirmation rate is a smell worth noting rather than a
result to celebrate.

## Shared machine

Agents running at once on one machine collide through what the prompt leaves
unnamed, so name it per agent:

- An explicit **port**, never "an unused port".
- **No `pkill -f`** or other pattern kill — only PIDs that agent started.
- **One runner at a time** for anything that empties shared output (a build, a
  clean, a release candidate); the orchestrator's own gate run comes after the
  agents are done.
- **One writer per file**, with disjoint file lists stated up front. A parallel
  writer on the same tree gets worktree isolation; cherry-pick its commit and
  check `git patch-id` equality before deleting its branch.
- Evidence — screenshots, logs — lives where no script wipes it.
- **Stop what you started.** A dev server, a preview, a watcher or a browser an
  agent started outlives the agent unless someone ends it, and a machine carrying
  several arcs' leftovers thrashes: load climbs, suites time out, and a timeout
  that isn't a real failure gets retried at full price. The agent kills its own
  PIDs when it reports; the orchestrator checks the machine before the next
  fan-out, not after.

Before touching a file yourself after sending a late instruction, check `git
status`: the agent may already be editing it.

## Decisions

Stop and ask the owner for these: publishing or anything else visible outside the
repository, spending money, deleting what can't be recovered, legal questions,
and loosening a gate. Decide everything else, record the decision and its reason
beside the work, and carry on.

## Context

The `compaction` mod holds the context goal, so this skill names no number of its
own: `mcp__compaction__context` reports where the session sits against the goal,
the request floor and the prepare point, and `/config` moves the goal for every
session that loads the mod. The orchestrator reads it rather than guessing, since
a goal in two places drifts.

At the prepare point, write a local, untracked resume file — the agents running and
what each is doing, decisions not yet recorded, blockers, and what must survive —
and then call `mcp__compaction__request` with what the summary must keep and why
compacting now beats carrying on, and a `resume` prompt naming the resume file. The mod
runs `/compact` once the turn ends, then submits that prompt to start the next turn. The
engine's own compaction is the backstop and takes no instructions, so a summary
that matters is one the thread asked for. After a compaction or a handoff, rebuild
state from live reads of branches, pull requests and checks; the resume file is a
guide to them.
The `compaction-handoff` skill carries the whole procedure, including the three cases
that resume nothing: a `/compact` typed by hand, a request the mod dropped, and a cut
whose resume prompt did not go in.

Before taking on a long arc, `mcp__usage-meter__reading` says what is left of the
account's five-hour and seven-day windows. That is the other budget: the context
goal decides when to compact, the windows decide whether to start.

Without the mods, the orchestrator keeps the arc and delegates the diffs, and
writes the resume file on its own judgement of the session's length.

## Done

A commit plus a demonstrated run — an e2e recording where there's a UI. The arc
closes once a fresh verifier that did not build it has reproduced each done
criterion from a tag or commit, and its findings are fixed or tracked.

Three parts of closing are the orchestrator's own and don't delegate. Re-run the
gate on the final commit, since a gate that passed on an earlier head says
nothing about what actually merges. Look at the rendered result — a 200 is not
evidence. And write the pull request body from what was verified, naming the
commit the gate ran on, so a reader can tell which head the claims belong to.

## Session brief

A written plan the session can read, pointed at rather than pasted, plus a
short who-does-what naming the split above. Point at whatever already holds the
plan — a backlog map, a PRD, the tracking issue. The handoff itself is not
committed: post it as a "Session handoff" comment on the
arc's tracking issue and have the first prompt say "read the session handoff
comment on #N", or keep it as a local untracked file. Durable findings go to
`docs/research/<topic>/`.

A brief that names a chat channel for the arc makes posting the default. The
orchestrator posts there on four occasions — `started`, `decided`, `finished`
and `need` — and at no other time, and ends each post with when to expect the
next, so a channel quiet past that time reads as a stalled arc.
[`references/arc-channel.md`](references/arc-channel.md) has the rule and an
example. A brief that names no channel posts nowhere.

## Host

Where the session runs is a separate choice from how it delegates. Default to the
surface the work already lives in.

| Host | Fits when | Mechanics |
|------|-----------|-----------|
| Orca terminal | `orca worktree current --json` resolves | `orca-cli` skill |
| WorkSpaces | the repo is registered with the `workspaces` CLI (`workspaces repo list`) | `scripts/launch-session.sh <repo> <name> <brief>`, relative to this skill's base directory |
| Plain terminal | none of the above, and the work wants a session that outlives this one | `git-worktree` skill for the worktree, then a terminal tab in it |
| `Agent` subagent | the arc fits inside this session | `Agent` with `model: "fable"`, `effort: "xhigh"`, `isolation: "worktree"` |

WorkSpaces is the first choice when it fits. The script creates the workspace from
`origin/main`, launches the orchestrator clear of this session's identity, and on a
fresh launch exits 0 only once `ws check` proves one session on the requested model
and effort. Exit 3 means a person has to answer a prompt in the row. Run it again to
bring a session back after it quits or the machine restarts; a resume comes back on
the model and effort the conversation last ran on and exits 0 once the session can
take input. Pass `--model` and `--effort` to override the defaults on a fresh launch;
on a resume the script warns and ignores them.

The other CLI hosts share the same three failure modes:

```bash
CLAUDE_CODE_SUBAGENT_MODEL=opus claude --model fable --effort xhigh
```

Pass both flags explicitly, since bare `claude` starts on the account's default, and
keep the variable, which sends a spawn that omits `model` to Opus (Model, above). `fable` is the
CLI's alias for the newest Fable, so the line follows the model as it moves; write a full model
id only to pin one. Wait for the TUI
to settle before sending. Send a one-line prompt pointing at the brief; multi-line
pastes sit unsubmitted in the composer. Read the screen once to confirm the status
line says Fable and the prompt was submitted rather than left sitting in `❯`,
then stop monitoring. A launch from inside a Claude session passes on that session's
`CLAUDE*` variables, which turns off transcript saving, so clear them first. Confirm
one process, a transcript on disk and the expected model.

Wait-then-send is a verb per host: Orca `terminal wait --for tui-idle` then
`terminal send`; a plain terminal you type into yourself.

A subagent host has none of those: the brief path goes in the prompt, the model is
a parameter, and there is no screen to check. The trade is that the report lands
here rather than on a surface the user can talk to, so relay it — and the arc ends
when this session does.
