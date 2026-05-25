---
priority: 4
arc: backlog-pluggable-backends
dependencies:
  github-issues-backend-plan: "implementation must exist before it can be tested"
---

# Followup: integration tests for the github-issues backend

## Context

The github-issues backend shipped in PR #178 (`scripts/backlog-github-issues.sh`, `references/backends/github-issues.md`, dispatcher wiring). `scripts/test.sh` covers the maildir backends end-to-end against throwaway git repos, but doesn't touch github-issues — `gh` is harder to test in a hermetic loop.

Two viable paths:

1. **Mock-gh harness.** A test helper that intercepts `gh` calls via a function definition on `PATH` ahead of the real `gh`, records every invocation, and returns canned responses. Tests run offline, deterministic, no GitHub side effects. Cost: maintaining canned responses as the script evolves.

2. **Live test repo.** A dedicated throwaway repo on GitHub the harness creates/teardowns per run. Real `gh` calls, real race semantics for the optimistic-claim check. Cost: requires `gh` auth with create-repo scope, network dependency, slower, leaves audit-log noise on the auth user.

The mock harness is the better starting point — covers most verb-shape regressions cheaply. The live-repo test (or specifically: a manual two-shell race test) is the load-bearing one for the claim-conflict path that's the actual semantic risk.

## Phases

1. Add a `mock_gh()` shell function to a new `scripts/test-github-issues.sh` that records calls and returns canned JSON from a fixture dir.
2. Cover the verb cycle: setup → add → take → progress → advance → status, plus the cancel/fail/rescue/retry branches.
3. Add a claim-conflict test: simulate two `take` calls where the second's re-read shows two assignees; assert the second backs off with non-zero exit and the right error message.
4. Either wire into `scripts/test.sh` or keep separate (separate is probably cleaner — github-issues tests don't need to run when only maildir code changed).
5. Document the test surface in `references/backends/github-issues.md`.

## Acceptance

- `bash scripts/test-github-issues.sh` runs offline, passes, no GitHub side effects.
- Claim-conflict path covered.
- Note in the backend reference doc explaining what the tests do and don't cover.

## Out of scope

- A real-repo integration test against GitHub. Worth doing manually before each release; not worth automating yet.
- Cross-backend tests (running the same verb suite against all three backends from one harness). Tempting but premature — the verb surface is stable, mismatches would show up as backend bugs not test-harness bugs.

---
