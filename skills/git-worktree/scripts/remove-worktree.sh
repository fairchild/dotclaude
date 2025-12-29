#!/usr/bin/env bash
set -euo pipefail

# Remove a git worktree and clean up
# Usage: remove-worktree.sh <branch-or-path>

TARGET="${1:-}"
WORKTREES_ROOT="$HOME/.worktrees"

if [[ -z "$TARGET" ]]; then
    echo "Usage: remove-worktree.sh <branch-or-path>"
    echo "  branch-or-path: Branch name (uses current repo) or full worktree path"
    exit 1
fi

# Get repo name from remote URL
get_repo_name() {
    local url
    url=$(git remote get-url origin 2>/dev/null || echo "")
    if [[ -z "$url" ]]; then
        basename "$(git rev-parse --show-toplevel)"
    else
        basename "$url" .git
    fi
}

# Resolve target to full path
if [[ "$TARGET" == /* ]]; then
    # Absolute path provided
    WORKTREE_PATH="$TARGET"
elif [[ "$TARGET" == */* ]]; then
    # Relative path or repo/branch format
    if [[ -d "$TARGET" ]]; then
        WORKTREE_PATH="$TARGET"
    else
        # Assume repo/branch format
        WORKTREE_PATH="$WORKTREES_ROOT/$TARGET"
    fi
else
    # Just branch name - use current repo
    REPO_NAME=$(get_repo_name)
    WORKTREE_PATH="$WORKTREES_ROOT/$REPO_NAME/$TARGET"
fi

if [[ ! -d "$WORKTREE_PATH" ]]; then
    echo "Worktree not found: $WORKTREE_PATH"
    exit 1
fi

# Find the main repo for this worktree
if [[ -f "$WORKTREE_PATH/.git" ]]; then
    MAIN_REPO=$(cat "$WORKTREE_PATH/.git" | sed 's/gitdir: //' | sed 's|/\.git/worktrees/.*||')
else
    echo "Not a valid worktree: $WORKTREE_PATH"
    exit 1
fi

echo "Removing worktree: $WORKTREE_PATH"

# Remove the worktree
(cd "$MAIN_REPO" && git worktree remove "$WORKTREE_PATH" --force)

# Prune stale worktrees
(cd "$MAIN_REPO" && git worktree prune)

# Clean up empty repo directory
REPO_DIR=$(dirname "$WORKTREE_PATH")
if [[ -d "$REPO_DIR" ]] && [[ -z "$(ls -A "$REPO_DIR")" ]]; then
    rmdir "$REPO_DIR"
    echo "Cleaned up empty directory: $REPO_DIR"
fi

echo "Worktree removed successfully."
