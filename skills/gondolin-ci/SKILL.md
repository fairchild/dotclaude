---
name: gondolin-ci
description: Run one GitHub Actions suite for a pull request inside a disposable gondolin micro-VM on a Mac, and watch the steps land. User-invoked only — the user asks for it by name ("run CI on my laptop", "gondolin ci"); never start a run because a pull request looks red.
license: Apache-2.0
disable-model-invocation: true
metadata:
  status: experimental
  experimental_reason: "It has run real suites for one repository on one laptop. Run time still tracks the laptop's load, and tokens reach the guest and the host side is unconfined until the design's Phases 2 and 3 land."
---

# Gondolin CI

One pull request, one CI suite, one micro-VM created for that job and destroyed when it ends. The
job runs the repository's own opt-in workflow from its default branch, so nothing here is a private
fork of the CI.

Use it when hosted Actions are unavailable, or when a suite should run somewhere the pull request's
code cannot read the laptop.

**Read the pull request first.** The VM contains accidents and casual malice. It is not yet safe
against code actively trying to escape, so the lane runs private repositories only, and refuses
pull requests from forks. [references/design.md](references/design.md) has the threat model and the
open gaps.

Paths below are relative to this skill's base directory. The repository is `$GONDOLIN_CI_REPO`, or
the one the current directory is a checkout of.

## First run

It needs macOS on Apple silicon, `node` 24 or newer, `gh`, `jq`, and `qemu`. Building the guest also
needs Docker, Homebrew's `e2fsprogs` and `lz4`, and about 20 GB free for five to seven minutes. The
repository has to be private, and needs the opt-in workflow on its default branch: copy
[assets/pr-optin-run.yml](assets/pr-optin-run.yml) to `.github/workflows/` and replace its example
step with the repository's own check.

```sh
bash scripts/gondolin-ci.sh check   # what is still missing
bash scripts/gondolin-ci.sh setup   # install the lane's dependencies, build the guest
```

The `gh` login needs admin on the repository, to list and register runners.
[references/setup.md](references/setup.md) covers the workflow contract, an optional GitHub App for
minting, and every setting.

## Before a run

The VM borrows the user's laptop, and a busy host makes the run slow and its timeouts meaningless.
Check, in this order:

- **Idle CPU** — `top -l 2 -n 0 | grep "CPU usage" | tail -1`. Below about 40% idle, wait.
- **The slot** — `node lane/lib/slot.mjs who` names the holder. One VM at a time: a run waits for
  the slot, because two VMs make each other's tests fail on timeouts that say nothing about the
  code.
- **Free disk** — a run needs a few GB for the copy-on-write disk.

## Running it

```sh
bash scripts/gondolin-ci.sh                       # what can run, newest first, and the suites
bash scripts/gondolin-ci.sh run 1842              # the workflow's first suite, at today's head
bash scripts/gondolin-ci.sh run 1842 test 3f2a…   # the commit you read; a later push refuses
```

Run it in a terminal, not through a tool call: the point is the live output. Steps print as the
runner reports them, then a summary, the egress the job asked for, the tail of whatever failed, and
the next few pull requests to choose from.

To watch from a second terminal, capture the run through a pty. Plain redirection leaves macOS's
`script` buffering, and without a pty the step ticker loses its colours:

```sh
script -t 0 /tmp/gondolin-live.log bash scripts/gondolin-ci.sh run 1842 lint
# elsewhere:  tail -f /tmp/gondolin-live.log
```

`gh run watch <run-id>` is the other live view: GitHub's own, showing the same steps from the
server's side. The run id prints as soon as the workflow is dispatched.

If the pull request's branch is behind the default branch, the run says so before it boots anything
and prints the one API call that fixes it. Heed that: the workflow checks out the branch's own
commit, never a merge, so a stale branch runs its own stale copy of every CI contract and fails for
reasons unrelated to the change.

Suites are the jobs the workflow defines, and the list prints them. A just-in-time runner takes
exactly one job, so one invocation runs one suite. A job that needs macOS cannot run in the Linux
guest. The lane stops following a run after an hour, so keep `timeout-minutes` below that.

The VM gives way to the user. It runs in macOS's background band until the laptop has been left
alone for two minutes with little else running, and goes back the moment that changes. A job that
mostly yielded can fail on a timeout set for hosted speed, so set `GONDOLIN_PRIORITY=normal` for a
run someone is waiting on.

## How it works

`scripts/gondolin-ci.sh` is a front end. It lists non-draft branches of the repository newest first
and hands off to `lane/run-optin.sh`, which does the real work:

1. **Mint.** `mint-jit.sh` asks GitHub for a single-use runner configuration carrying the labels
   the workflow selects on: `self-hosted,optin,pr-<N>`. The credential that mints it never leaves
   the host.
2. **Boot.** `run-job.mjs` starts one gondolin micro-VM, writes the configuration into the guest,
   deletes it, and starts the runner as an unprivileged user under a `tini` subreaper. The VM sees
   no host filesystem, and its only route out is HTTP to an allowlist of the Actions hosts plus the
   few the toolchain needs. Everything else is refused and logged.
3. **Dispatch.** Once GitHub itself reports the runner online, the workflow is dispatched at that
   pull request and commit. The definition that executes is the default branch's; only the pull
   request's tree is checked out.
4. **Watch.** The steps come from the runner's own log inside the guest, as they happen. The verdict
   comes from GitHub, because the code under test can write to that log.
5. **Discard.** The runner exits on its own after one job, the copy-on-write disk goes away with
   the VM, and the registration deregisters itself.

Each run leaves its runner log, steps and egress report under
`~/.local/state/gondolin-runner/runs/`.

## When a run dies mid-flight

`Ctrl-C` cleans up after itself. Killing the terminal outright leaves the VM and the GitHub-side
registration behind:

```sh
pkill -f run-optin.sh; pkill -f run-job.mjs; pkill -f 'qemu-system-aarch64.*gondolin'
gh api repos/<owner>/<name>/actions/runners --jq '.runners[] | select(.name|startswith("gondolin")) | .id'
gh api -X DELETE repos/<owner>/<name>/actions/runners/<id>
rm -f ~/.local/state/gondolin-runner/runs/.jit-*
```

A registration GitHub still believes is running a job refuses to delete until that job times out.

## Checking the lane itself

```sh
cd lane && node --test lib/*.test.mjs *.test.mjs   # policy, sanitiser, steps, run-matching
node probe-containment.mjs                         # the containment claims, from inside a VM
```

Read the Invariants in [references/design.md](references/design.md) before changing anything in
`lane/`: they list the changes that look reasonable and are not.
