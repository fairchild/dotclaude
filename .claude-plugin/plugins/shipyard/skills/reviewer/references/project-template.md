# Shipyard, in this repository

Copy this to `.claude/shipyard.md` in the repository the seat reviews and fill it in. Every value
is optional: a missing line means the seat's default, and a repository with no file at all still
gets a working reviewer. Values here are repository-wide; `goal_tokens` and `scratch_root` live in the plugin's own config,
because they describe the machine the seat runs on rather than this repository.

## Venue

Where the seat posts reviews and verdicts, and where it watches for work.

- Review venue: <!-- conversation comments (default) | inline review comments | a tracking issue number -->
- Review label: <!-- default: review -->
- Thread for seat-to-seat notes: <!-- an issue or discussion the seats post to, if this repository uses one -->

## Commands

What the seat runs on a fresh review. Leave blank and it discovers them from the repository's own
task runner — `mise tasks`, `package.json` scripts, a `justfile`, a `Makefile` — preferring a task
already called `check`, `lint`, `test`, `ci` or `verify`.

Name them here anyway if the repository has a gate that discovery would not pick, or would pick
wrongly. A lockfile is not a gate: `bun.lock` tells the seat which package manager runs, not that
`bun run check` exists. Examples of what a filled-in line looks like, not defaults:
`bun run check`, `pnpm check`, `uv run lint`, `mise run ci`.

- Gate: <!-- e.g. mise run check -->
- Tests: <!-- e.g. mise run test -->
- Touched-tests-only form: <!-- how to run a subset, if the gate is slow -->
- Poll interval: <!-- seconds between polls of an idle repository; default 120 -->

## Checks

- Required check names: <!-- the names that must be green before approve; blank = whatever the head reports as required -->
- Checks to read but not block on: <!-- optional checks whose output still matters -->
- Typical CI duration: <!-- so the seat waits rather than polling pointlessly -->

## Never defer

Finding classes that are always blocking in this repository, whatever their size. One per line,
each naming what it covers.

- <!-- e.g. a change that widens what a hook or permission allows -->
- <!-- e.g. a secret, credential or private hostname in tracked text -->
- <!-- e.g. a loosened gate in CI -->

## Model and effort

| Work | Model | Effort |
| --- | --- | --- |
| fresh review | <!-- --> | <!-- --> |
| re-check | <!-- --> | <!-- --> |
| citation checking | <!-- --> | <!-- --> |
| blind second read | <!-- --> | <!-- --> |

## Forks

The seat does not run the gate on a pull request from a fork: that executes a stranger's code on the
machine the seat runs on, with its token in the environment. It relies on CI and records the gate as
not run.

Name a fork here only to opt out of that, and only for one you have reason to trust.

- <!-- e.g. a fork belonging to a maintainer of this repository -->

## Repository notes

Anything a first-time reviewer of this codebase would get wrong: generated files that look
hand-written, a test suite that is flaky in a known place, a module whose rules differ from the
rest.
