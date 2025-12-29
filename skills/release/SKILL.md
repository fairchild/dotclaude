---
name: release
description: Create a semantic versioned release with AI-generated changelog. Use when the user wants to create a new release, cut a release, bump version, update changelog, or publish a new version. Analyzes commits since last release, determines version bump, generates release notes, updates CHANGELOG.md, creates git tag, and publishes GitHub Release.
---

# Release

Create semantic versioned releases with comprehensive, AI-generated changelogs.

## Workflow

### 1. Pre-flight Validation

Run these checks before proceeding. Stop and inform user if any fail:

```bash
# Must be on main branch
git branch --show-current  # Should be "main" or "master"

# Working directory must be clean
git status --porcelain  # Should be empty

# Must be up to date with remote
git fetch origin
git status -uno  # Should show "up to date"
```

If checks fail, inform user:
- Uncommitted changes → "Commit or stash changes first"
- Not on main → "Switch to main branch first"
- Behind remote → "Pull latest changes first"

### 2. Analyze Changes

```bash
# Find last release tag
git tag --list 'v*' --sort=-version:refname | head -1

# If no v* tags exist, this is the first release
# Get commits since last release (or all commits if first release)
git log <last-tag>..HEAD --oneline
git log <last-tag>..HEAD --stat
```

Review each commit to understand:
- What features were added
- What bugs were fixed
- What breaking changes occurred
- What was refactored or improved

### 3. Determine Version Bump

Apply semantic versioning based on changes:

| Change Type | Bump | Example |
|-------------|------|---------|
| Breaking changes, major rewrites | Major | 1.2.3 → 2.0.0 |
| New features, enhancements | Minor | 1.2.3 → 1.3.0 |
| Bug fixes, minor tweaks, docs | Patch | 1.2.3 → 1.2.4 |

For pre-1.0 projects, treat minor as major and patch as minor.

### 4. Generate Release Notes

Create concise, user-focused notes organized by category:

```markdown
### Added
- New feature X that enables Y

### Changed
- Improved Z for better performance

### Fixed
- Resolved issue where A caused B

### Removed
- Deprecated feature Q
```

Guidelines:
- Focus on user impact, not implementation details
- Group related changes together
- Use active voice and present tense
- Keep each item to one line when possible
- Skip empty categories

### 5. Present for Confirmation

Before making any changes, show the user:
1. Proposed version number
2. Generated changelog entry (full text)
3. Summary of what will happen

Ask: "Ready to create release vX.Y.Z? This will update CHANGELOG.md, commit, tag, push, and create a GitHub Release."

Wait for explicit confirmation before proceeding.

### 6. Update CHANGELOG.md

Prepend new entry using [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

## [X.Y.Z] - YYYY-MM-DD

### Added
...

## [Previous] - Date
...
```

If CHANGELOG.md doesn't exist, create it with header and first entry.

### 7. Commit, Tag, and Push

Execute atomically - if any step fails, inform user:

```bash
git add CHANGELOG.md
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

### 8. Create GitHub Release

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file - <<'EOF'
<release-notes-from-changelog>
EOF
```

Use the exact content from the new CHANGELOG.md entry.

### 9. Confirm Success

Report to user:
- Release vX.Y.Z created successfully
- Link to GitHub Release page
- Link to CHANGELOG.md

## First Release

For projects without existing releases:
- Start at v0.1.0 (or v1.0.0 if production-ready)
- Summarize project capabilities rather than listing every commit
- Create CHANGELOG.md from scratch

## Error Recovery

If release fails partway:
- If commit succeeded but push failed → `git push origin main --tags`
- If push succeeded but gh release failed → `gh release create vX.Y.Z ...`
- If tag exists but release doesn't → delete tag and retry, or create release for existing tag
