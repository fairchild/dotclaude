---
priority: 4
arc: backlog-pluggable-backends
---

# Followup: test harness for the Jira backend

PR #194 added the Jira backend (`skills/backlog/scripts/backlog-jira.sh`, dispatcher wiring, and `references/backends/jira.md`). The current repo coverage syntax-checks the script and documents a disposable-project smoke test, but it does not exercise the verb surface against either a mocked `acli` or a side-effect-safe live project.

This is the Jira counterpart to `github-issues-test-harness-followup`: remote backends are useful only if they can be hardened without needing a real tracker mutation every time.

## Proposed slice

1. Add a deterministic `scripts/test-jira.sh` or equivalent fixture harness that places a mock `acli` earlier on `PATH`.
2. Cover at least setup config parsing, add, take claim resolution, progress, advance to done, fail, retry, and status bucket parsing.
3. Keep the tests offline by default, with recorded JSON shapes that match current Atlassian CLI output.
4. Leave the live disposable-project smoke test in `references/backends/jira.md`, but make clear it is manual and not the CI path.
5. Wire the harness into `skills/backlog/scripts/test.sh` only if it stays fast and hermetic; otherwise document it as a focused remote-backend test.

## Acceptance

- `bash skills/backlog/scripts/test-jira.sh` passes without `acli`, Jira auth, or network.
- The mock verifies the expected `acli jira workitem ...` calls for each covered verb.
- Jira JSON shape assumptions are represented by fixtures, not just prose.
- `references/backends/jira.md` points to the harness and keeps the live smoke test clearly optional.

---
