# Shipyard, in this repository

Copy this to `.claude/shipyard.md` in the repository the seat reviews and fill it in. Every value
is optional: a missing line means the seat's default, and a repository with no file at all still
gets a working reviewer. Values here are repository-wide; the two user-level values —
`goal_tokens` and `scratch_root` — live in the plugin's own config, because one user's seat serves
several repositories at once.

## Venue

Where the seat posts reviews and verdicts, and where it watches for work.

- Review venue: <!-- conversation comments (default) | inline review comments | a tracking issue number -->
- Review label: <!-- default: review -->
- Thread for seat-to-seat notes: <!-- an issue or discussion the seats post to, if this repository uses one -->

## Commands

What the seat runs on a fresh review. Leave blank to have it detected from the lockfile.

- Gate: <!-- e.g. mise run check -->
- Tests: <!-- e.g. mise run test -->
- Touched-tests-only form: <!-- how to run a subset, if the gate is slow -->

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

## Repository notes

Anything a first-time reviewer of this codebase would get wrong: generated files that look
hand-written, a test suite that is flaky in a known place, a module whose rules differ from the
rest.
