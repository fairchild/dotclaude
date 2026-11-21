---
name: git-worktree
description: Start git worktrees the harness-native way and retire them once their work lands, with `wt clean`. Use
  when starting a worktree, when worktrees pile up or ~/.worktrees fills the disk, after pull requests merge, or when
  asked to clean up, remove or archive worktrees.
license: Apache-2.0
---

# Git Worktree

Worktrees keep concurrent work from clobbering each other. The harness makes them; `wt clean` retires them once their
work has landed.

## Starting a worktree

Use what the harness provides, since it also cleans up what it made:

- **A new session in a worktree:** `claude -w <name>` (Claude Code puts it in the repo's `.claude/worktrees/`).
- **Mid-session:** the `EnterWorktree` tool, when the user or project instructions ask for a worktree.
- **A subagent:** `isolation: "worktree"`. It is removed automatically if the agent changed nothing.

When none of those fits, such as a worktree from a specific base, use git directly:

```bash
git worktree add --no-track -b <branch> ~/.worktrees/<repo>/<branch> origin/HEAD
```

Copy any `.env` files the work needs yourself; nothing else does it.

## Retiring worktrees

Paths below are relative to this skill's base directory.

```bash
scripts/wt.sh clean --dry-run   # say what would happen, touch nothing
scripts/wt.sh clean             # retire landed worktrees of the current repo
scripts/wt.sh clean --all       # ...of every repo with a worktree under ~/.worktrees
scripts/wt.sh clean --delete-branch   # also delete their branches, local and remote
scripts/wt.sh archive <name>          # archive one worktree now, landed or not
scripts/wt.sh prune [days] [--yes]    # delete archives older than N days (default 30)
```

`scripts/wt.sh install` adds `wt` to `~/.zshrc`, so a shell can run `wt clean`.

`wt clean` finds worktrees through `git worktree list`, so it covers every worktree of a repo wherever it lives and
whatever made it: an agent's `git worktree add`, Codex, or Claude Code's `.claude/worktrees/`. A worktree is retired
once its HEAD commit has landed, meaning the commit is in origin's default branch or GitHub lists it in a merged pull
request. The pull request lookup is what catches squash merges, detached review checkouts and renamed branches. A clean
worktree is removed. One holding untracked files is archived to `~/.worktrees/.archive/` without its git-ignored files
(dependencies, builds), so the archive stays small.

It leaves a worktree alone when it has uncommitted changes, is locked, has a process running inside it, holds a branch
with no commits of its own yet, or a Claude session wrote there in the last `WT_ACTIVE_MINUTES` (default 120). When
GitHub can't be asked (gh logged out, no network, an agent sandbox), it says so and keeps the worktree. Run it outside
the sandbox: inside it, `gh` can't read its token and `lsof` can't see other processes.

`scripts/test-clean.sh` exercises each of these cases against a throwaway repo.

## What was retired

`wt` used to create worktrees and manage their life: `wt <branch>`, `cd`, `home`, `apply`, `done`, `open`, `list`,
`tree` and `status`. Those commands now print where to go instead. `archive` stays, now matching a worktree by
directory name, branch or path through `git worktree list`; the chronicle dashboard's Archive button uses it. Agents rarely created worktrees through `wt`,
so its cleanup never saw most of them; the harness covers creation, and `wt clean` covers every worktree whatever made
it.
