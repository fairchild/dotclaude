# Agent Workflow Guidelines

## Git Worktree Workflow

**IMPORTANT**: When starting work on a feature, bug fix, or any task that involves code changes:

1. **Check if you're in the main repository directory** (typically contains `.git` as a directory, not a file)
2. **DO NOT work directly in the main repository**
3. **Use a worktree instead**:
   - Create a new worktree: `git worktree add <path> -b <branch-name>`
   - Or use existing worktree management scripts if available
4. **Change to the worktree directory** before beginning work
5. Work, commit, and push from the worktree
6. When done, return to main repo and clean up the worktree if needed

### Why Worktrees?

- Keeps main repository clean
- Allows multiple features/fixes in parallel
- Safer isolation of changes
- Easier to abandon or reset work without affecting main

### When NOT to Use Worktrees

- Reading/analyzing code only
- Quick documentation updates that don't need testing
- Responding to questions about the codebase

**Default assumption**: If the user asks for code changes, assume they want you to work in a worktree unless explicitly stated otherwise.
