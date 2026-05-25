# Backend: github-issues

Storage mechanism for projects whose `backlog/AGENTS.md` declares `## Backend: github-issues`. Built for projects whose work is already visible in GitHub Issues — cross-machine, multi-collaborator (human and agent), and where a parallel maildir would just duplicate the queue.

Verb semantics: `../worker.md`. Implementation: `../../scripts/backlog-github-issues.sh`. This doc describes the mechanism — for bash, read the script.

## When to pick this backend

- The team already lives in GitHub Issues; a maildir would be a parallel ledger no one updates.
- Multi-machine work (Conductor on one laptop, CI on another, contributor on a third) needs to see the same in-flight set.
- Non-agent collaborators who don't `cd` into the repo need visibility into what's claimed and what's open.

For local-only single-machine work, `maildir-git` is simpler; for multi-worktree on one machine, `maildir-shared` keeps everything inspectable in place.

## Mental model

GitHub Issues *is* the queue — the repo's open issues are the backlog, holistically. There is no separation between "backlog tasks" and "other issues" and no marker label gating membership; any open issue is takeable. Non-conformant issues (random feature requests, dormant bug reports) get triaged when a worker encounters them — `cancel` if they shouldn't move forward, `fail` with a `needs replanning:` reason if the spec is missing.

There is no local `todo/`/`doing/`/`done/` tree; the local repo holds only the convention declaration (`backlog/AGENTS.md`) and the roadmap (`backlog/ROADMAP.md`).

State derives from GitHub-native signals where it can, and falls back to labels only where the platform can't encode the distinction:

| State    | open/closed | labels         |
|----------|-------------|----------------|
| todo     | open        | no `doing`     |
| doing    | open        | `doing`        |
| done     | closed      | no `failed`    |
| failed   | closed      | `failed`       |

`cancel` and ordinary `done` both close the issue — discriminated by the worklog comment and by GitHub's close reason (`completed` vs `not planned`). The `status` verb lumps them under `done`, matching the maildir backends.

Tasks are referenced by **issue number** — `bash backlog.sh take 42` or `bash backlog.sh take #42` (both work). Titles are free text; the operator/agent reads them out of `gh issue list` to know which number to grab. There are no slug labels and no parallel identifier scheme — GitHub's native identifier does the whole job. The worklog (lines below the divider in a maildir file) becomes a chronological sequence of issue comments in the same `- <ts> <verb> ...` format, so `gh issue view --json comments` reconstructs what `tail backlog/done/<slug>.md` would show in a maildir backend.

## Labels the verbs depend on

| Label    | Created when | Role                                |
|----------|--------------|-------------------------------------|
| `doing`  | `setup`      | claimed and in flight               |
| `failed` | `setup`      | dead-lettered; cleared on `retry`   |

Two labels — both bare, both static. Collisions with existing project labels are possible but rare; if your project already uses one of those names, rename the existing label before `setup` or fork the script with different names.

What's deliberately not a label:

- **`backlog` marker.** Not needed — every open issue is a backlog candidate. Adding a marker would just gate which issues are "ours," which is the structure this design rejects.
- **`slug:<slug>`.** Issue numbers are GitHub's native identifier; a parallel slug scheme adds a label per task and a lookup layer without solving a problem GitHub doesn't already solve.
- **`category`.** Optional spec metadata; if you want to record it, write it in the issue body's frontmatter alongside `priority`/`timeout`. The skill doesn't read it.
- **`priority`, `roadmap`/`arc`.** Read from body frontmatter (same shape as the maildir backends). Operators are free to mirror them as `priority:<n>` / `roadmap:<arc>` labels for GitHub-side filtering, but the script doesn't query labels for them.

## How each verb interacts with `gh`

| Verb | gh calls |
|---|---|
| `setup` | `gh repo view`, `gh label create --force` ×2 (`doing`, `failed`), then writes AGENTS.md + ROADMAP skeleton + commits |
| `add` | `gh issue create --title "<title>"` (stub body with divider) — returns the new issue URL |
| `take` | `gh issue list` (jq-filter open issues with no `doing` label, rank by body priority + recency) or `validate_id` on the explicit number → post claim comment → `gh issue edit --add-label doing` → re-read comments; if earliest `advanced to=doing` since last `retried` has a different `branch=`, exit with `claim conflict on #N: won by branch=X` |
| `advance` | reads state + labels; for todo→doing, calls `take`; for doing→done, post comment + `gh issue edit --remove-label doing` + `gh issue close --reason completed` |
| `progress` | finds claim via `gh issue list --label doing` then comment-scan for matching `branch=$(git branch --show-current)`; `gh issue comment` |
| `cancel` | post comment + `gh issue edit --remove-label doing` + `gh issue close --reason "not planned"` |
| `fail` | post comment + `gh issue edit --remove-label doing --add-label failed` + `gh issue close --reason "not planned"` |
| `rescue` | reads comments for last claim line, checks timeout, posts `rescued` comment, ensures `doing` label |
| `retry` | refuses unless `failed` is present, then `gh issue edit --remove-label failed` + `gh issue reopen` + comment |
| `status` | one `gh issue list --state all`; jq buckets every issue by state + `doing`/`failed` labels |

## The load-bearing bit: branch-based claim discrimination

Two reasons assignee can't carry the claim signal:

1. **Shared agent identity.** Many agents share a single GitHub PAT (one bot account, many workers). `--assignee @me` reduces to "this account is involved," not "this specific worker claimed it."
2. **Non-atomic assignment.** GitHub's assignee API isn't compare-and-set, so even with unique identities two writers can briefly co-assign.

Both problems go away if we use **branch as the claim identity**, with comment ordering as the timestamp. Each worker normally has its own branch (Conductor workspace, cmux workspace, or any feature branch); the claim comment records `branch=<X>`; comments on GitHub are timestamped and append-only.

The resolution rule, walking the worklog comments in chronological order:

| Comment kind          | Effect on the current winner                                                      |
|-----------------------|-----------------------------------------------------------------------------------|
| `retried`             | reset — no current winner (contest restarts when an item comes back from `failed/`) |
| `advanced to=doing`   | first-wins — sets the winner only if currently empty (catches `take`-time races)  |
| `rescued`             | override — replaces the current winner (rescue is a deliberate takeover after timeout) |

`take` posts an `advanced to=doing` comment, adds the `doing` label, then re-reads; if it isn't the earliest claim since the last `retried`, it lost and exits non-zero. `rescue` posts a `rescued` comment then re-reads with the same verify-or-exit dance — two simultaneous rescuers don't both think they won.

```bash
take(id):
  post "- ts advanced to=doing claimer=ME branch=$(git branch --show-current)"
  gh issue edit --add-label doing
  if claim_winner_branch(id) != my branch:
    error "claim conflict on #N: won by branch=$winner"
```

Race window: two workers can both post claim comments before either re-reads. Both then re-read, see the same chronological comment trail, agree on the winner; the loser exits non-zero. No livelock — one worker wins on the first attempt because the GitHub API orders the comments.

When the rare double-post happens, the losing comment stays in the issue's history. That's truthful (the attempt happened) and harmless (subsequent reads still resolve to the same winner).

## Worklog reconstruction

A task's full history is `gh issue view <n> --json comments -q '.comments[].body'`. Each comment is one log line in the same format as the maildir backends:

```
- 2026-05-24T17:49:00Z advanced to=doing claimer=conductor:austin-v3 branch=feat/foo
- 2026-05-24T18:03:00Z progress | first cut wired, prepping mock-gh test
- 2026-05-25T09:11:00Z advanced to=done | PR=https://github.com/.../pull/178
```

The reconstruction is fast enough for `rescue`'s timeout check, `current_claim`'s branch-match lookup, and grooming queries. For deeper history work, `gh api repos/<owner>/<repo>/issues/<n>/timeline` exposes the full event timeline including state changes and label events — useful when comment history isn't enough.

## Maintain additions

The buckets in `../maintain.md` translate as:

| Bucket                       | github-issues check |
|------------------------------|---------------------|
| `ADVANCED BUT NOT MOVED`     | n/a — there is no separate "move" step; close happens atomically with the log comment |
| `TIMED OUT`                  | `gh issue list --label doing` then check the most recent claim comment's timestamp against the body's `timeout:` |
| `STALE TODO`                 | `gh issue list --state open` jq-filtered for no `doing` label and `updatedAt` older than threshold |
| `ORPHANED CLAIM`             | a `doing`-labeled issue whose `branch=` from the last claim comment no longer exists on any remote — claimer abandoned the worktree |

The script's `maintain` verb prints the advisory message — these queries are agent-judgment territory, not a fixed script.

## What this backend deliberately doesn't do

- **Custom pipelines.** `todo → doing → done` is hardcoded; intermediate stages like `reviewing/` aren't supported in v1. If you need them, declare an extra label per stage and customize the script.
- **Cross-tracker federation.** A slug exists in exactly one tracker. Mixing maildir-* and github-issues for the same project is out of scope.
- **Custom title formats.** `add` sets title to the bare slug; the human re-titles via `gh issue edit` or the web UI. Title format isn't load-bearing — the `slug:<slug>` label is.
- **Assignee as claim signal.** Assignment is supplementary at most (the script doesn't set it); the branch-via-comments pattern is the source of truth. Operators are free to assign issues manually for UX without affecting backlog state.
- **Cross-machine guarantees beyond GitHub's.** If `gh` is unavailable (auth expired, rate-limited, outage) the verbs fail loudly. There's no local cache or queued retry.

## Migration (sketch — not yet implemented)

From maildir-* to github-issues:

1. For each file in `backlog/todo/`, `gh issue create` with title=slug-as-title, body=spec. Capture the new issue number; old maildir slug → new issue number is the migration map for any cross-references.
2. For each file in `backlog/doing/`, do (1) then `cmd_take <slug>`.
3. For each file in `backlog/done/`, do (1) then advance to closed; replay the worklog lines as comments.
4. Replace `backlog/AGENTS.md`'s backend declaration; delete local task tree.

The replay step is the load-bearing one — timestamps and claimer/branch metadata in the worklog need to survive. Practical approach: keep the old maildir tree archived under `.backlog-archive/` rather than deleting, so the history stays browseable locally.

## Test coverage (followup)

`scripts/test.sh` exercises the maildir backends end-to-end against throwaway git repos. The github-issues backend is harder to integration-test — either a real test repo on GitHub (network, auth, side effects) or a mock `gh` that records calls and returns canned responses. Tracked in `backlog/todo/github-issues-test-harness-followup.md`.
