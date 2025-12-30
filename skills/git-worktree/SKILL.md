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

1. Run `create-worktree.sh --plan <branch>` to get JSON plan
2. Present plan to user in readable format
3. After confirmation, run `create-worktree.sh <branch>` to execute

## Commands

### Create Worktree

```bash
scripts/create-worktree.sh [options] <branch> [base-branch]
```

**Options:**
- `--plan` - Output JSON plan without executing
- `--skip-setup` - Skip running setup command
- `--pr <number>` - Create worktree for existing PR

**Plan output:**
```json
{
  "path": "~/.worktrees/repo/branch",
  "branch": "feature-x",
  "branch_status": "new|local|remote",
  "base_branch": "main",
  "setup_command": "bun install",
  "env_files": [".env", ".dev.vars"],
  "skip_setup": false
}
```

**Env files copied:** `.env`, `.env.local`, `.dev.vars` (if present in main repo)

**Setup detection priority:**
1. `.cursor/environment.json` → `install` field
2. `.devcontainer/devcontainer.json` → `postCreateCommand` field
3. Auto-detect from lockfiles (bun/pnpm/yarn/npm/uv/poetry/etc.)

### List Worktrees

```bash
scripts/list-worktrees.sh [repo-name]
```

### Remove Worktree

```bash
scripts/remove-worktree.sh <branch-or-path>
```

## Example Interaction

User: "create a worktree for feature-auth"

1. Run: `scripts/create-worktree.sh --plan feature-auth`
2. Parse JSON, present to user:
   ```
   Plan:
   - Path: ~/.worktrees/bread-builder/feature-auth
   - Branch: feature-auth (new, from main)
   - Setup: bun install

   Proceed?
   ```
3. After confirmation: `scripts/create-worktree.sh feature-auth`
