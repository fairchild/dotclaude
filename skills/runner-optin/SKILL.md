---
name: runner-optin
description: Run one reviewed commit of one pull request on this laptop while hosted runners are blocked. User-invoked only — Michael asks for it by name ("opt in", "opt out", "run this PR on my laptop"); never start it because a pull request looks red.
disable-model-invocation: true
metadata:
  status: experimental
  experimental_reason: "No eval and no invocations yet; the machinery it drives lands in services #1749 and has never run against a real pull request."
license: Apache-2.0
---

# Runner opt-in

Opting in runs the pull request's own code on this laptop as this user, and it
can read everything this user can: `~/.config/github-runner/config` and the
GitHub App private key it names, which mints runner registration tokens for
the repository and belongs to an App holding `Administration: write`; the
per-repo App credentials under `~/.config/gh-apps/`; the `gh` token; the SSH
agent; the Docker socket; the tailnet.

Not once, either. The opt-in workflow has five jobs, they run here one after
another because each runner takes exactly one, and their own timeouts allow a
little over two hours. Each installs that pull request's dependencies and runs
its scripts. Nothing here bounds any of that, and on this host nothing can: the
hooks beside the runner are mode 755 and owned by the user the job runs as, so
the gate routes jobs rather than containing them. The hardening plan's
non-admin runner user is the structural fix. Until it lands, opt in only to
pull requests written here, and the only real gate is that Michael has read the
diff at the commit he names.

Never opt in on your own initiative. A red pull request is not a request. Wait
for his words.

## What this is

Hosted runners refuse to start while the account's billing is blocked, so a
pull-request job goes red before a step exists. Nothing about a pull request
routes work here: there is no label, no `pull_request` trigger, no path filter.
A run exists because somebody with write access dispatched
`.github/workflows/pr-optin-run.yml` by hand, naming the pull request number
and the commit they read, against a runner registered on this machine for that
pull request alone. Each runner is ephemeral — one job, then deregistered — and
a supervisor registers the next, so the jobs run here in sequence.

Two things follow from being a dispatch rather than a pull-request event, and
they are the whole argument for this shape.

The definition that executes is the repository's own `pr-optin-run.yml` at
`refs/heads/main`, never the pull request's copy of it. The pull request's code
is checked out as data: it cannot add a step, change a runner, or reach a
secret. A label-gated `pull_request` run would have executed the pull request's
own workflow file, which is the design this replaced.

The run does not attach its checks to the pull request. The pull request stays
red while hosted capacity is blocked, and the run is read on its own. That is
the accepted cost of a gate a pull request cannot pull.

Four pieces have to agree, and they do not all live in the same place:

| Piece | Where it lives, and who supplies it |
|---|---|
| `.github/workflows/pr-optin-run.yml` — five jobs, `workflow_dispatch` alone, `runs-on` built by `format()` from the dispatched number, `ref: ${{ inputs.head_sha }}` with `persist-credentials: false` | The target repository's own default branch. Only `fairchild/services` carries it today. |
| `trust-optin-job.sh`, `pre-job-optin.sh` and `clean-workspace.sh`, the pre-job gate | The services checkout. `runner.sh` copies all three into the runner directory from a path relative to itself, so whichever checkout you run the gesture from supplies the gate. |
| `scripts/runner.sh` — preflight, registration, the supervisor, teardown | The same services checkout. |
| The dispatch | You. `gh workflow run` needs write access, so the gesture is collaborator-only by construction, and the pull request carries no state of ours. |

So the gestures below always run services' copy of `runner.sh`, whatever
repository is being opted in. Run them from a trusted checkout of services'
default branch, never from a worktree of the pull request under review.

The pull request number reaches the runner twice, by different routes. The
`pr-<N>` runner label, built by `format()` inside `runs-on`, decides which
runner GitHub may send the job to. The opt-in record at
`~/.config/github-runner/optin/<owner>/<repo>/<N>`, written before any job
exists, is what the gate compares the dispatch payload against. The gate finds
the record by the number the dispatch claims, which is not circular: the
record's existence is the authorisation, and a dispatch naming a pull request
nobody opted in finds nothing.

### What binds the reading to the run

Three things, and they are why this gesture is worth the risk it carries.

The workflow checks out `inputs.head_sha` rather than a branch, and its first
step asserts that `git rev-parse HEAD` equals it. The gate compares that same
input against the `head_sha=` line in the record. And a dispatch naming any
other commit is not merely refused: the gate deletes the record, which is the
supervisor's only permission to register another runner. The window closes, and
Michael opts in again against what he has read.

### Where the boundary sits now

Pull-request code still never reaches the persistent runners, `la` and `orin`,
but the dispatch gate moved what holds that true, and the file should be read
knowing where it moved to.

`workflow_dispatch` on `refs/heads/main` is a trusted event for
`trust-main-job.sh`, the persistent runners' own pre-job hook, so the event
type no longer excludes an opt-in job from them. Two things do, and they work
from opposite ends.

The runner label set is the routing: neither persistent runner carries
`optin`, and `format()` can only append after `pr-`, so no dispatch input
removes `optin` from that array or reaches `la` or `orin`. And
`trust-main-job.sh` now refuses `pr-optin-run.yml` by name, at any ref and
whatever the label set says, before it considers anything else — so a routing
mistake is a rejection rather than a breach.

Holding both in place, `verify_pr_runner_routing.py` pins the selector
expression to `pr-optin-run.yml` and refuses any other `runs-on` inside that
file, including a Main-only selector — which is approved everywhere else and
which here would put a checked-out pull request on a persistent runner.

## Opt in

```
opt in <owner>/<repo> <N> [<sha>]
```

### 1. Read the pull request

```bash
gh pr view <N> --repo <owner>/<repo> --json number,title,author,headRefOid,isCrossRepository,state
gh pr diff <N> --repo <owner>/<repo>
```

Show him the head sha and the diff. Among our own pull requests the author
proves nothing, since every agent in this fleet writes as his login — there the
gate is his reading, at that sha, now. What the author still separates is our
own pull requests from everyone else's, and `app/dependabot` is the case that
matters most, because a dependency bump's diff is a version string rather than
the code inside the new version, so reading it proves almost nothing.

Refuse and say which check failed:

- `author.login` is not `fairchild`, or `author.is_bot` is true, or the login
  ends in `[bot]` or starts with `app/`.
- He has not said he read the diff, or he names a sha that is not `headRefOid`.
- `isCrossRepository` is true. This refusal is now load-bearing rather than
  academic: the old one rested on GitHub declining to send fork pull requests
  to self-hosted runners, and a dispatch on Main is not a fork pull request, so
  a fork's commit would check out and execute here like any other. Nothing in
  the machinery stops it. This line is the stop.
- `state` is not `OPEN`.
- This pull request is already opted in. These are the reads, and refusing is
  also correct when any of them cannot be read:

```bash
./scripts/runners.sh <owner>/<repo>
cat ~/.config/github-runner/optin/<owner>/<repo>/<N>
```

The record, the supervisor and the work tree are keyed by pull request, so two
can be opted in at once and opting out of one leaves the other alone.

### 2. Preflight, register, then dispatch

```bash
./scripts/runner.sh preflight <owner>/<repo> <N>
./scripts/runner.sh optin <owner>/<repo> <N> <sha>
gh workflow run pr-optin-run.yml --repo <owner>/<repo> --ref main \
  -f pull_request=<N> -f head_sha=<sha>
```

In that order, and the order is the safety. Preflight checks the dependencies,
the GitHub App configuration and its key by path, the three hook files, a
running supervisor and a conflicting record, and prints the current head.
`optin` installs the gate, registers the first ephemeral runner and waits for a
listener the supervisor actually started, failing rather than reporting a
supervisor that cannot register. Only then does the dispatch have capacity to
land on. A dispatch over a failed opt-in queues its jobs against a runner that
will never exist, and a dispatched job has no hosted fallback — the fallback
branch is unreachable for a dispatch on Main, so the run waits until somebody
cancels it.

`optin` refuses if the pull request has moved: pass the sha he read as the
third argument and the script compares it against the current head rather than
silently binding a newer commit.

Add `-f suites=lint,python` to run a subset of the five. The names are `lint`,
`python`, `files`, `draw` and `authkit`; the default is all five. Two dispatches
for one pull request share a concurrency group, so the newer cancels the older.

If anything fails after `optin` has returned, roll the opt-in back before
reporting. `optin` traps its own failures and does this itself, so this covers
a failure of the dispatch step or anything outside the script:

```bash
./scripts/runner.sh optout <owner>/<repo> <N>
```

Report back the runner name, the head sha, the labels, the record path, the
gate path, the supervisor's PID, and how many jobs were dispatched — that last
is how long the laptop is committed for.

### How an opt-in ends

Three ways. There is no label to take off a pull request, so nothing outward
has to be undone; what ends is the supervisor's permission to register the next
runner.

| Ending | What happened |
|---|---|
| `opt out` | The gesture below. It deletes the record, signals the supervisor's process group, deregisters and removes the work tree. |
| A push | The dispatch named a commit the record does not hold. The gate refused the job with exit 78 and deleted the record, so the supervisor's loop ends on its next pass. A new head needs a new reading and a new gesture; never reopen one on his behalf. |
| No job served | Five attempts in a row served no job, counting a failed registration and a failed token fetch, so the supervisor stopped rather than looping. An offline laptop reaches this. |

The heartbeat is how the second and third are told apart from the first: the
supervisor's last log line names which ending it took. A run dispatched after
any of them waits for a runner that is not there, so cancel it.

## Watch

```
watch
```

```bash
gh run list --repo <owner>/<repo> --workflow pr-optin-run.yml --limit 5
gh run watch <run-id> --repo <owner>/<repo>
./scripts/runners.sh <owner>/<repo>
tail -n 5 ~/.local/share/actions-runner-optin/<owner>-<repo>-pr<N>/runner.log
```

Select the run by workflow and take the newest, not by commit: the run rides
`refs/heads/main`, so its commit is Main's and not the pull request's. The
`lint` job writes `Ran pull request <N> at <sha>` into the run summary, which
is how a run is tied back to what it was dispatched for — a dispatch whose
`suites` leaves `lint` out has no such line, so note the run id when you
dispatch it.

A runner appearing and disappearing between two calls to `runners.sh` is the
supervisor doing its work — five jobs means five registrations. The log's last
line is the heartbeat: it names the time and the runner it is listening as, and
it stops advancing when the supervisor stops.

The supervisor runs under `nohup` and outlives the session that started it. If
this session ends, those four reads are how the next one picks it up; the three
endings above are how it stops.

## Opt out

```
opt out <owner>/<repo> <N>
```

```bash
./scripts/runner.sh optout <owner>/<repo> <N>
cat ~/.config/github-runner/optin/<owner>/<repo>/<N>  # expect: no such file
./scripts/runners.sh <owner>/<repo>                   # expect: no optin-pr runner
```

`optout` refuses a number the record does not name, so a typo stops nothing
rather than tearing down the wrong opt-in. It removes the record first, then
signals the supervisor's whole process group, which reaches the listener, the
worker and anything the job started, then deregisters and deletes the work
tree. Run the two reads afterwards and report both, because a network failure
mid-teardown can leave a runner registered with the record already gone.

Opting out closes future routing only. It does not touch a job already
dispatched and running: the gate ran before that job's first step and will not
run again. Cancel a run in flight separately, and do it before `optout` if the
job is live, so the teardown is not racing a worker.

```bash
gh run cancel <run-id> --repo <owner>/<repo>
```

Opt out when the run finishes, when the reading is stale, or when stepping away
from the laptop. It is not housekeeping: until one of the three endings
happens, the supervisor registers a new runner after every job. Running it
after an ending that already cleaned up is safe and worth doing, because it
also deregisters a runner a network failure may have left behind.

## When it will not work

- The target repository has no `.github/workflows/pr-optin-run.yml` on its
  default branch. Today only `fairchild/services` does. The verifier admits the
  opt-in selector in that file and nowhere else, and admits no other `runs-on`
  inside it:

```bash
uv run --script .github/scripts/verify_pr_runner_routing.py
```

- The dispatch names a commit the record does not hold, or the record is
  missing, world-readable, a symlink, or sits under a directory writable beyond
  its owner. The gate refuses with exit 78 before the first step and says
  which. A refusal on the sha also closes the opt-in.
- The GitHub App is not installed on the repository, its configuration at
  `~/.config/github-runner/config` is absent, or `curl`, `jq` or `openssl` is
  missing. Preflight names whichever it is. Never read that file or the key it
  points at.
- A hook file is missing from the checkout. `optin` refuses to register rather
  than register without a gate, which is the intended failure.
