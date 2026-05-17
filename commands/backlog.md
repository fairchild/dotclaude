---
description: Maildir-style backlog — add/take/complete/cancel/reopen/release/progress/status/next/why/groom. Default = status if no subcommand.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# /backlog

Dispatches to the backlog skill scripts. Subcommand goes first, remaining args pass through.

## Dispatch

Parse `$ARGUMENTS` as `<verb> <rest...>`. Run the matching script under `~/.claude/skills/backlog/scripts/`:

| verb       | script         | use                                                  |
|------------|----------------|------------------------------------------------------|
| add        | add.sh         | create a task in todo/ — interactive or args         |
| take       | take.sh        | claim a task (todo → doing)                          |
| next       | next.sh        | dry-run: what would `take` pick                      |
| complete   | complete.sh    | finish (doing → done/{YYYY}/)                        |
| cancel     | cancel.sh      | abandon (→ done/{YYYY}/cancelled/) — requires reason |
| reopen     | reopen.sh      | done → todo — requires reason                        |
| release    | release.sh     | give back claimed task (doing → todo) — requires reason |
| progress   | progress.sh    | append progress note to current claim                |
| status     | status.sh      | what's in each pile                                  |
| why        | why.sh         | explain why a task isn't takeable                    |
| groom      | groom.sh       | advisory report on stuck/blocked items               |
| init       | init.sh        | first-time backlog/ setup in a project               |
| migrate    | migrate.sh     | convert flat backlog/ to maildir layout              |

If no verb is given, run `status.sh`. If the verb is unknown, list the table.

## Add Flow

When the user runs `/backlog add` interactively, gather context first — don't dump the user into editor-of-empty-file mode:

1. **Slug** (kebab-case, will be filename minus category suffix)
2. **Category**: plan, followup, task-list, ideas
3. **One-line description**
4. **Priority** (1 = highest, optional)
5. **Topic** (optional grouping label)
6. **Timeout** (optional — only if there's a real budget; `4h`, `3d`, `2w`)
7. **Dependencies** (optional — slugs of tasks that must finish first)

Then call `add.sh SLUG --category=X --topic=Y --priority=N [--timeout=DUR] [--description="..."]`.

The script creates a scaffold file and prints its path. Open it and fill in the body (problem statement, key decisions, phases, references, acceptance criteria). If the user provided dependencies, edit the `dependencies:` block in frontmatter — `add.sh` doesn't take a `--dependencies` flag because it's almost always a map best entered by hand.

Quality bar for the body:

- Enough context that a fresh session can execute without the original conversation
- Specific file paths (with line numbers when relevant)
- Verification commands or acceptance criteria
- Dependencies declared if any

## Take Flow

`take` is atomic in spirit — it does `git mv todo/X.md doing/X.md`, stamps `claimed_at`/`claimed_by`/`branch`, and appends a `started` block. The git mv *is* the claim; the started entry is documentation.

- `take` with no arg → highest-priority takeable task whose deps are all in `done/**`
- `take SLUG` → that specific task (must be in todo/)
- `take` infers branch from current git branch and claimer from env (Conductor/cmux workspace) or `user@host`

## Complete Flow

`complete` looks for the doing/ task on the current branch when called with no slug. It writes `pr:` if `gh` knows about a PR for the branch, then `git mv` into `done/{YYYY}/`.

If the branch matches a finer subdir (e.g. `done/2026/Q2/`) that already exists for the current period, it lands there. Otherwise flat under the year.

## Cancel / Reopen / Release

These all require `--reason="..."` because a verb without context rots the audit trail. The reason becomes the body of the appended log entry.

## Progress Notes

`progress "note"` appends a timestamped entry to the doing/ file on the current branch. Only the claimer should call this — the maildir invariant is single-writer between take and complete.

## Inspection — Status, Next, Why, Groom

- `status` — pile counts and per-task summary
- `next` — what `take` would pick, plus what's blocked
- `why SLUG` — for a specific task, which deps are blocking it
- `groom` — advisory report: merged-but-not-moved, timed-out, quiet, unresolvable deps, cycles

## Notes for the agent

- All scripts accept `--backlog=PATH`; default is `./backlog` (or walks upward to find it).
- Scripts don't commit by default. Pass `--commit` to stage and commit, or do it yourself after a multi-step change.
- Schema, body format, and dependency rules are in `~/.claude/skills/backlog/references/agents-schema.md`. Read it before editing files by hand.
