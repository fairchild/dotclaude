---
name: gondolin-ci
description: Run one of services' CI suites for a pull request inside a disposable gondolin VM on this laptop, and watch the steps land. User-invoked only — Michael asks for it by name ("run CI on my laptop", "gondolin ci"); never start a run because a pull request looks red.
disable-model-invocation: true
metadata:
  portability: machine-bound
  status: experimental
  experimental_reason: "All four Linux suites have run green in the lane (services, 2026-09-30 to 10-03), but run time still tracks the laptop's load, and the watcher, the one-VM slot and the laptop-priority governor are in review (services #1960, #1993, #2029)."
---

# Gondolin CI

One pull request, one CI suite, one micro-VM created for that job and destroyed when it ends. The
job runs services' own `pr-optin-run.yml`, the workflow already on `main`, so nothing here is a
private fork of the CI.

Use it when hosted Actions are unavailable, or when a suite should run somewhere the pull
request's code cannot read the laptop.

The skill is bound to this machine: it drives the lane in a local services checkout
(`~/code/services/scripts/gondolin`) and the runner GitHub App credentials configured there.
Paths below are relative to this skill's base directory.

## Before a run

The VM borrows Michael's laptop, and a busy host makes the run slow and its timeouts
meaningless. Check, in this order:

- **Idle CPU** — `top -l 2 -n 0 | grep "CPU usage" | tail -1`. Below about 40% idle, wait. The
  load average is misleading on this laptop: it sits near 7 even when idle.
- **No other VM** — `pgrep -fl qemu-system`. One VM at a time. Two make each other's tests fail
  on timeouts that say nothing about the code.
- **Free disk** — a run needs a few GB for the copy-on-write disk. A guest image rebuild needs
  about 20 GB until services #1968 lands, then about 10.

## Running it

```sh
bash scripts/gondolin-ci.sh                 # what can run, newest first
bash scripts/gondolin-ci.sh run             # the newest, lint suite
bash scripts/gondolin-ci.sh run 1842 files
```

Run it in a terminal, not through a tool call: the point is the live output. Steps print as GitHub
reports them, then a summary, the egress the job asked for, the tail of whatever failed, and the
next few pull requests to choose from.

To watch from a second terminal, capture the run through a pty. Plain redirection leaves macOS's
`script` buffering, and without a pty the step ticker loses its colours:

```sh
script -t 0 /tmp/gondolin-live.log bash scripts/gondolin-ci.sh run 1842 lint
# elsewhere:  tail -f /tmp/gondolin-live.log
```

`gh run watch <run-id>` is the other live view: GitHub's own, showing the same steps from the
server's side. The run id prints as soon as the workflow is dispatched.

If the pull request's branch is behind `main`, the run says so before it boots anything and prints
the one API call that fixes it. Heed that: the workflow checks out the branch's own commit, never a
merge with main, so a stale branch runs its own stale copy of every CI contract and fails for
reasons unrelated to the change.

Suites are the ones `pr-optin-run.yml` defines: `lint`, `python`, `files`, `draw`. `authkit` needs
macOS and cannot run in a Linux guest. A just-in-time runner takes exactly one job, so one
invocation runs one suite.

The lane's VM size defaults are chosen for the laptop; leave them unless the laptop is idle and a
suite needs more. `GONDOLIN_TRACE=1` dumps the guest's processes and sockets every 20 s.

## How it works

`scripts/gondolin-ci.sh` is a front end. It lists non-draft pull requests newest first, resolves
the default, and hands off to the lane's `run-optin.sh`, which does the real work:

1. **Mint.** `mint-jit.sh` asks GitHub for a single-use runner configuration through the runner
   GitHub App, carrying the labels `pr-optin-run.yml` selects on: `self-hosted,optin,pr-<N>`. The
   App's private key never leaves the host.
2. **Boot.** `run-job.mjs` starts one gondolin micro-VM, writes the configuration into the guest,
   deletes it, and starts the runner as an unprivileged user under a `tini` subreaper. The VM sees
   no host filesystem, and its only route out is HTTP to an allowlist of the Actions hosts plus the
   few the toolchain needs. Everything else is refused and logged.
3. **Dispatch.** Once GitHub itself reports the runner online, the workflow is dispatched at that
   pull request and commit. The definition that executes is `main`'s; only the pull request's tree
   is checked out.
4. **Watch.** The runner console only announces that a job started, so the step ticker comes from
   polling GitHub. Each step prints with its conclusion and duration as it settles.
5. **Discard.** The runner exits on its own after one job, the copy-on-write disk goes away with
   the VM, and the registration deregisters itself.

## When a run dies mid-flight

Killing the terminal leaves the VM and the GitHub-side registration behind:

```sh
pkill -f run-optin.sh; pkill -f run-job.mjs; pkill -f 'qemu-system-aarch64.*gondolin'
gh api repos/fairchild/services/actions/runners --jq '.runners[] | select(.name|startswith("gondolin")) | .id'
gh api -X DELETE repos/fairchild/services/actions/runners/<id>
rm -f ~/code/services/scripts/gondolin/.jit-*
```

A registration GitHub still believes is running a job refuses to delete until that job times out.

## Where the rest lives

- `docs/gondolin-runner.md` in services: the design (containment, the egress policy, the guest
  environment contract) and its Invariants, the changes that look reasonable and are not.
- `scripts/gondolin/README.md` in services: operating the lane. Run `npm ci` there once per
  checkout, and `build-image.sh` after any image change.
- services issue #1932: the plan. Its newest `handoff` comment has the lane's open pull requests,
  their merge order and the next actions.
- `GONDOLIN_RUNNER_DIR` points the front end at another checkout of the lane, for example a
  worktree.
