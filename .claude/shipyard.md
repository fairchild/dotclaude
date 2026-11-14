# Shipyard, in this repository

Written by `/shipyard:setup` from detection against this repository, not from the template's
defaults. Each value below names what it was read from. The two user-level values — `goal_tokens`
and `scratch_root` — are not here; they live in the plugin's own config, because one user's seat
serves several repositories at once.

## Venue

- **Review venue: inline review comments**, with the verdict in the review body. Detected from the
  last six merged pull requests (#387 to #393): every one carried a review object, none had an
  inline comment, and one had a single conversation comment. Reviews here live in the review body;
  inline comments are the format `.github/copilot-instructions.md` asks for when a finding has a
  line, and recent reviews have had none to place.
- **Review label: `needs code review`** — the name to use, but read the next line before relying on
  it. The label exists and is the only one here that means "ready for review", so a seat should use
  it rather than create `review` and split the queue. What it does *not* do is arrive on its own:
  `.github/workflows/ci.yml`'s companion review workflow was gated on this label, nobody applied
  it, and the gate was dropped — the review now fires on `opened`, `synchronize`,
  `ready_for_review` and `reopened`, label or no label. **A reviewer seat polling for this label
  here would see nothing**, so either the lead applies it explicitly, or the seat runs with no
  label at all — `SHIPYARD_LABEL` unset, which takes every open non-draft pull request — and that
  is the mode to use here until a lead is running.
- `code review passed` is applied by the review workflow at the end of a review, which re-triggers
  the workflow with a bot actor. A seat treating that label as its own signal would loop.
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
- Read but do not block on: `changes`, `config`, `webui`, `analyze`, `persona`, `team`, `gondolin`,
  and the reusable `package` workflow, which reports as `package / package`, `package / browser`
  and five `package / consumer (<os>, <node>)` cells. They feed `CI`; their output and annotations
  say what `CI` only summarizes. Names taken from `ci-wait.sh` against the head of #396.
- `claude-review` comes from `.github/workflows/claude-code-review.yml`, not from `CI`. It passes
  on an approval, a comment, and for now a request for changes, and fails when no review was
  posted. It is not required. A head can report it twice, once skipped from the bot-actor rerun.
- `claude` comes from `.github/workflows/claude.yml` and is skipped on an ordinary head.
- `deploy-skills`, `deploy-webui` and `publish` run on `main` after a merge, not on a pull
  request. A seat waiting for them on a pull request head waits forever.
- Typical duration: about 100 seconds median over the last ten pull-request runs of `ci.yml`
  (67 to 131 seconds, one at 340). Paths in `.github/scripts/paths.mjs` decide which jobs run, and
  any change under `.github/` or to `.mise.toml` triggers all of them.

## Never defer

This repository already treats each of these as unarguable, so a finding in one of these classes is
blocking whatever its size.

- **A private reference or a secret in tracked text, a commit message, or a pull request body.**
  This repository is public and its owner's other work is not; `scripts/public-text-guard.py`
  runs as a `PreToolUse` hook on Bash (wired in `settings.example.json`) and refuses commands that
  would publish such text, and the project's own instructions say to refer to the owner as "the
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

## What setup left blank

- Touched-tests-only form and poll interval: no task runs a subset, and the gate finishes in seconds, so the defaults stand.
- Forks: none named, so the seat does not run the gate on a fork's pull request.
- The full `config` job runs more than the gate and tests above (workflow tests, the public-text guard's cases, the cloud bootstrap, several skill self-tests). No single `mise` task wraps it, so a seat relies on CI for those.
