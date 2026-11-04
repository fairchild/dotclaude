# shipyard

A development pattern with seats rather than tasks. A **lead** session plans, assigns and merges; a
**reviewer** session owns every fresh review and re-check in a repository; short-lived
**implementers** work in their own worktrees between them. The seats are long-lived because a
reviewer that has read every pull request in a repository says things a reviewer handed one diff
cannot, and because the author of a change is the worst available judge of it.

All three seats are here — `/shipyard:lead`, `/shipyard:reviewer` and `/shipyard:setup` — with a
compaction hook that names each seat's resume file at the moment it is about to lose its context.

## Install

```
/plugin install shipyard --marketplace fairchild/dotclaude
```

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

## The lead seat

```
/shipyard:lead
```

One session per repository: it holds the queue, writes the briefs, cuts a worktree per implementer
and dispatches into it, applies the review label and then says nothing — a reviewer told what to
find finds it — reads the verdict, gives every finding a disposition, and merges the verified head
with `--match-head-commit` once the verdict is `approve` at the current head and the required
checks are green on it.

It does not write implementation code, does not review, and cannot overrule a verdict. A seat that
can overrule the review is a seat with no review; if a finding looks wrong, the lead argues it in
the pull request and the reviewer re-checks.
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
[`project-template.md`](skills/reviewer/references/project-template.md) is the blank. `userConfig`
is scoped per user, not per repository, which is why a value like a review label cannot live there:
one seat serves several repositories at once and they do not agree.

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
