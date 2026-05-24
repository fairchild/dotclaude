---
priority: 3
arc: backlog-pluggable-backends
---

# Backend: `github-issues`

## Problem

`maildir-git` and `maildir-shared` both store the queue as local files. Useful and inspectable, but bounded — they don't help when:

- Work needs to be visible to non-agent collaborators who don't `cd` into the repo.
- Multiple machines work the same backlog (Conductor on one laptop, CI on another).
- The team already lives in GitHub Issues and a parallel maildir is just duplication.

A third backend, `github-issues`, fills that gap. The verb surface stays the same; the storage changes.

## Goal

A `## Backend: github-issues` declaration that maps every verb to `gh` CLI invocations. Same `/backlog <subcommand>` surface, same dispatch table — but `add` calls `gh issue create`, `take` calls `gh issue edit --add-assignee`, etc. No local files except `backlog/AGENTS.md` and `backlog/ROADMAP.md`.

## Resolved decisions (carry from this session)

- Backend abstraction already lives in `scripts/backlog.sh` — reads `## Backend` from `backlog/AGENTS.md` and dispatches. Adding `github-issues` is "drop in `scripts/backlog-github-issues.sh`," no further plumbing.
- Verb semantics are documented in `references/worker.md` and are backend-neutral. This backend implements them; it doesn't get to redefine them.
- The slug stays the unit of work. For Issues, slug = a stable identifier (label like `slug:my-task` is the unambiguous match; title is the human-readable form).

## Open decisions

1. **Claim mechanism.** Likely `gh issue edit <n> --add-assignee @me` after a check that the issue has no assignee. The atomic-ness depends on GitHub's API not racing two assignment writes — needs verification. Fallback: an `in-flight` label with optimistic-write semantics.
2. **Worklog discipline.** Maildir keeps `progress` lines append-only under the divider. For Issues, the natural home is comments. Trade: comments don't grep cleanly from disk; upside: anyone watching the issue sees the trail.
3. **Pipeline mapping.** Default pipeline is `todo → doing → done`. For Issues: open + no assignee = todo; open + assigned = doing; closed = done. Intermediate states (e.g. `reviewing`) map to labels.
4. **ROADMAP coupling.** `arc:` frontmatter doesn't exist on issues. Likely a `roadmap:<arc>` label per task, plus the ROADMAP.md stays in the repo for the reflection layer.
5. **What happens to dotclaude's own backlog?** Probably nothing — we just landed maildir-shared, and the local-inspectable property is part of dotclaude's character. github-issues is for *other* projects.

## Phases

1. Verify GitHub assignment is atomic enough to be a claim (or build a label-based fallback). Test with two parallel `gh` calls.
2. Write `scripts/backlog-github-issues.sh` implementing the verb surface. Use `gh issue list/view/create/edit/comment/close`.
3. Add `setup --backend=github-issues` flow. Probably needs `gh auth status` check and writes `## Backend: github-issues` in AGENTS.md.
4. Update SKILL.md References to list the new backend.
5. Decide what `groom` looks like (stale assignments, label inconsistencies, closed-without-resolution).
6. Migration recipe from maildir-* → github-issues (read local tasks, post as issues, archive local files).

## Acceptance

- `scripts/backlog.sh add/take/advance/progress/cancel/fail/rescue/retry/status` all work against a project declaring `## Backend: github-issues`.
- `scripts/test.sh` gains end-to-end coverage using a throwaway repo with a mock `gh` (or a dedicated test repo on GitHub).
- A project can run `/backlog setup --backend=github-issues` and have the dispatch table just work afterwards.

## Out of scope

- Migrating away from GitHub if `gh` goes down or rate-limits.
- Cross-tracker federation (a slug in two trackers).
- Linear/Jira backends (same shape, separate task).

---
