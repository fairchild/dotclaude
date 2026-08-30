---
name: release
description: Create semantic versioned releases with AI-generated changelogs, for repos that do not already have a release pipeline of their own. Worktree-aware - works from any branch. Use when the user wants to create a release, cut a release, bump version, or publish a new version. Defers to the repo's own release process when it detects one, and gates on the CI of the exact commit being released.
license: Apache-2.0
disable-model-invocation: true
---

# Release

Create semantic versioned releases from any branch or worktree.

This is a release path for repos that don't have one. A repo with its own
build/sign/publish pipeline already answers every question this skill asks —
which version, what goes in the notes, who publishes — so the skill detects
that and stands down rather than running a second, competing process.

## Quick Start

Script paths below are relative to this skill's base directory.

```bash
# Preview release (no changes)
bun scripts/analyze.ts

# Execute release
bun scripts/release.ts

# Dry run
bun scripts/release.ts --dry-run
```

## Command Options

| Option | Effect |
|--------|--------|
| no args | Analyze, confirm, release origin/main |
| --dry-run | Preview only, no changes |
| --version vX.Y.Z | Override suggested version |
| --no-changelog | Skip CHANGELOG.md, notes in GitHub release only |
| --current-branch | Release HEAD of current branch, for hotfix branches |
| --prerelease alpha | Create pre-release, e.g. v1.0.0-alpha.1 |
| --skip-ci | Release even if CI is red, pending, or absent |

## When the repo owns its releases

Before doing anything, the skill looks for evidence that the repo already has a
release process. Detection is by convention — nothing is hardcoded to a
particular repo:

| Signal | What it implies |
|--------|-----------------|
| `RELEASING.md` (or `RELEASE.md`, `docs/RELEASING.md`) | A runbook exists; a human wrote down how this ships |
| A release helper in `scripts/` — `prepare-release.sh`, `release-version.sh` | Release metadata is prepared by the repo, not guessed |
| A workflow with an `on: push: tags:` trigger | Pushing a tag *starts* something — a build, a sign, a notarize |
| The default branch requires a pull request | A direct push either fails or spends an admin bypass |

The first three mean the repo publishes its own releases, and the skill stops
entirely — it prints what it found and points at the runbook. Tagging into a
tag-triggered pipeline is the expensive failure: the tag starts someone else's
build, and `gh release create` races whatever that build publishes. A tag the
repo's own version check rejects leaves a public tag with no release behind it.

The fourth is narrower. It only blocks writing `CHANGELOG.md` to the branch, so
`--no-changelog` still works — that path tags and publishes without touching the
protected branch, which is a legitimate release on a PR-only repo.

There is no flag to override the first three. If the repo publishes its own
releases, this skill is the wrong tool for it, and a bypass flag would only make
that easy to forget.

**Versioning follows ownership.** A repo with its own pipeline usually has a
version in its own metadata — an Xcode `MARKETING_VERSION`, a manifest, a
`release-version.sh` — and a tag contradicting it fails that repo's checks. So
when the skill defers, it declines to suggest a version at all rather than
guessing one that outranks the repo's own answer.

## CI gate

The gate asks one question: *did the workflows that gate this commit pass on
this commit?*

- Runs are scoped to the head SHA of the target branch, not "latest on the
  branch". The commit being released is the commit that must be green.
- Only `push`-event runs count. Scheduled jobs, `workflow_run` chains, and bots
  replying to comments are green or red for reasons of their own, and a repo
  with chatty automation has plenty of them.
- Where a workflow ran more than once, its newest run is its verdict.
- `skipped` and `neutral` are not failures — path-filtered workflows skip
  legitimately. Anything else that isn't `success` is a failure, `cancelled`
  included.
- **No run found is reported as `none`, not success.** An unverified commit and
  a passing commit are different things.

Only `success` allows a release. `--skip-ci` overrides all of it.

## Worktree-Aware Workflow

The skill releases `origin/main` regardless of your current branch:

```
You're in:     ~/conductor/workspaces/.claude/casablanca (worktree)
Current branch: feat/my-feature
Release target: origin/main ✓
```

**How it works:**

- Creates ephemeral worktree at `~/.worktrees/<repo>/release-<tag>`
- Commits changelog, tags, pushes to origin/main
- Cleans up worktree after release

This approach is predictable and never modifies your current working directory. Use `--current-branch` to release from current directory instead (for hotfix branches).

## Workflow

### 1. Analyze

Run the analyze script (read-only, safe anytime):

```bash
bun scripts/analyze.ts
```

Shows:
- Current context (branch, worktree status)
- Target branch and the exact commit that would be released
- Any signals that the repo owns its own release process
- Commits since last tag
- Suggested version (omitted when the repo owns versioning)
- Generated changelog
- CI status for that commit

### 2. Review and Confirm

Check the suggested version and changelog preview. Adjust with:
- `--version vX.Y.Z` to override version
- `--prerelease alpha` for alpha/beta/rc

### 3. Execute

```bash
bun scripts/release.ts
```

The script:
1. Stops if the repo publishes its own releases
2. Requires CI to be green on the commit being released (unless `--skip-ci`)
3. Stops if the changelog commit would need a pull request (use `--no-changelog`)
4. Finds or creates release worktree
5. Updates CHANGELOG.md (unless `--no-changelog`)
6. Commits: `release: vX.Y.Z`
7. Creates and pushes tag
8. Creates GitHub release
9. Cleans up ephemeral worktree

Steps 1–3 run before `--dry-run` returns, so a dry run that reports success is
a dry run that would have released.

## Version Bumping

| Change Type | Bump | Example |
|-------------|------|---------|
| Breaking changes | Major | 1.2.3 → 2.0.0 |
| feat commits | Minor | 1.2.3 → 1.3.0 |
| fix, chore, etc. | Patch | 1.2.3 → 1.2.4 |

Pre-1.0: Breaking → minor, feat → minor, fix → patch.

Pre-releases: --prerelease alpha → v1.0.0-alpha.1, v1.0.0-alpha.2, etc.

## Changelog Format

Uses [Keep a Changelog](https://keepachangelog.com/):

```markdown
## [1.3.0] - 2026-01-24

### Added
- feature: New capability

### Fixed
- bug: Resolved issue

### Changed
- refactor: Improved performance
```

## Error Recovery

See [references/troubleshooting.md](references/troubleshooting.md) for:
- Partial failure recovery (commit/push/release)
- Undoing a release (delete tag, retract)
- Worktree cleanup
- CI issues

Quick fixes:
```bash
# Push failed after commit
git push origin main --tags

# GitHub release failed after push
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes

# Delete bad release
gh release delete vX.Y.Z --yes --cleanup-tag
```
