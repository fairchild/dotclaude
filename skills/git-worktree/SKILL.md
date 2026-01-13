---
name: git-worktree
description: |
  Manage Git worktrees for concurrent local development. Creates worktrees
  at ~/.worktrees/REPO/BRANCH. Wrapper for the `wt` CLI.
---

# Git Worktree

Manage worktrees for concurrent development without clobbering changes.

## Setup

```bash
# Add to ~/.zshrc
source ~/.claude/skills/git-worktree/scripts/wt.zsh
```

## Usage

```bash
wt <branch>           # Create worktree, run setup, open editor
wt <branch> --no-editor  # Create without opening editor
wt cd <branch>        # Change to worktree directory
wt home               # Return to main repo (or REPOS_ROOT if outside git)
wt archive [branch]   # Run archive script, move to ~/.worktrees/.archive
wt list               # List all worktrees
wt ls                 # Alias for list
wt tree               # Tree view with git status indicators
```

## Environment

```bash
WORKTREES_ROOT=~/.worktrees  # Where worktrees are created
REPOS_ROOT=~/code            # Fallback for `wt home` outside git
```

## Example

```bash
wt feature-auth       # Creates worktree and opens editor
# ... work on feature ...
wt home               # Back to main repo
wt archive feature-auth  # Archive when done (moves to .archive)
```

## conductor.json (Optional)

If your repo has a `conductor.json`, scripts run automatically:

```json
{
  "scripts": {
    "setup": "cp $CONDUCTOR_ROOT_PATH/.env .env && bun install",
    "archive": "git stash"
  }
}
```

## For Claude Code

When user asks to create a worktree, run:

```bash
wt <branch>
```

The script handles branch detection, env file copying, and setup automatically.
Suggest opening the worktree in their editor after creation.
