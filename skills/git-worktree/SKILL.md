---
name: git-worktree
description: Manage Git worktrees for concurrent local development. Creates worktrees
  at ~/.worktrees/REPO/BRANCH. Wrapper for the `wt` CLI.
license: Apache-2.0
---

# Git Worktree

Manage worktrees for concurrent development without clobbering changes.

## Setup

Paths below are relative to this skill's base directory.

```bash
scripts/wt.sh install
source ~/.zshrc
```

## Usage

```bash
wt <branch>              # Create worktree, run setup, open editor
wt <branch> --base ref   # Create from a specific base branch (default: main)
wt <branch> --no-editor  # Create without opening editor
wt <branch> --open       # Also open terminal tab with claude session (macOS)
wt <branch> --carry      # Create and copy work-in-progress files
wt <branch> --context f  # Copy file to .context/handoff.md (session fork)
wt cd <branch>           # Change to worktree directory
wt home                  # Return to main repo (or REPOS_ROOT if outside git)
wt apply [branch]        # Rebase onto branch and merge (default: main)
wt apply --archive       # Merge and archive without prompting
wt apply --push          # Merge and push to remote
wt archive [branch]      # Run archive script, move to ~/.worktrees/.archive
wt archive --delete-branch  # Also delete local and remote branches
wt done                  # Archive current worktree and cd home (shell function)
wt done --delete-branch  # Also delete branches on the way out
wt clean                 # Retire landed worktrees of the current repo
wt clean --all           # ...of every repo with a worktree under WORKTREES_ROOT
wt clean --dry-run       # Say what would happen, touch nothing
wt clean --delete-branch # Also delete branches (local and remote)
wt prune [days] [--yes]  # Delete archives older than N days (default 30)
wt list                  # List all worktrees
wt list --all            # Include worktrees from other sources (.claude, .codex, etc.)
wt ls                    # Alias for list
wt tree                  # Tree view with git status indicators
wt status                # Show worktrees with Claude session activity
wt open [branch]         # Open editor for worktree (current dir if no branch)
wt install               # Add wt to ~/.zshrc (one-time setup)
```

## Worktree Path Convention

Worktrees are created at `~/.worktrees/<repo>/<branch>` where `<repo>` is the **origin remote name** (not the local directory name). This is derived from `git remote get-url origin`.

```
~/.claude  (remote: dotclaude.git)  →  ~/.worktrees/dotclaude/<branch>  <!-- portability: allow -->
~/code/myapp  (remote: myapp.git)  →  ~/.worktrees/myapp/<branch>
```

## Environment

```bash
WORKTREES_ROOT=~/.worktrees  # Where worktrees are created
REPOS_ROOT=~/code            # Fallback for `wt home` outside git
WT_TERMINAL=ghostty          # Terminal for --open (auto-detects from TERM_PROGRAM)
```

## Example

```bash
wt feature-auth       # Creates worktree and opens editor
# ... work on feature ...
wt apply              # Merge into main (prompts to archive)
```

Or archive from within the worktree when you're done:

```bash
wt feature-auth       # Creates worktree and opens editor
# ... work on feature ...
wt done               # Archive and cd home in one step
wt done --delete-branch  # Same, but also delete the branch
```

## Cleaning Up

`wt clean` finds worktrees through `git worktree list`, so it covers every worktree of a repo wherever it lives and
whatever made it: `wt`, an agent's `git worktree add`, Codex, or Claude Code's `.claude/worktrees/`. A worktree is
retired once its HEAD commit has landed, meaning the commit is in origin's default branch or GitHub lists it in a
merged pull request. The pull request lookup is what catches squash merges, detached review checkouts and renamed
branches. A clean worktree is removed. One holding untracked files is archived without its git-ignored files
(dependencies, builds), so the archive stays small.

It leaves a worktree alone when it has uncommitted changes, is locked, has a process running inside it, or a Claude
session wrote there in the last `WT_ACTIVE_MINUTES` (default 120). When GitHub can't be asked (gh logged out, no
network, an agent sandbox), it says so and keeps the worktree. Run it outside the sandbox: inside it, `gh` can't read
its token and `lsof` can't see other processes.

`scripts/test-clean.sh` exercises each of these cases against a throwaway repo.

## Carrying Work in Progress

When you've been exploring and decide it should be its own branch:

```bash
# You're in main with untracked files and modifications...
wt feature-x --carry  # Creates worktree with those files copied over
```

Copies untracked files to the new worktree. Works from any branch.

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
