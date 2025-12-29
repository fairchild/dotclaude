---
name: git-worktree
description: |
  Manage Git worktrees for concurrent local development. Creates worktrees
  at ~/.worktrees/REPO/BRANCH with automatic setup command detection.
  Use when: (1) creating a worktree for a branch, (2) listing existing
  worktrees, (3) removing old worktrees. Invoke with /worktree.
---

# Git Worktree

Manage worktrees for concurrent development without clobbering changes across terminals.

## Workflow

**Always present a plan before executing.** Show the user:
- Worktree path to be created
- Branch name (new or existing)
- Detected setup command

Wait for confirmation before proceeding.

## Commands

### Create Worktree

```bash
scripts/create-worktree.sh <branch> [base-branch]
```

Creates worktree at `~/.worktrees/<repo>/<branch>`. If branch doesn't exist, creates it from base-branch (default: main).

**Setup detection priority:**
1. `.cursor/environment.json` → `install` field
2. `.devcontainer/devcontainer.json` → `postCreateCommand` field
3. Auto-detect from lockfiles (bun/pnpm/yarn/npm/uv/poetry/etc.)

### List Worktrees

```bash
scripts/list-worktrees.sh [repo-name]
```

Lists all worktrees in `~/.worktrees/`. Optional repo filter.

### Remove Worktree

```bash
scripts/remove-worktree.sh <branch-or-path>
```

Removes worktree and prunes. Accepts branch name (uses current repo) or full path.

## Example Interaction

User: "create a worktree for feature-auth"

Present plan:
```
Plan:
- Create worktree at ~/.worktrees/my-app/feature-auth
- Branch: feature-auth (new, based on main)
- Setup: bun install (detected from bun.lockb)

Proceed? [Y/n]
```

After confirmation, run `create-worktree.sh feature-auth` and report the path.
