# Parallel Agents

Advisory guidance for running multiple independent agents against a shared backlog. The skill provides primitives; this doc names the patterns that compose them into a working distributed system, and the failure modes you have to design around.

## Mental model

A task file is a durable execution log: frontmatter + description is the spec, the bullet log is the event stream, the pile location is derived state — all in git. Loosely inspired by Temporal's durable-workflow pattern: `progress` lines are activity checkpoints that survive across attempts, and an agent picking up a re-released task can read prior progress and skip what's already done.

This puts a usage obligation on progress notes: **write them semantically and idempotently**. "auth migration prototype passing locally" tells the next claimer what's done and is safe to skip; "still working" tells them nothing.

## What the skill provides

The atomic primitives, and nothing else:

- **Maildir lock.** `git mv todo/X.md doing/X.md` is the claim. Two agents racing the same task collide at merge — the failure is surfaced, not silenced.
- **Append-only log.** One bullet per event, in committed git history. Both `cat` and `git log --follow` are valid views.
- **Near-immutable spec.** Frontmatter and description are frozen after first commit, with one exception: `reopen` may edit them, since reopen IS a correction. State changes otherwise go to the log.
- **Author-declared (or default) budgets.** `timeout:` in frontmatter is the contract for "release this if it sits in `doing/` past this duration." Absent = 7d (see "Default timeout" below).

## What's out of scope

- **No worker pool.** Agents discover and take tasks themselves; nothing dispatches.
- **No leader election.** All agents are peers; collisions are git's problem.
- **No heartbeat enforcement.** A claimer that goes silent isn't pinged; timeouts and grooming are the failure-detection mechanism.
- **No cron / scheduler.** Periodic cleanup is the operator's responsibility — see "Two cleanup patterns" below.

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

The skill provides two routes for handling timed-out tasks — `recover` in place, `release` back to `todo/`, or `fail` to `failed/` if retries are exhausted. The two patterns differ in *who runs the routing*, not in what actions are available. They compose — you can do either or both. Parallel runs collide at git the same way a real take-race would, which is the right failure mode.

### Take-prelude (recommended for high-traffic backlogs)

Before a take, scan `doing/` for stale claims. For each:

- If `recovered` count ≥ `max_retries` (default 3, overridable per-task via `max_retries:` frontmatter): invoke `fail` — move to `failed/` with a "retries exhausted" reason. Out of the active queue.
- Else if this is the task the agent wants to work on: invoke `recover` — claim in place, no `git mv`. Kanban flow stays right-to-left.
- Else: invoke `release` — move back to `todo/` so another agent can pick up.

```bash
now=$(date -u +%s); ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
target_slug="${1:-}"        # set if the agent has a specific slug in mind; empty for scan-only
max_retries=3

for f in backlog/doing/*.md; do
  [[ -f "$f" ]] || continue
  timeout=$(awk '/^---$/{n++; if(n==2) exit} n==1 && /^timeout:/ {sub(/^timeout:[[:space:]]*/, ""); print; exit}' "$f")
  [[ -z "$timeout" ]] && timeout=7d
  started=$(grep -E '^- [0-9TZ:-]+ (started|recovered) ' "$f" | tail -1 | awk '{print $2}')
  [[ -z "$started" ]] && continue
  n="${timeout%[smhdw]*}"; unit="${timeout: -1}"
  case "$unit" in s) secs=$n;; m) secs=$((n*60));; h) secs=$((n*3600));; d) secs=$((n*86400));; w) secs=$((n*604800));; *) continue;; esac
  ep=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$started" +%s 2>/dev/null || gdate -d "$started" +%s 2>/dev/null || true)
  [[ -z "$ep" ]] && continue
  (( now - ep > secs )) || continue

  slug=$(basename "$f" .md)
  recovered_count=$(grep -c '^- .*recovered' "$f")
  task_max=$(awk '/^---$/{n++; if(n==2) exit} n==1 && /^max_retries:/ {sub(/^max_retries:[[:space:]]*/, ""); print; exit}' "$f")
  [[ -z "$task_max" ]] && task_max=$max_retries

  if (( recovered_count >= task_max )); then
    # Dead-letter
    mkdir -p backlog/failed
    git mv "$f" "backlog/failed/${slug}.md"
    echo "- $ts failed | retries exhausted: $recovered_count recoveries, budget $timeout" >> "backlog/failed/${slug}.md"
    git add "backlog/failed/${slug}.md"
    git commit -m "fail($slug) retries exhausted"
  elif [[ "$slug" == "$target_slug" ]]; then
    # Recover in place
    branch=$(git rev-parse --abbrev-ref HEAD)
    claimer=${CONDUCTOR_WORKSPACE_NAME:+conductor:$CONDUCTOR_WORKSPACE_NAME}
    claimer=${claimer:-${CMUX_WORKSPACE_ID:+cmux:$CMUX_WORKSPACE_ID}}
    claimer=${claimer:-$(whoami)@$(hostname -s)}
    echo "- $ts recovered claimer=$claimer branch=$branch" >> "$f"
    git add "$f"
    git commit -m "recover($slug) $claimer @ $branch"
  else
    # Release back to todo/ — let any agent pick up
    git mv "$f" "backlog/todo/${slug}.md"
    echo "- $ts released | timeout: budget=$timeout, claimed=$started" >> "backlog/todo/${slug}.md"
    git add "backlog/todo/${slug}.md"
    git commit -m "release($slug) timeout"
  fi
done
# Then run the normal take recipe (or auto-pick) for the target_slug if not recovered above.
```

### Periodic janitor (recommended for low-traffic backlogs)

A scheduled job (cron, GitHub Action, Conductor hook) runs the same loop above with `target_slug=""` (scan-only), which releases stale tasks back to `todo/` and routes retry-exhausted ones to `failed/`. The janitor never *recovers* — that requires an agent ready to take. Catches the case where tasks time out but no agent has taken anything in a while.

The released line in the log looks like:

```
- 2026-05-17T00:00:00Z released | timeout: budget=3d, claimed=2026-05-14T00:00:00Z, claimer=conductor:austin-v3
```

**`ls doing/` = active work, with an asterisk:** the invariant holds *as of the last detection sweep*. Either a janitor must run on a schedule, or workers must run preludes frequently enough that staleness windows stay bounded.

## Why release moves the file rather than tagging in place

A `release` could append a `released` log line in place and leave the file in `doing/` — but that breaks location-is-status: `ls doing/` would no longer mean "in flight," every status check would have to read each file's log, and the `git mv` race that gives us the atomic lock would be decoupled from the state change. Keeping release as one operation (move + append + commit) preserves both invariants.

## The single permitted exception to "groom never moves files"

Groom is advisory by default. The one exception: for TIMED-OUT entries (author-declared budget exceeded, or default-inherited), groom may either `release` back to `todo/` or `fail` to `failed/` if the `recovered` count has exceeded `max_retries`. The author authorized the timeout; the retry threshold is the agreed escalation. Enforcing both is contract-keeping, not policy.

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

The worker uses `release` (not `recover`) for its own voluntary handback — the worker is the active claimer giving up. `recover` is for *picking up someone else's* stale claim, which is what take-prelude does before a fresh take.

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
| Worker crashes mid-activity                   | Timeout → next worker's prelude recovers in place (or janitor releases) |
| Worker completes but never moves to `done/`   | MERGED-BUT-NOT-MOVED bucket; safe auto-fix |
| Worker hangs (no progress, timeout not yet exceeded) | Waits until TIMED OUT fires (declared budget or 7d default) |
| Worker writes ambiguous progress notes        | Next attempt redundantly redoes work — wasted time, not incorrectness |
| Two workers race the same task                | Git merge conflict → one wins, one rebases |
| Worker takes a task it can't handle           | `release` with reason; another worker picks up |
| Task keeps timing out across many attempts    | `recovered` count exceeds `max_retries` → `fail` to `failed/`; operator investigates |

### What this skill deliberately doesn't help with

- Choosing which projects' backlogs to work on
- Inter-backlog dependencies (deps are intra-backlog only)
- Cross-backlog rate limiting or quota
- Persistent worker registries or health dashboards
- Retry policy beyond "count `recovered` lines, dead-letter via `fail` when count exceeds threshold" (e.g., exponential backoff, jittered retries)

Build those *above* the skill, in your project, where they belong.
