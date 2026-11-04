# Shipyard, in this repository

Written by `/shipyard:setup` from detection against this repository, not from the template's
defaults. Each value below names what it was read from. The two user-level values — `goal_tokens`
and `scratch_root` — are not here; they live in the plugin's own config, because one user's seat
serves several repositories at once.

## Venue

- **Review venue: inline review comments**, with the verdict in the review body. Detected from the
  last five merged pull requests: every review arrived as a review object, four with no inline
  comments and one with four, and no pull request had a single conversation comment. A seat posting
  conversation comments here would be posting somewhere nobody reads.
- **Review label: `needs code review`** — the label already in use, described in this repository as
  triggering the review workflow. Not `review`: a second label for the same idea splits the queue
  and half the work goes unreviewed.
- Seat-to-seat notes: none. This repository has no thread issue; a seat with something to say to the
  next seat says it in the pull request.

## Commands

The lockfile is `uv.lock`, but the gate is `mise`, which this repository's CI and its authors both
run. Tasks come from `mise tasks`.

- Gate: `mise run catalog:check && mise run portability:check`
- Tests: `mise run portability:test && mise run test:participant`
- Frontmatter changed: `mise run catalog` — then commit the regenerated tables. CI fails when they
  drift from the frontmatter, so this is part of the gate, not a courtesy.
- Full local CI: the `config` job's script in `.github/workflows/ci.yml` is the real gate. It needs
  `jsonschema` and `pyyaml` in a `uv` environment; `python3` alone has no `tomllib` on this machine,
  so `.github/scripts/validate-config.py` must run under `uv run --python 3.13`.

## Checks

- **Required check: `CI`** — one name, the aggregate gate job. Detected from ruleset `pr-required`
  on the default branch. The branch-protection endpoint returns 404: this repository uses rulesets,
  not classic protection, and a seat that reads the 404 as "unprotected" would be wrong.
- Required approvals: **0**. The verdict is the only review on record, which raises what it has to
  carry rather than lowering it.
- Read but do not block on: `config`, `package`, `webui`, `analyze`, `persona`, `team`, `gondolin`,
  `changes`, `publish`, and the `package / consumer` matrix. They feed `CI`; their output and
  annotations say what `CI` only summarizes.
- `deploy-skills` and `deploy-webui` run on `main` after a merge, never on a pull request. A seat
  waiting for them on a pull request head waits forever.
- Typical duration: about 90 seconds median over the last ten runs, up to four minutes when every
  job is triggered. Paths in `.github/scripts/paths.mjs` decide which jobs run, and any change
  under `.github/` or to `.mise.toml` triggers all of them.

## Never defer

This repository already treats each of these as unarguable, so a finding in one of these classes is
blocking whatever its size.

- **A private reference or a secret in tracked text, a commit message, or a pull request body.**
  This repository is public and its owner's other work is not; `scripts/public-text-guard.py`
  refuses commits for this, and the project's own instructions say to refer to the owner as "the
  user". A reviewer who lets one through cannot take it back.
- **Generated tables out of step with their source.** `mise run catalog` regenerates the README
  tiers from `SKILL.md` frontmatter and CI fails on drift. A pull request that edits frontmatter
  without the regenerated tables is not finished.
- **A loosened gate.** A check removed from `ci.yml`, a path pattern narrowed in
  `.github/scripts/paths.mjs`, a validator's failure turned into a warning. The diff looks small
  and the consequence is that nothing is checked.
- **Anything that makes `~/.claude` not a standalone clone on `main`.** A symlink, a move, a
  worktree. The project's instructions are explicit, and the failure mode takes the user's whole
  configuration with it.
- **A skill that claims provenance it does not have.** `origin:` and `inspired-by:` are checked by
  CI and are a licensing claim, not a courtesy.

## Model and effort

| Work | Model | Effort |
| --- | --- | --- |
| fresh review | Opus | high |
| re-check | Sonnet | medium |
| citation checking | Haiku | low |
| blind second read | Opus | high |

A fresh review here reads prose as often as code — skills, references, instructions — and a model
that skims prose finds nothing in this repository. A re-check reads a delta against a settled list,
which is work a smaller model does well.

## Repository notes

- **This repository is `~/.claude`.** A root `plugins/` directory is Claude Code's own
  installed-plugin cache and is gitignored; multi-component plugins live under
  `.claude-plugin/plugins/`. The same goes for `projects/`, `knowledge/` and `webui/data.json`:
  runtime paths, not source.
- **`settings.json` is not tracked**, deliberately. `settings.example.json` is the shareable shape,
  and a pull request that adds the live file is a finding.
- **Two clones, both on `main`.** Development happens in the development clone; the runtime clone is
  read-and-fast-forward only. A seat reviewing a change to the deploy script is reviewing something
  that runs at every session start on this machine.
- **Skill tiers are declared in frontmatter**, not in the README. Promotion is removing
  `metadata.status`; the gate for stable is an eval or sustained real use.
- Session data is gitignored, and the `.gitignore` entries that do it are load-bearing rather than
  tidy-up.
