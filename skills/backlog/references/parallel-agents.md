# Parallel Agents

Advisory guidance for running multiple independent agents against a shared backlog. The skill provides primitives; this doc names the patterns that compose them into a working distributed system, and the failure modes you have to design around.

## Mental model

A task file is a durable execution log: frontmatter + description is the spec, the bullet log is the event stream, the pile location is derived state — all in git. Loosely inspired by Temporal's durable-workflow pattern: `progress` lines are activity checkpoints that survive across attempts, and an agent picking up a re-released task can read prior progress and skip what's already done.

This puts a usage obligation on progress notes: **write them semantically and idempotently**. "auth migration prototype passing locally" tells the next claimer what's done and is safe to skip; "still working" tells them nothing.

## What the skill provides

The atomic primitives, and nothing else:

- **Maildir lock.** `git mv todo/X.md doing/X.md` is the claim. Two agents racing the same task collide at merge — the failure is surfaced, not silenced.
- **Append-only log.** One bullet per event, in committed git history. Both `cat` and `git log --follow` are valid views.
- **Immutable spec.** Frontmatter and description don't change after creation. State changes are log appends.
- **Author-declared (or default) budgets.** `timeout:` in frontmatter is the contract for "release this if it sits in `doing/` past this duration." Absent = 7d (see "Default timeout" below).

## What's out of scope

- **No worker pool.** Agents discover and take tasks themselves; nothing dispatches.
- **No leader election.** All agents are peers; collisions are git's problem.
- **No heartbeat enforcement.** A claimer that goes silent isn't pinged; timeouts and grooming are the failure-detection mechanism.
- **No cron / scheduler.** Periodic cleanup is the operator's responsibility — see "Two cleanup patterns" below.

Composing the skill into a complete distributed system is design work that lives in the project that uses it, not in this skill.

## Default timeout: 7 days

Tasks may declare a `timeout:` in frontmatter. **If they don't, groom and take-prelude treat the task as having `timeout: 7d`.** That way every task is recoverable from a dead claimer without forcing the author to think about budgets at add time.

```
- 2026-05-17T00:00:00Z released | timeout: budget=7d (default), claimed=2026-05-10T00:00:00Z, claimer=...
```

The 7d default is a skill-level convention, documented here and in `backlog/AGENTS.md` (so a fresh agent landing in the project sees it). Authors who need a tighter or looser budget for a specific task declare it explicitly:

```yaml
---
timeout: 4h        # short-running agent task
timeout: 30d       # long-running migration
---
```

Projects with a fundamentally different rhythm can override the default by stating one at the top of their `backlog/AGENTS.md` (e.g., "default timeout in this project: 24h"). The recipes don't read AGENTS.md — it's social convention — but humans and agents do, and they declare timeouts on tasks accordingly.

## Failure detection

Timeout is the primitive built in. The other detection patterns are useful supplements you can add as additional `groom` buckets without changing the file format:

| Pattern              | What it catches                              | What it needs                     |
|----------------------|----------------------------------------------|-----------------------------------|
| **Timeout** (built-in) | Claim age exceeded the budget (declared or 7d default) | Just the file                |
| Heartbeat            | Claimer hung mid-task without timing out     | Claimer cooperation: append `progress` every N min |
| Branch / PR liveness | Claim's branch is dead and never shipped     | Git / network state               |
| Workspace presence   | Claim's workspace ID no longer exists        | Conductor (or equivalent) inspection |

For v1, timeout alone is enough because it requires nothing external. Add the others as new groom buckets if you observe real cases they'd catch.

## Two cleanup patterns (both idempotent, both safe)

The skill provides two ways to release timed-out tasks back to `todo/`. They compose — you can do either or both. Parallel runs collide at git the same way a real take-race would, which is the right failure mode.

### Take-prelude (recommended for high-traffic backlogs)

Every `take` first releases any TIMED-OUT entries it finds, then proceeds with normal claim selection. The act of taking is what cleans the queue. No separate process needed; cleanup cadence equals take cadence.

### Periodic janitor (recommended for low-traffic backlogs)

A scheduled job (cron, GitHub Action, Conductor hook) runs `groom` and releases TIMED-OUT entries. Catches the case where a task times out but no agent has taken anything in a while.

Both patterns invoke the existing `release` recipe with a structured reason — no new verb, no new format. The released line in the log looks like:

```
- 2026-05-17T00:00:00Z released | timeout: budget=3d, claimed=2026-05-14T00:00:00Z, claimer=conductor:austin-v3
```

The next take sees the released line and the prior progress notes, then resumes the activity stream.

## The single permitted exception to "groom never moves files"

Groom is advisory by default. The one exception: it may release a task back to `todo/` if and only if the task is in the TIMED-OUT bucket (author-declared budget exceeded). The move uses the existing `release` recipe with a `timeout: ...` reason.

This works because the timeout was declared by the task author. The system isn't overriding human judgment — it's enforcing a contract the author wrote down. Untyped quiet tasks stay advisory; only timed-out ones are auto-actionable.

## Limits worth knowing about

- **The 7d default may be wrong for your workflow.** Conductor agents typically finish in hours; long migrations may take weeks. Authors should override per-task when the default is a poor fit, and projects with a fundamentally different rhythm should state their convention in `backlog/AGENTS.md`.
- **Released tasks come back to `todo/`**, where any agent can re-take them — including the one that just timed out. If the original claimer is permanently dead, this is fine. If they're slow but alive, they'll race for the re-take. Not a problem in practice; the log reflects both attempts.
- **Cross-task ordering isn't preserved across timeouts.** If `B` was taken after `A` originally, and `A` timed out, `B` could complete before `A`'s second attempt. Dependencies in frontmatter handle the cases where ordering matters.
- **Activity skipping is convention, not enforcement.** The format makes prior progress notes visible; the claimer is trusted to read them and skip appropriately. There's no machine-checked "this activity was already done" guarantee.

---

## Worker process design (exploratory)

Beyond the primitives, here's a sketch of what a working worker process looks like. **Out of scope for the skill itself** — read this as orientation for the *projects* that use the skill, not a contract the skill enforces.

### Core loop

```
while true:
  take a task (with take-prelude that releases timed-out)
  read the file's full body — frontmatter spec + prior progress notes
  identify completed activities from prior attempts (semantic reading)
  for each remaining activity:
    do the work
    append a progress note with semantic detail, commit
  if work succeeded: run `complete` recipe
  if work failed and is retryable: run `release` with reason
  if work failed and is not: run `cancel` with reason
```

Stateless: each cycle reads everything it needs from the task file. No worker-side memory across tasks; restart equals re-read.

### Worker identity

The take recipe stamps a `claimer=` from the environment in this order:

1. `CONDUCTOR_WORKSPACE_NAME` → `conductor:austin-v3`
2. `CMUX_WORKSPACE_ID` → `cmux:abc123`
3. fallback → `user@host`

For your own worker, pick whichever identifies the agent process uniquely enough to be useful in `git blame` / progress logs. The identity is informational — it doesn't drive scheduling or authorization.

### Scheduling shapes

The skill enables several worker scheduling patterns without baking any in:

| Shape           | When it fits                                       | How it composes with the skill                    |
|-----------------|----------------------------------------------------|---------------------------------------------------|
| **One-off**     | Human invokes a worker for a specific task         | Just call the verb recipes inline                 |
| **Continuous loop** | Single agent burning down a backlog            | Worker loops; sleeps when `todo/` is empty        |
| **Parallel pool** | Many workers, shared backlog                     | Each worker is independent; lock = git mv         |
| **Specialized** | Workers filter tasks by slug prefix or `topic:`-like convention | Worker scans `todo/` and filters before calling take with an explicit slug |

For most cases, *the agents themselves are the scheduler* — each one reads the backlog and decides what to take. The skill enables this by making all relevant state visible in the filesystem; no broker, no queue, no dispatcher.

### Failure modes and what handles them

| Failure                                       | Handled by                                |
|-----------------------------------------------|-------------------------------------------|
| Worker crashes mid-activity                   | Timeout → release → next worker picks up  |
| Worker completes but never moves to `done/`   | MERGED-BUT-NOT-MOVED bucket; safe auto-fix |
| Worker hangs (no progress, no timeout exceeded yet) | QUIET bucket (advisory)              |
| Worker writes ambiguous progress notes        | Next attempt redundantly redoes work — wasted time, not incorrectness |
| Two workers race the same task                | Git merge conflict → one wins, one rebases |
| Worker takes a task it can't handle           | `release` with reason; another worker picks up |

### What this skill deliberately doesn't help with

- Choosing which projects' backlogs to work on
- Inter-backlog dependencies (deps are intra-backlog only)
- Cross-backlog rate limiting or quota
- Persistent worker registries or health dashboards
- Failure-mode policy beyond "release with a reason" (e.g., dead-letter queues, backoff)

Build those *above* the skill, in your project, where they belong.
