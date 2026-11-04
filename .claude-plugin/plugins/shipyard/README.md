# shipyard

A development pattern with seats rather than tasks. A **lead** session plans, assigns and merges; a
**reviewer** session owns every fresh review and re-check in one repository; short-lived
**implementers** work in their own worktrees between them. The seats are long-lived so that one
reader has seen every pull request in the repository, and separate so that no session judges work
it decided on or wrote.

All three seats are here — `/shipyard:lead`, `/shipyard:reviewer` and `/shipyard:setup` — with a
compaction hook that names each seat's resume file at the moment it is about to lose its context.

## Install

```
/plugin install shipyard --marketplace fairchild/dotclaude
```

In a cloud environment the setup line in the main README's
[Cloud sessions](../../../README.md#cloud-sessions) installs it with the rest of the bundle, so a
cloud session can take a seat without installing anything by hand. That matters for the reviewer
seat in particular: `gh pr` goes through GraphQL and answers `403` in cloud sessions, which is why
[`posting.md`](skills/reviewer/references/posting.md) posts through REST everywhere.

From a terminal, `claude plugin install` instead of `/plugin install`. The plugin declares
`dependencies` on the [`compaction`](../../../mods/README.md) and
[`usage-meter`](../../../mods/README.md) mods rather than absorbing them: a seat needs to know what
its context and its usage windows are doing, and both already exist as mods of their own.

## The reviewer seat

```
/shipyard:reviewer
```

One session per repository, open for as long as the work lasts. It watches for pull requests the
lead has labelled for review and for pushes to ones it already reviewed, reviews each in its own
scratch worktree bound to the base and head SHAs, probes every claim rather than taking it (does
each test actually fail for the defect it names?), marks findings `blocking`, `deferrable` or
`nit`, and posts exactly one verdict per head in a grammar a merge tool can parse:

```text
VERDICT: approve | changes-needed | verification-incomplete — at <40-char head SHA> — <n> blocking, <n> deferrable, <n> nit
```

It never merges, never pushes to an author's branch, and never reviews its own work.

[`skills/reviewer/SKILL.md`](skills/reviewer/SKILL.md) is the contract;
[`references/posting.md`](skills/reviewer/references/posting.md) holds the bodies and the REST
commands (`gh pr` goes through GraphQL, which answers `403` in cloud sessions);
[`references/lessons.md`](skills/reviewer/references/lessons.md) is what previous seats learned,
cited by number.

## Skills and tiers

| Skill | Invoked as | Tier | What keeps it from stable |
| --- | --- | --- | --- |
| `lead` | `/shipyard:lead` | experimental | no eval, one consumer; the merge step is the only part of the pattern that changes a shared branch and it has not run unattended long |
| `reviewer` | `/shipyard:reviewer` | experimental | no eval, one consumer; the verdict grammar is stable but little parses it yet |
| `setup` | `/shipyard:setup` | experimental | no eval, one consumer; the detection rules come from a handful of repositories rather than a survey |

Each declares its tier in its own `SKILL.md` frontmatter, which is what
`.github/scripts/validate-config.py` checks. All three are slash-only
(`disable-model-invocation: true`): taking a seat is something the user does on purpose, not
something a model decides mid-task.

## The lead seat

```
/shipyard:lead
```

One session per repository: it holds the queue, writes the briefs, cuts a worktree per implementer
and dispatches into it, applies the review label and then says nothing — a reviewer told what to
find finds it — reads the verdict, gives every finding a disposition, and merges the verified head
with `--match-head-commit` once the verdict is `approve` at the current head and the required
checks are green on it.

It does not write implementation code, does not review, and cannot overrule a verdict: if a finding
looks wrong, the lead argues it in the pull request and the reviewer re-checks.
[`references/brief.md`](skills/lead/references/brief.md) is the brief's shape and the four ways one
goes wrong.

## Setup

```
/shipyard:setup
```

Once per repository, and again when its tooling changes. It detects the gate, the tests, the
required check names, the venue and the review label by running commands rather than reading
guesses out of files, writes `.claude/shipyard.md` in the repository under review, and then checks
the fit by running the seat's own scripts against it. It creates the review label if the repository
has none and reuses the existing name if it has one. `skills/setup/references/detection.md` is what
it runs and what each answer means.

This repository's own [`.claude/shipyard.md`](../../../.claude/shipyard.md) is the worked example.

## Configuration

Two values are the user's, so they live in the plugin's `userConfig` (`/config`, or
`claude plugin configure shipyard`):

| Value | Default | What it is |
| --- | --- | --- |
| `goal_tokens` | 300000 | the context a seat stays under, the same number the `compaction` mod judges a request against |
| `scratch_root` | `~/.worktrees/shipyard` | where a seat cuts the throwaway worktrees it reviews in |

Everything else is the repository's, and lives in one tracked file in the repository under review,
`.claude/shipyard.md` — the venue, the review label, the gate and test commands, the required check
names, the finding classes that are never deferrable, and the model-and-effort table.
[`project-template.md`](skills/reviewer/references/project-template.md) is the blank.

The split follows from what each value describes. `userConfig` is scoped per user, so the two
values there are the ones about the machine and the account: where worktrees are cut, and how much
context a session keeps. A review label is not a property of either, and a repository has no
standing to set them.

A repository with no config file still gets a working reviewer — comments as the venue, a `review`
label, gate and test commands detected from the lockfile, required checks read from CI. Configuring
it improves on that; it is not the price of entry.

## The compaction hook

A seat outlives its context window, so the pattern depends on a resume file — the queue, each open
pull request with the verdict and the head SHA it binds to, what the seat was mid-way through.
[`scripts/seat-resume.sh`](scripts/seat-resume.sh) names that file at the two moments it matters:
`PreCompact`, where it also says when the file was last written, and `SessionStart`, where it tells
the next session the file exists and that everything in it needs re-checking.

It does not write the file. What belongs in one is what the seat knows and a script cannot guess.
Installed globally the hook runs in every session, so it stays silent unless the working directory
is a repository that already has a resume file — a seat's hook has no business narrating itself in
a session that is not a seat. The resume file is keyed by the repository's remote rather than the
checkout, so a seat that moves to a second worktree is still the same seat.

## No version, no `bin/`

`plugin.json` pins no `version`, matching the [mods](../../../mods/README.md): an install from this
repository on GitHub then resolves to the commit SHA and `claude plugin update` follows `main`,
where a pinned version would be compared instead of the commit and leave installed sessions on an
old copy. Executables live in [`scripts/`](scripts/) and are referenced through
`${CLAUDE_PLUGIN_ROOT}`, never in a `bin/` directory, which claude.ai and Cowork refuse to install.
