# Running a review with Codex CLI

Codex is a reviewer that didn't write the PR, which is what the gating review needs. This page applies only where
`command -v codex` finds the CLI. It runs review-pr's own passes: Codex reads this skill and follows it, so the
review means the same thing whichever model runs it.

## The passes

- **First pass, once per PR.** The full First pass, with the Approach step widened to a high-level review of the
  interface, the design and the architectural approach. Ask for it once. Later passes don't repeat it.
- **Re-checks, every pass after.** The skill's Re-checks: only what changed since the last reviewed head, each earlier
  finding confirmed fixed or tracked, blockers only in new code. The prompt carries the earlier findings and what was
  done with each, so Codex builds on its last pass instead of starting over.

You decide each finding, architectural ones included, as you would any review comment: fix it, decline it with a
reason, or defer it to a tracked issue. Codex's output is a list of leads. Check each one against the code before you
hand it to whoever fixes it.

## The ledger

Keep one folder per PR, outside the repo:

- `codex-<pr>-1.md`, `codex-<pr>-2.md`, …: each pass's report.
- `dispositions.md`: one line per finding, written by you after each pass, in the form
  `<id> — fixed in <sha> | declined: <reason> | deferred: <issue>`.

The next re-check reads both.

## Commands

Run from a worktree detached at the head under review, in the background:

```sh
codex exec -C <worktree> -s <sandbox> -c approval_policy='"never"' --ephemeral \
  -o <ledger>/codex-<pr>-<n>.md "<prompt>" </dev/null > <ledger>/codex-<pr>-<n>.log 2>&1
```

- `-s read-only` reads files and runs `git` and `gh`, but can't build or write. Use it when the review needs no probes.
- `-s workspace-write` lets Codex build, run tests and try mutants. Give it a scratch worktree of its own, never the
  author's.
- `-o` writes Codex's final message, the report, to a file. The `.log` file holds the run.
- The model comes from `~/.codex/config.toml`. Pass `-c model="…"` to choose another one. `codex exec` and
  `codex review` take no `-m`.
- Stdin from `/dev/null` keeps a background run from waiting on a terminal.

`codex review --base <branch>` is the built-in alternative. It uses Codex's own review prompt instead of this skill,
so its passes don't follow these rules and can't carry a ledger.

## Prompts

First pass:

```text
Review <owner>/<repo>#<pr> at head <full sha> against base <full sha>. Read ~/.agents/skills/review-pr/SKILL.md and
do its First pass. In the Approach step, also review the interface (the public API, its names and props), the design
(each module's job and whether it sits in the right layer) and the architectural approach, and name a simpler or
more conventional shape where one exists. This is the only high-level pass this PR gets. Follow the repo's AGENTS.md
and CLAUDE.md. <Repo-specific focus, such as the rules or pinned library versions to judge against.> Report only.
Don't post, push or edit the PR. End with the findings in the skill's format and its VERDICT line.
```

Re-check:

```text
Re-check <owner>/<repo>#<pr>. Your last pass reviewed <old sha>, and the head is now <new sha>. Read
~/.agents/skills/review-pr/SKILL.md and do its Re-checks. Your earlier report is <ledger>/codex-<pr>-<n-1>.md, and
what was done with each finding is <ledger>/dispositions.md. Review only <old sha>..<new sha>: confirm each fixed
finding is fixed, accept declined and deferred ones as settled, and report blockers only in new code. Don't revisit
the interface, design or architecture. Report only. End with the VERDICT line.
```
