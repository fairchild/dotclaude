---
name: self-hosted
description: Run a pull request's CI on this machine instead of GitHub-hosted runners. Use when the user says "do self hosted", "run self-hosted", "self-hosted CI on PR N" or "run CI locally for this PR". Only on the user's request; never because a PR looks red.
metadata:
  status: experimental
  experimental_reason: "Written 2026-11-08 for lede-design while hosted Actions billing is blocked; no run has gone through it yet."
---

# Self-hosted CI

The user's request names a pull request, or means the one this session is working on. Resolve it to a number and its
head SHA (`gh pr view <N> --json number,headRefOid`) before anything runs. The run tests that commit only.

## Run it in the background

Hand the run to one background subagent, or one `run_in_background` Bash command, so this session keeps working. Brief
it with the repo, the PR number, the head SHA and the method below. It reports the verdict, the run URL or record, and
the time taken, in 100 words or fewer.

One run on this machine at a time, and at most two heavy processes overall: check `sysctl -n vm.loadavg` and wait
if another run or VM is up (`node ~/.claude/skills/gondolin-ci/lane/lib/slot.mjs who`).

## Method, first that exists

1. **The repo's own contract.** If the repo has `docs/self-hosted-ci.md`, follow it. A script it names, such as
   `scripts/attest.sh`, wins over the steps by hand.
2. **The gondolin lane**, for a repo with `.github/workflows/self-hosted-ci.yml` (or `pr-optin-run.yml`) on its
   default branch:

   ```sh
   GONDOLIN_PRIORITY=normal GONDOLIN_CI_WORKFLOW=self-hosted-ci.yml \
     bash ~/.claude/skills/gondolin-ci/scripts/gondolin-ci.sh run <PR> <suite> <sha>
   ```

   `bash ~/.claude/skills/gondolin-ci/scripts/gondolin-ci.sh check` says what setup is missing. The gondolin-ci skill
   has the details; reading it is fine, since the user asked for this run.
3. **Neither exists.** Say so and offer to add the repo's contract. Don't improvise a runner.

## Reporting

A self-hosted run attaches no checks to the PR. Report it as self-hosted, with the run URL or signed record, and say
which suites ran and which didn't. A merge on it names those URLs in the squash body.
