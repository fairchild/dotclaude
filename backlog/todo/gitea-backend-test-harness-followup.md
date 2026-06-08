---
priority: 4
arc: backlog-pluggable-backends
---

# Followup: integration tests for the gitea backend

## Context

The gitea backend shipped alongside this task (`scripts/backlog-gitea.sh`, `references/backends/gitea.md`, dispatcher + SKILL wiring). `scripts/test.sh` covers the maildir backends end-to-end and `bash -n`-syntax-checks every bundled script (so the gitea script is syntax-covered), but doesn't exercise its behavior — `tea`/Gitea is harder to test hermetically.

A working **mock harness already exists** from the implementation session and validated the full verb cycle offline (26 assertions: setup, add, status bucketing, take, progress, advance→done, claim-conflict by branch, fail/retry, rescue timeout-refusal). It lived at `/tmp/gitea-backend-test/` — a Python mock of the subset of Gitea's REST API the backend calls (`tea api` only), plus a bash driver. This followup is mostly to port that into the repo as a committed `scripts/test-gitea.sh` + fixtures, then add the one thing the mock can't prove: the real-instance response shapes.

## Phases

1. Port the session mock into `scripts/test-gitea.sh`: a `tea` stub on `PATH` (ahead of the real binary) that simulates `tea api` GET/POST/PATCH/DELETE on `issues`, `issues/{n}`, `issues/{n}/comments`, `issues/{n}/labels`, and `labels`, backed by a JSON state file.
2. Cover the verb cycle + cancel/fail/rescue/retry branches and the claim-conflict path (two branches, second backs off non-zero with `won by branch=`).
3. Keep it separate from `scripts/test.sh` (gitea tests needn't run when only maildir code changed), same as the github-issues/jira followups.
4. Document the test surface in `references/backends/gitea.md`.

## Acceptance

- `bash scripts/test-gitea.sh` runs offline, passes, no Gitea side effects.
- Claim-conflict path covered.
- Note in the backend reference doc on what the tests do and don't cover.

## Out of scope

- The **live-instance smoke** (a real throwaway Gitea repo + a `tea` login) — worth doing manually before relying on the backend, since it's the only thing that confirms Gitea's exact label-color format, label-by-id add/remove on 1.26, and `tea api` auth resolution. Track separately from the automated mock tests.
- Cross-backend tests (one harness running the verb suite against all backends) — premature; the verb surface is stable.

---
