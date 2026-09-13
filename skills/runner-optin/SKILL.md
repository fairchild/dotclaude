---
name: runner-optin
description: Run one pull request's CI on this laptop when hosted runners are blocked. Registers an ephemeral runner for that pull request alone, watches the run, and closes the window. Use on "opt in", "opt out", "run this PR on my laptop", or when a PR is red because hosted capacity refused to start it.
license: Apache-2.0
---

# Runner opt-in

An opted-in pull request's code runs on this laptop as this user, with this
user's SSH agent, Docker socket and tailnet. Nothing in this skill bounds what
that code can do while it runs. Opt in only to a pull request Michael or a
trusted lane authored, and only after reading the diff. The hardening plan's
non-admin runner user is what closes this; until it lands, the reading is the
gate.

## What this is

Hosted runners refuse to start when the account's billing is blocked, so every
pull-request job goes red before a step exists. The label `ci:optin` routes a
pull request's jobs to a runner registered on this machine for that pull
request alone. The runner is ephemeral: GitHub hands it one job and deregisters
it. The label carries the pull request number, so a job on another pull request
cannot match it. With no label and no runner, the workflows fall back to hosted
capacity and behave as they do today.

Three pieces have to agree, and all three live in the target repository:

| Piece | Where |
|---|---|
| The `runs-on` selector the verifier approves | `.github/scripts/verify_pr_runner_routing.py` |
| The pre-job gate | `deploy/roles/github_runner/files/trust-optin-job.sh` |
| Registration and teardown | `scripts/runner.sh optin` / `optout` |

Run the gestures from a trusted checkout of the repository's default branch,
never from a worktree of the pull request being opted in. `optin` copies the
gate out of that checkout and points the runner at the copy.

## Opt in

```
opt in <owner>/<repo> <N>
```

Before registering, read the pull request and refuse if anything below holds.

```bash
gh pr view <N> --repo <owner>/<repo> \
  --json number,title,author,headRefOid,isCrossRepository,state,changedFiles,additions,deletions
```

Refuse, and say which check failed:

- The author is not `fairchild` and not a trusted lane identity. `app/dependabot`
  is not trusted for this: its branches carry upstream code nobody has read.
- `isCrossRepository` is true. GitHub does not send fork pull requests to
  self-hosted runners, so the opt-in would hang rather than fail.
- `state` is not `OPEN`.
- Michael named a head SHA and `headRefOid` no longer matches it. The pull
  request moved since he read it, so his reading is stale. Show him both and
  ask for the new one.
- An opt-in is already live for this repository. Close it first.

Then, from the repository checkout:

```bash
gh pr edit <N> --repo <owner>/<repo> --add-label ci:optin
./scripts/runner.sh optin <owner>/<repo> <N>
```

Applying the label needs push access, which is what makes the gate
collaborator-only. `runner.sh optin` installs the gate, registers the runner,
writes the opt-in record at `~/.config/github-runner/optin/<owner>/<repo>` with
mode 600, and starts the listener.

Report back: the runner name, the labels, the record path, the gate path, and
the run to watch.

```bash
gh run list --repo <owner>/<repo> --branch "$(gh pr view <N> --repo <owner>/<repo> --json headRefName --jq .headRefName)" --limit 5
```

A labelled pull request re-runs on every push to it, so a new commit while the
runner is still up will take the laptop again. That is usually the intent. Say
it once at opt-in so it is never a surprise.

## Watch

```
watch
```

```bash
gh run watch <run-id> --repo <owner>/<repo>
./scripts/runners.sh <owner>/<repo>
```

The first follows the jobs. The second shows whether the opt-in runner is still
registered and whether it is busy; an ephemeral runner disappears from that
list once its job finishes, which is the signal that the window closed on its
own.

## Opt out

```
opt out <owner>/<repo> <N>
```

```bash
gh pr edit <N> --repo <owner>/<repo> --remove-label ci:optin
./scripts/runner.sh optout <owner>/<repo> <N>
```

The label goes first, so the window closes from GitHub's side before the runner
does and a push landing mid-teardown cannot queue a job against a runner that
is going away. `optout` stops the listener, deregisters the runner if it is
still registered, removes the local runner configuration, and deletes the
opt-in record. Report what was stopped and what was deleted.

Opt out when the run finishes, when the reading is stale, or when stepping
away from the laptop. An ephemeral runner that took its job is already gone;
`optout` is still worth running, because the record and the label outlive it.

## When it will not work

- The repository has no `ci:optin` selector in the workflow being run. Check
  `runs-on` against the verifier before blaming the runner.
- The GitHub App is not installed on the repository. Registration fails at the
  token step, not at the job.
- `~/.config/github-runner/config` is absent. `runner.sh` prints what it needs;
  do not read that file or the key it names.
- A hook file is missing from the checkout. `optin` refuses to register rather
  than register without a gate, which is the intended failure.
