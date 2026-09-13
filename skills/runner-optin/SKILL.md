---
name: runner-optin
description: Run one reviewed commit of one pull request on this laptop while hosted runners are blocked. User-invoked only — Michael asks for it by name ("opt in", "opt out", "run this PR on my laptop"); never start it because a pull request looks red.
disable-model-invocation: true
license: Apache-2.0
---

# Runner opt-in

Opting in runs the pull request's own code on this laptop as this user, with
this user's SSH agent, Docker socket and tailnet. Not once: a pull request
touching `auth/` reaches eighteen opted-in jobs, and they run here one after
another, each installing that pull request's dependencies and running its
scripts, for as long as the run takes. Nothing in this skill bounds what any
of that code can do while it runs. The hardening plan's non-admin runner user
is what closes it; until then the only real gate is that Michael has read the
diff at the commit he names.

Never opt in on your own initiative. A red pull request is not a request. Wait
for his words.

## What this is

Hosted runners refuse to start while the account's billing is blocked, so a
pull-request job goes red before a step exists. Labelling a pull request
`ci:optin` routes its jobs to runners registered on this machine for that pull
request and that commit alone. Each runner is ephemeral — one job, then
deregistered — and a supervisor registers the next, so the jobs run here in
sequence. With no label and no runner the selector falls back to hosted
capacity: Linux jobs to `ubuntu-latest`, the one Swift job to `macos-26`.

Three pieces have to agree, and they do not all live in the same place:

| Piece | Where it lives |
|---|---|
| The `runs-on` selector, and `types: [..., labeled]` so the label starts a run | The target repository's own workflows. Only `fairchild/services` carries them today. |
| `trust-optin-job.sh`, the pre-job gate | The services checkout. `runner.sh` copies it from a path relative to itself, so whichever checkout you run the gesture from supplies it. |
| `scripts/runner.sh`, registration and teardown | The same services checkout. |

So the gestures below always run services' copy of `runner.sh`, whatever
repository is being opted in. Run them from a trusted checkout of services'
default branch, never from a worktree of the pull request under review.

The pull request number reaches the runner twice, by different routes. The
`pr-<N>` runner label, built from the event payload inside `runs-on`, decides
which runner a job may match. The opt-in record on disk, written before any
job exists, is what the gate compares against. `ci:optin` itself carries
nothing but the decision to opt in.

## Opt in

```
opt in <owner>/<repo> <N>
```

### 1. Read the pull request

```bash
gh pr view <N> --repo <owner>/<repo> --json number,title,headRefOid,isCrossRepository,state
gh pr diff <N> --repo <owner>/<repo>
```

Show him the head sha and the diff. Author is not a signal here — every agent
in this fleet writes as his own login, so a pull request's author tells you
nothing about whether anyone read it. The gate is his reading, at that sha,
now.

Refuse and say which check failed:

- He has not said he read the diff, or he names a sha that is not `headRefOid`.
- `isCrossRepository` is true. GitHub does not send fork pull requests to
  self-hosted runners, so the opt-in would hang rather than fail.
- `state` is not `OPEN`.
- An opt-in is already live. These are the reads, and refusing is also correct
  when any of them cannot be read:

```bash
gh pr list --repo <owner>/<repo> --label ci:optin --state open
./scripts/runners.sh <owner>/<repo>
cat ~/.config/github-runner/optin/<owner>/<repo>
```

One record exists per repository, because the gate has to find it without
knowing the number it is about to check. A second opt-in on the same
repository is refused, not merged.

### 2. Preflight, then label, then register

```bash
./scripts/runner.sh preflight <owner>/<repo> <N>
gh pr edit <N> --repo <owner>/<repo> --add-label ci:optin
./scripts/runner.sh optin <owner>/<repo> <N> <sha>
```

Preflight first and label second, in that order. Preflight checks the
dependencies, the GitHub App configuration and its key by path, the three hook
files, a running supervisor and a conflicting record, and prints the current
head. A label applied over a failed preflight queues a job against a runner
that will never exist, and a queued job does not fall back to hosted capacity.

If anything after the label fails, remove the label before reporting:

```bash
gh pr edit <N> --repo <owner>/<repo> --remove-label ci:optin
```

Report back the runner name, the head sha, the labels, the record path, the
gate path, the supervisor's PID, and how many jobs the run has — that last is
how long the laptop is committed for.

A push to the pull request after this closes the opt-in. The gate compares the
payload's head sha to the recorded one, refuses the job, and deletes the
record, which stops the supervisor. A new head needs a new reading and a new
gesture; never reopen one on his behalf.

## Watch

```
watch
```

```bash
gh run list --repo <owner>/<repo> --commit <sha> --limit 5   # take the run id
gh run watch <run-id> --repo <owner>/<repo>
./scripts/runners.sh <owner>/<repo>
tail -n 5 ~/.local/share/actions-runner-optin/<owner>-<repo>/runner.log
```

Select the run by the opted-in sha, not by branch; a branch-scoped list returns
the stale pre-label runs too. A runner appearing and disappearing between two
calls is the supervisor doing its work. The log's last line is the heartbeat:
it names the time and the runner it is listening as, and it stops advancing
when the supervisor stops.

The supervisor runs under `nohup` and outlives the session that started it. If
this session ends, those four reads are how the next one picks it up, and
`opt out` is how it ends.

## Opt out

```
opt out <owner>/<repo> <N>
```

```bash
gh pr edit <N> --repo <owner>/<repo> --remove-label ci:optin
./scripts/runner.sh optout <owner>/<repo> <N>
cat ~/.config/github-runner/optin/<owner>/<repo>   # expect: no such file
./scripts/runners.sh <owner>/<repo>                # expect: no optin-pr runner
```

Removing the label stops future routing only. It does not touch a job already
dispatched: the gate reads the record, never the labels. Cancel a run in
flight separately.

```bash
gh run cancel <run-id> --repo <owner>/<repo>
```

`optout` refuses a number the record does not name, so a typo stops nothing
rather than tearing down the wrong opt-in. It removes the record first, then
the supervisor, then any process under that runner's directory, then
deregisters. Run the two reads afterwards and report both, because a network
failure mid-teardown can leave a runner registered with the record already
gone.

Opt out when the run finishes, when the reading is stale, or when stepping
away from the laptop. It is not housekeeping. The supervisor registers a new
runner after every job until the record is gone.

## When it will not work

- The job's `runs-on` is not one of the two approved opt-in selectors, or its
  workflow does not declare `labeled`. Both are checked by the verifier, which
  also refuses an opt-in selector in any workflow that declares
  `pull_request_target`:

```bash
uv run --script .github/scripts/verify_pr_runner_routing.py
```

- The GitHub App is not installed on the repository, its configuration at
  `~/.config/github-runner/config` is absent, or `curl`, `jq` or `openssl` is
  missing. Preflight names whichever it is. Never read that file or the key it
  points at.
- A hook file is missing from the checkout. `optin` refuses to register rather
  than register without a gate, which is the intended failure.
