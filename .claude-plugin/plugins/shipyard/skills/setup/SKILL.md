---
name: setup
description: Fit the seats to one repository — detect its gate, tests, checks and venue, write .claude/shipyard.md, and leave the seats better configured than their defaults. Run as /shipyard:setup once per repository, or again when the repository's tooling changes.
license: Apache-2.0
disable-model-invocation: true
metadata:
  status: experimental
  experimental_reason: "No eval yet, and one consumer; the detection rules are written from a handful of repositories rather than from a survey."
---

# Fitting the seats to a repository

The seats work with no configuration. This skill exists because their defaults are guesses about
*this* repository, and a guess that a session re-derives on every review is a guess it will
eventually get wrong differently.

It runs once per repository, and again when the tooling changes. It writes exactly one file —
`.claude/shipyard.md`, tracked, in the repository under review — and creates the review label if
the repository has none. Nothing else is yours to change here: not CI, not branch protection, not
settings, not another repository.

## Before writing anything

Read, in this order, and let each override the one before it:

1. `CLAUDE.md` and `AGENTS.md`, at the root and in any subdirectory that has its own.
2. The repository's own review or contribution policy — `CONTRIBUTING.md`, a `.github/` review
   instruction file, a `docs/` convention page.
3. An existing `.claude/shipyard.md`, which is the previous answer to this question and may carry
   decisions nothing in the tooling records.

A value a human wrote in one of these wins over a value you detect. Detection fills blanks; it does
not overrule prose.

## Detection

Each line of `references/detection.md` is what to run and what the answer means. The short form:

| Value | How to find it |
| --- | --- |
| gate, tests | the lockfile names the package manager; the task runner's own list names the tasks (`mise tasks`, `package.json` scripts, `just --list`, `make -qp`). Prefer a task the repository already calls `check`, `lint`, `test` over a command you compose. |
| required checks | `gh api repos/<repo>/rulesets` and the branch-protection endpoint. A 404 from protection is an answer, not an error: it means rulesets or nothing. Record which, because "0 approvals required" changes what a verdict is for. |
| CI duration | the median of the last ten runs of the required workflow, so a seat waits instead of polling. |
| venue, label | the repository's existing review habits: do humans review inline or in conversation? Does a label already mean "ready for review"? Reuse the name in use before inventing `review`. |
| never-defer classes | the repository's own gates and guards. A script that refuses a commit, a hook, a CI job whose whole purpose is a policy — each names a class that is never a nit here. |

Run every detection command and show what each printed before you write the file. A detected value
with no command behind it is a guess wearing a table's clothes.

## Writing the file

Start from `../reviewer/references/project-template.md` and fill only what you detected or read.
Leave a line blank rather than guessing: a blank line means the documented default, which is a
decision, while a wrong value is a decision nobody made.

Two rules about what must not enter this file. It is tracked, and in a public repository it is
world-readable: no credential, no token, no internal hostname, no private repository name, and no
path that only exists on one machine. And nothing user-level belongs in it — `goal_tokens` and
`scratch_root` are declared in the plugin's own config, because they describe the machine the seat
runs on and the account it runs as, not this repository.

Then say, in the file, what you could not detect and why. The next reader of the file is a seat
deciding whether to trust it.

## The label

A label is a narrowing, not a precondition: with none configured the seat reviews every open
non-draft pull request, which is how a repository runs the seat before it has decided anything.
Configure one when the repository wants the lead to choose what gets reviewed — and then something
has to apply it, which is the part that gets forgotten.

If the repository wants a label and has none meaning "ready for review", create the one the file
names:

```bash
gh label create review --repo "$REPO" --description "The reviewer seat picks this up" --color 0366d6
```

If a label already carries that meaning under another name, use the existing name and create
nothing. A second label for the same idea splits the queue, and half the work goes unreviewed.

Then check what actually applies it. A label that exists because a workflow used to be gated on it,
with nothing applying it now, is worse than no label: a seat polling for it sees an empty queue and
reports nothing to do. Say in the config file what applies the label, or leave the line blank.

## Checking the fit

Setup is not done when the file is written. It is done when the seat has used it:

1. `SHIPYARD_REPO=<repo> ${CLAUDE_PLUGIN_ROOT}/scripts/watch.sh` — exits 0, and prints the pull
   requests you expect and no others. If it exits 2, the label or the token is wrong, not the file.
2. The gate and test commands, run once, from a clean checkout. A command that only works in your
   shell is not detected, it is remembered.
3. `SHIPYARD_SHA=<a recent head> ${CLAUDE_PLUGIN_ROOT}/scripts/ci-wait.sh` — the check names it
   prints are the real ones. Correct the required-checks line against that output, not against the
   workflow file, which names jobs rather than checks.

Report what each printed. A setup reported as complete without these three is the failure this
skill exists to prevent: a configuration file that is wrong in a way nobody notices until a
verdict is wrong.

## Session wiring for a seat

A seat is a session that will compact several times before the work is done, so part of setting up
a repository is making a new session survive that. This is the part the plugin cannot do for the
operator, and being clear about the split is most of the value here.

**What the plugin ships.** A `PreCompact` hook that names the seat's resume file and when it was
last written, and a `SessionStart` hook that tells a new session the file exists and needs
re-checking. Both come from `scripts/seat-resume.sh` and are silent in a session that is not a
seat. `goal_tokens` and `scratch_root` come from the plugin's `userConfig` and reach the hook as
`CLAUDE_PLUGIN_OPTION_GOAL_TOKENS` and `CLAUDE_PLUGIN_OPTION_SCRATCH_ROOT`.

**What the operator sets.** The engine's own automatic compaction point. The plugin does not try to
set it from the manifest — set it where it is definitely read, and verify by reading it back, which
is the only claim worth making about a setting:

```json
{
  "autoCompactWindow": 300000
}
```

The number is `goal_tokens`. The engine compacts at `min((W - 20000) * P / 100, W - 33000)`, so at
`W = 300000` the second arm binds and the backstop lands at 267,000 — about 33,000 below the goal.
That ordering is the point: the seat compacts deliberately at its prepare point (the goal less
80,000, so 220,000), with instructions about what the summary must keep, and the engine's point is
the backstop that compacts without them. Set the two from different numbers and the backstop can
fire first, which is the one case where a seat loses its state without being asked.

Per session instead of per machine: `claude --autocompact 300000`.
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` does the same through the environment, and
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` moves the `P` in that formula.

**Verify by reading it back.** The `compaction` mod reports both numbers and says when they
disagree, which is a better check than re-reading the file you just wrote:

```text
Points: a goal of 300,000; requests from 150,000; the prepare point at 220,000;
        automatic compaction at 667,000 (the engine's threshold).
Note: the engine compacts at 667,000, not the 267,000 this goal implies. Only the
      `autoCompactWindow` setting moves that one; set it to 300,000 to line them up.
```

That is the unwired state on a million-token model: the goal advises a compaction 400,000 tokens
before the engine would do anything. Wired, the note goes away.

## What is true when setup is done

Say which of these now holds, and which the operator still has to do by hand:

- [ ] `.claude/shipyard.md` committed in the repository under review, with detected values and the
      blanks left blank.
- [ ] The review label exists, and something applies it — or the file says the seat runs with no
      label.
- [ ] The gate and test commands run from a clean checkout.
- [ ] `watch.sh` exits 0 and lists what you expect; `watch.sh --self-test` passes.
- [ ] `ci-wait.sh` prints the check names the required-checks line claims.
- [ ] `shipyard` installed, with `goal_tokens` and `scratch_root` set — the operator's, per machine,
      not per repository.
- [ ] `autoCompactWindow` set to the same number as `goal_tokens`, and the `compaction` mod's report
      no longer notes a disagreement.
- [ ] The seat's resume directory exists under `scratch_root`.

## Handing over

Commit the file in the repository under review, on a branch, as its own pull request — the first
thing the seats touch should go through the process they are there to run. Say in the body what was
detected, what was read from prose, and what is still blank.
