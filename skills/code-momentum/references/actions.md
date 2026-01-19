# Code Momentum Actions

Detailed workflows for each action.

## Pull

Update repos that are behind their remote.

### Safety Checks
- Skip repos with uncommitted changes
- Only pull if behind (not diverged)

### Workflow

```bash
cd ~/code/$project
git fetch origin

# Check if safe to pull
dirty=$(git status --porcelain | wc -l)
if [[ "$dirty" -gt 0 ]]; then
  echo "Skipping $project - uncommitted changes"
  continue
fi

counts=$(git rev-list --left-right --count HEAD...@{u})
ahead=$(echo "$counts" | awk '{print $1}')
behind=$(echo "$counts" | awk '{print $2}')

if [[ "$ahead" -gt 0 && "$behind" -gt 0 ]]; then
  echo "Skipping $project - diverged (${ahead}↑ ${behind}↓)"
  continue
fi

if [[ "$behind" -gt 0 ]]; then
  git pull --ff-only
fi
```

---

## Forks

Sync forks with their upstream remote.

### Safety Checks
- Skip repos without `upstream` remote
- Skip repos with uncommitted changes
- Only merge if on main/master branch

### Workflow

```bash
cd ~/code/$project

# Check upstream exists
if ! git remote | grep -q upstream; then
  echo "Skipping $project - no upstream remote"
  continue
fi

# Check for uncommitted changes
dirty=$(git status --porcelain | wc -l)
if [[ "$dirty" -gt 0 ]]; then
  echo "Skipping $project - uncommitted changes"
  continue
fi

# Check branch
branch=$(git branch --show-current)
if [[ "$branch" != "main" && "$branch" != "master" ]]; then
  echo "Skipping $project - not on main/master (on $branch)"
  continue
fi

# Fetch and merge
git fetch upstream
git merge upstream/$branch --ff-only
git push origin $branch
```

---

## Deps

Run `/update-dependencies` across multiple projects.

### Workflow

1. List projects with outdated deps (using each ecosystem's check command)
2. Ask user which projects to update
3. For each selected project:
   - Change to project directory
   - Invoke `/update-dependencies`
   - Report outcome

### Detection Commands

| Lockfile | Check Command |
|----------|---------------|
| bun.lock | `bun outdated` |
| pnpm-lock.yaml | `pnpm outdated` |
| package-lock.json | `npm outdated` |
| uv.lock | `uv pip list --outdated` |
| Cargo.lock | `cargo outdated` |

---

## Stash

Stash uncommitted changes in dirty repos.

### Workflow

```bash
cd ~/code/$project

dirty=$(git status --porcelain | wc -l)
if [[ "$dirty" -gt 0 ]]; then
  # Show what's being stashed
  git status --short

  # Stash with descriptive message
  git stash push -m "code-momentum: $(date +%Y-%m-%d)"
  echo "Stashed $dirty files in $project"
fi
```

### Undo

```bash
cd ~/code/$project
git stash pop
```

---

## Status Summary

Quick overview of all projects.

```
| Project         | Branch | Clean | Remote      | Upstream |
|-----------------|--------|-------|-------------|----------|
| beads           | main   | yes   | 584 behind  | yes      |
| jrnlfish-v4     | main   | no    | up-to-date  | no       |
```

Issues requiring attention:
- Dirty repos that block pull/fork sync
- Diverged repos needing manual resolution
- Forks far behind upstream
