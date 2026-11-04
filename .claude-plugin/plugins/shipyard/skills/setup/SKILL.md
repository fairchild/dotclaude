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
`scratch_root` are the user's, declared in the plugin's own config, because one user's seat serves
several repositories and they do not agree.

Then say, in the file, what you could not detect and why. The next reader of the file is a seat
deciding whether to trust it.

## The label

If the repository has no label meaning "ready for review", create the one the file names:

```bash
gh label create review --repo "$REPO" --description "The reviewer seat picks this up" --color 0366d6
```

If a label already carries that meaning under another name, use the existing name and create
nothing. A second label for the same idea splits the queue, and half the work goes unreviewed.

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

## Handing over

Commit the file in the repository under review, on a branch, as its own pull request — the first
thing the seats touch should go through the process they are there to run. Say in the body what was
detected, what was read from prose, and what is still blank.
