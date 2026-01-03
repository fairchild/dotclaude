---
description: Review health of ~/code projects (git status, tests, remote sync)
---

Review the health of active projects in ~/code.

## Options

Parse the user's invocation for these flags:
- `--test` - Also run test suites for each project
- `--detail` - Show verbose per-project breakdown instead of compact table
- `--all` - Skip project selection, check all projects

## Step 1: Discover Projects

Find active projects in ~/code (directories with `.git` that are NOT in backburner/, references/, worktrees/, or tmp/):

```bash
for dir in ~/code/*/; do
  name=$(basename "$dir")
  case "$name" in
    backburner|references|worktrees|tmp|todos) continue ;;
  esac
  if [ -d "$dir/.git" ]; then
    echo "$name"
  fi
done
```

## Step 2: Project Selection

Unless `--all` was provided, use the AskUserQuestion tool to let the user select which projects to check. Present a multi-select list of discovered projects.

## Step 3: Check Each Project

For each selected project, gather:

**Git status:**
```bash
cd ~/code/$project
git fetch origin 2>/dev/null
branch=$(git branch --show-current)
dirty=$(git status --porcelain)
# Get ahead/behind count relative to upstream
counts=$(git rev-list --left-right --count HEAD...@{u} 2>/dev/null || echo "0 0")
```

**Test command detection** (only if `--test`):
| File | Command |
|------|---------|
| bun.lock | `bun run test` |
| pnpm-lock.yaml | `pnpm test` |
| package-lock.json | `npm test` |
| uv.lock | `uv run pytest` |
| go.mod | `go test ./...` |
| poetry.lock | `poetry run pytest` |

## Step 4: Output Results

**Default (compact table):**

```
| Project         | Branch | Clean | Remote      |
|-----------------|--------|-------|-------------|
| beads           | main   | yes   | up-to-date  |
| jrnlfish-v4     | feat/x | no    | 3 ahead     |
| better-auth     | main   | yes   | 2 behind    |

Issues:
- jrnlfish-v4: uncommitted changes (3 files)
- better-auth: 2 commits behind origin/main
```

**With --test, add Tests column:**

```
| Project         | Branch | Clean | Remote      | Tests |
|-----------------|--------|-------|-------------|-------|
| beads           | main   | yes   | up-to-date  | pass  |
| jrnlfish-v4     | feat/x | no    | 3 ahead     | fail  |
```

**With --detail:**

Show full breakdown per project including:
- List of uncommitted files if dirty
- Full ahead/behind details
- Test output if tests were run

## Remote Sync Status

Interpret the `git rev-list --left-right --count` output:
- `0 0` = up-to-date
- `N 0` = N commits ahead
- `0 N` = N commits behind
- `N M` = diverged (N ahead, M behind)

If no upstream is set, report "no upstream".
