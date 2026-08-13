# Release Troubleshooting

Common issues and recovery steps.

## Partial Failures

### Commit succeeded but push failed

```bash
# Push the commit and tag manually
git push origin main --tags
```

### Push succeeded but GitHub release failed

```bash
# Create release for existing tag
gh release create vX.Y.Z --title "vX.Y.Z" --notes "Release notes here"

# Or with notes from file
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md
```

### Tag exists but no release

```bash
# Create release for existing tag
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
```

## Undoing a Release

### Delete a tag (not yet pushed)

```bash
git tag -d vX.Y.Z
```

### Delete a pushed tag

```bash
# Delete locally
git tag -d vX.Y.Z

# Delete from remote
git push origin :refs/tags/vX.Y.Z
```

### Delete a GitHub release

```bash
# Delete release (keeps tag)
gh release delete vX.Y.Z --yes

# Delete release and tag
gh release delete vX.Y.Z --yes --cleanup-tag
```

### Revert release commit

```bash
# If commit not pushed yet
git reset --soft HEAD~1

# If already pushed, create revert commit
git revert HEAD
git push
```

## Common Errors

### "fatal: tag 'vX.Y.Z' already exists"

A tag with this version already exists.

```bash
# Check existing tags
git tag --list 'v*'

# Use a different version, or delete existing tag
git tag -d vX.Y.Z
```

### "error: failed to push some refs"

Usually means the remote has commits you don't have locally.

```bash
# Fetch and check
git fetch origin
git log HEAD..origin/main --oneline

# If safe to force (only if you're the only contributor)
git push origin main --tags --force
```

### "gh: Not Found (HTTP 404)"

Repository not found or no permission.

```bash
# Check auth status
gh auth status

# Re-authenticate if needed
gh auth login
```

### "error: pathspec 'CHANGELOG.md' did not match any files"

Changelog file doesn't exist or wasn't staged.

```bash
# Check file exists
ls CHANGELOG.md

# Manually add and commit
git add CHANGELOG.md
git commit --amend
```

### CHANGELOG.md ignored by .gitignore

On case-insensitive filesystems (macOS), patterns like `changelog.md` will block `CHANGELOG.md`.

```bash
# Check if CHANGELOG.md is ignored
git check-ignore CHANGELOG.md

# If ignored, find the pattern
git check-ignore -v CHANGELOG.md

# Remove the pattern from .gitignore, then retry
```

### Rate limiting

GitHub API rate limits hit.

```bash
# Check rate limit status
gh api rate_limit

# Wait and retry, or use --skip-ci to reduce API calls
```

## Worktree Issues

### "fatal: 'main' is already checked out"

Can't create worktree because branch is checked out elsewhere.

```bash
# List worktrees
git worktree list

# Use --detach to checkout without branch
git worktree add /tmp/release origin/main --detach
```

### Ephemeral worktree not cleaned up

Release worktrees are created at `~/.worktrees/<repo>/release-<tag>`.

```bash
# List worktrees
git worktree list

# Remove stale worktrees
git worktree prune

# Force remove specific worktree
git worktree remove ~/.worktrees/dotclaude/release-v1.0.0 --force
```

### Release worktree already exists

If a previous release failed, the worktree may still exist:

```bash
# Remove the stale worktree
git worktree remove ~/.worktrees/<repo>/release-<tag> --force

# Then retry the release
```

## CI Issues

### CI failing on the commit being released

Fix the CI issue before releasing, or use `--skip-ci` if you're confident the release is safe.

The gate looks at `push`-event runs for the head SHA of the target branch, so
`gh run list` (which shows every workflow on the branch) can look greener than
the gate does. To see what the gate sees:

```bash
sha=$(git rev-parse origin/main)

# The runs that actually gate that commit
gh api "repos/{owner}/{repo}/actions/runs?head_sha=$sha&per_page=100" \
  --jq '.workflow_runs[] | select(.event=="push") | [.name,.status,.conclusion] | @tsv'

# View a specific run
gh run view <run-id>

# Release anyway (use with caution)
bun release.ts --skip-ci
```

### CI reported as `none`

No `push`-event workflow ran for that commit. That is not a pass — the commit
is unverified. Either no workflow is configured to run on push, every one of
them was filtered out by path rules, or the runs were deleted. Confirm with the
query above before reaching for `--skip-ci`.

### The skill refuses because the repo owns its releases

Not a fault. The repo has a `RELEASING.md`, release helper scripts, or a
workflow that triggers on tag push, so releasing from here would run a second
publisher against the same tag. Follow the repo's runbook. There is
deliberately no override.

If the detection is wrong — say a `RELEASING.md` that documents using this very
skill — the release is still two commands:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --generate-notes
```

### CI pending for too long

```bash
# Check run status
gh run list --limit 1

# Cancel stuck run
gh run cancel <run-id>

# Release with skip
bun release.ts --skip-ci
```

## Version Conflicts

### Wrong version released

1. Delete the release and tag
2. Fix CHANGELOG.md
3. Create new release with correct version

```bash
gh release delete vX.Y.Z --yes --cleanup-tag
git reset --soft HEAD~1  # if changelog commit not pushed
# Edit CHANGELOG.md
git add CHANGELOG.md
git commit -m "release: vX.Y.Z (corrected)"
git tag vX.Y.Z
git push origin main --tags
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```

### Need to re-release same version

Not recommended. Better to bump patch and explain in notes.

```bash
# If you must re-release same version:
gh release delete vX.Y.Z --yes --cleanup-tag
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
# Then release again
```
