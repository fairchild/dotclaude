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
source ~/.claude/skills/git-worktree/shell/wt.zsh
```

## Usage

```bash
wt <branch>           # Create worktree, run setup if conductor.json present
wt cd <branch>        # Change to worktree directory
wt home               # Return to main repository
wt archive [branch]   # Run archive script, remove worktree
wt list               # List all worktrees
```

## Example

```bash
wt feature-auth       # Creates ~/.worktrees/myrepo/feature-auth
wt cd feature-auth    # Switch to it
# ... work on feature ...
wt home               # Back to main repo
wt archive feature-auth  # Clean up when done
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
