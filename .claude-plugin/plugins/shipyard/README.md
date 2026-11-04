# shipyard

A development pattern with seats rather than tasks. A **lead** session plans, assigns and merges; a
**reviewer** session owns every fresh review and re-check in a repository; short-lived
**implementers** work in their own worktrees between them. The seats are long-lived because a
reviewer that has read every pull request in a repository says things a reviewer handed one diff
cannot, and because the author of a change is the worst available judge of it.

This is the first slice: the reviewer seat alone, as `/shipyard:reviewer`. The lead skill, a setup
skill and a compaction prepare hook follow, in that order.

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

## No version, no `bin/`

`plugin.json` pins no `version`, matching the [mods](../../../mods/README.md): an install from this
repository on GitHub then resolves to the commit SHA and `claude plugin update` follows `main`,
where a pinned version would be compared instead of the commit and leave installed sessions on an
old copy. Executables live in [`scripts/`](scripts/) and are referenced through
`${CLAUDE_PLUGIN_ROOT}`, never in a `bin/` directory, which claude.ai and Cowork refuse to install.
