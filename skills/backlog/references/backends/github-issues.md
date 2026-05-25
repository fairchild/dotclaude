# Backend: github-issues

Storage mechanism for projects whose `backlog/AGENTS.md` declares `## Backend: github-issues`. Built for projects whose work is already visible in GitHub Issues — cross-machine, multi-collaborator (human and agent), and where a parallel maildir would just duplicate the queue.

Verb semantics: `../worker.md`. Implementation: `../../scripts/backlog-github-issues.sh`. This doc describes the mechanism — for bash, read the script.

## When to pick this backend

- The team already lives in GitHub Issues; a maildir would be a parallel ledger no one updates.
- Multi-machine work (Conductor on one laptop, CI on another, contributor on a third) needs to see the same in-flight set.
- Non-agent collaborators who don't `cd` into the repo need visibility into what's claimed and what's open.

For local-only single-machine work, `maildir-git` is simpler; for multi-worktree on one machine, `maildir-shared` keeps everything inspectable in place.

## Mental model

GitHub Issues *is* the queue. There is no local `todo/`/`doing/`/`done/` tree — issue state plus a small set of labels are the storage. The local repo holds only the convention declaration (`backlog/AGENTS.md`) and the roadmap (`backlog/ROADMAP.md`).

The mapping is direct:

| Maildir state | GitHub state                                          |
|---------------|-------------------------------------------------------|
| `todo/`       | open, unassigned, label `backlog`                     |
| `doing/`      | open, assigned, labels `backlog` + `backlog:in-flight`|
| `done/`       | closed                                                |
| `failed/`     | closed, label `backlog:failed`                        |
| (cancelled)   | closed, label `backlog:cancelled`                     |

The slug is canonical via a `slug:<slug>` label — the issue title is human-readable and editable without losing the slug binding. The worklog (the lines below the divider in a maildir file) becomes a chronological sequence of issue comments in the same `- <ts> <verb> ...` format, so `gh issue view --comments` reconstructs what `tail backlog/done/<slug>.md` would show.

## Labels the verbs depend on

Created at `setup` time:

| Label                | Role                                            |
|----------------------|-------------------------------------------------|
| `backlog`            | marks an issue as part of the backlog (filters list) |
| `backlog:in-flight`  | set on `take`/`advance`-to-doing, removed on close   |
| `backlog:cancelled`  | set on `cancel`                                      |
| `backlog:failed`     | set on `fail`, cleared on `retry`                    |

Created at `add` time, one per task:

| Label                | Role                                            |
|----------------------|-------------------------------------------------|
| `slug:<slug>`        | canonical slug → issue lookup                   |
| `category:<cat>`     | the `add`-time category (plan/followup/etc)     |

Optional, author-set:

| Label                | Role                                            |
|----------------------|-------------------------------------------------|
| `roadmap:<arc>`      | arc linkage to `backlog/ROADMAP.md`             |
| `priority:<n>`       | priority hint (also readable from body frontmatter) |

## How each verb interacts with `gh`

| Verb | gh calls |
|---|---|
| `setup` | `gh repo view`, `gh label create --force` (×4 static labels), then writes AGENTS.md + ROADMAP skeleton + commits |
| `add` | `gh label create slug:<slug>` + `gh label create category:<cat>` + `gh issue create` (stub body with divider) |
| `take` | `gh issue list` (rank or lookup) → `gh issue edit --add-assignee @me --add-label backlog:in-flight` → re-read `--json assignees`; if not sole assignee, `gh issue edit --remove-assignee` + `--remove-label` and exit; otherwise `gh issue comment` with the `advanced to=doing` line |
| `advance` | reads state; for todo→doing, calls `take`; for doing→done, post comment + `gh issue edit --remove-label backlog:in-flight` + `gh issue close --reason completed` |
| `progress` | finds claim via `gh issue list --assignee @me --label backlog:in-flight`, then `gh issue comment` |
| `cancel` | comment + `gh issue edit --add-label backlog:cancelled --remove-label backlog:in-flight` + `gh issue close --reason "not planned"` |
| `fail` | same as cancel with `backlog:failed` |
| `rescue` | reads comments for last claim line, checks timeout, reassigns to `@me`, comment with `rescued` line |
| `retry` | refuses unless `backlog:failed` is present, then `gh issue edit --remove-label backlog:failed` + `gh issue reopen` + comment |
| `status` | counts via `gh issue list` per state |

## The load-bearing bit: optimistic claim

GitHub's assignee API isn't compare-and-set — there's no header-level "if-no-other-assignees, set assignee" primitive. The script claims optimistically and verifies:

```bash
gh issue edit "$n" --add-assignee "@me" --add-label "backlog:in-flight" >/dev/null
assignees=$(gh issue view "$n" --json assignees -q '[.assignees[].login] | join(",")')
if [[ "$assignees" != "$(me)" ]]; then
  gh issue edit "$n" --remove-assignee "$(me)" --remove-label "backlog:in-flight" >/dev/null 2>&1 || true
  echo "claim conflict on #${n}: assignees=${assignees}" >&2; exit 1
fi
```

The race window is the gap between the `--add-assignee` request and the verifying `--json assignees` read. Two workers can both succeed at the add step; both then re-read, both see two assignees, both back off. That's a livelock for one cycle — the operator (or worker loop) retries and one wins on the next attempt. In practice this is rare enough to live with; the alternative (a hand-rolled lock via a separate `backlog:claiming:<who>` label or via creating a unique comment first) adds complexity without removing the race entirely.

When the rare double-claim happens, both workers exit non-zero with `claim conflict on #N: assignees=A,B` — distinct from a clean "no available tasks" — so the worker loop can distinguish race from emptiness.

## Worklog reconstruction

A task's full history is `gh issue view <n> --json comments -q '.comments[].body'`. Each comment is one log line in the same format as the maildir backends:

```
- 2026-05-24T17:49:00Z advanced to=doing claimer=conductor:austin-v3 branch=feat/foo
- 2026-05-24T18:03:00Z progress | first cut wired, prepping mock-gh test
- 2026-05-25T09:11:00Z advanced to=done | PR=https://github.com/.../pull/178
```

The reconstruction is fast enough for `rescue`'s timeout check and for grooming queries. For deeper history work, `gh api repos/<owner>/<repo>/issues/<n>/timeline` exposes the full event timeline including state changes and assignments — useful when comment history isn't enough.

## Maintain additions

The buckets in `../maintain.md` translate as:

| Bucket                       | github-issues check |
|------------------------------|---------------------|
| `ADVANCED BUT NOT MOVED`     | n/a — there is no separate "move" step; close happens atomically with the log comment |
| `TIMED OUT`                  | `gh issue list --state open --label backlog:in-flight` then check the last claim comment's timestamp against the body's `timeout:` |
| `STALE TODO`                 | `gh issue list --state open --search "no:assignee" --label backlog --search "updated:<<date>"` |
| `ORPHANED IN-FLIGHT`         | a `backlog:in-flight` issue whose assignee no longer exists (account deleted) or whose claim branch was deleted — find via timeline reconstruction or by inspecting the most recent `claimer=` / `branch=` line |

The script's `maintain` verb prints the advisory message — these queries are agent-judgment territory, not a fixed script.

## What this backend deliberately doesn't do

- **Custom pipelines.** `todo → doing → done` is hardcoded; intermediate stages like `reviewing/` aren't supported in v1. If you need them, declare an extra label per stage and customize the script.
- **Cross-tracker federation.** A slug exists in exactly one tracker. Mixing maildir-* and github-issues for the same project is out of scope.
- **Custom title formats.** `add` sets title to the bare slug; the human re-titles via `gh issue edit` or the web UI. Title format isn't load-bearing — the `slug:<slug>` label is.
- **Cross-machine guarantees beyond GitHub's.** If `gh` is unavailable (auth expired, rate-limited, outage) the verbs fail loudly. There's no local cache or queued retry.

## Migration (sketch — not yet implemented)

From maildir-* to github-issues:

1. For each file in `backlog/todo/`, `gh issue create` with title=slug, body=spec, label=`backlog` + `slug:<slug>` + `category:<cat>`.
2. For each file in `backlog/doing/`, do (1) then `cmd_take <slug>`.
3. For each file in `backlog/done/`, do (1) then advance to closed; replay the worklog lines as comments.
4. Replace `backlog/AGENTS.md`'s backend declaration; delete local task tree.

The replay step is the load-bearing one — timestamps and claimer/branch metadata in the worklog need to survive. Practical approach: keep the old maildir tree archived under `.backlog-archive/` rather than deleting, so the history stays browseable locally.

## Test coverage (followup)

`scripts/test.sh` exercises the maildir backends end-to-end against temp git repos. The github-issues backend is harder to integration-test — either a real test repo on GitHub (network, auth, side effects) or a mock `gh` that records calls and returns canned responses. Tracked in `backlog/todo/early-pr-spec-visibility-followup.md` alongside the related maildir-shared friction observations.
