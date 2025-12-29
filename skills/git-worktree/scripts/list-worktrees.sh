#!/usr/bin/env bash
set -euo pipefail

# List all worktrees in ~/.worktrees/
# Usage: list-worktrees.sh [repo-name]

WORKTREES_ROOT="$HOME/.worktrees"
FILTER_REPO="${1:-}"

if [[ ! -d "$WORKTREES_ROOT" ]]; then
    echo "No worktrees found. Directory $WORKTREES_ROOT does not exist."
    exit 0
fi

list_repo_worktrees() {
    local repo_dir="$1"
    local repo_name
    repo_name=$(basename "$repo_dir")

    for branch_dir in "$repo_dir"/*; do
        if [[ -d "$branch_dir" ]]; then
            local branch_name
            branch_name=$(basename "$branch_dir")

            # Check if it's a valid worktree
            if [[ -f "$branch_dir/.git" ]]; then
                local status=""

                # Check if worktree is valid (not stale)
                if ! (cd "$branch_dir" && git status &>/dev/null); then
                    status=" (stale)"
                fi

                printf "%-20s %-30s %s%s\n" "$repo_name" "$branch_name" "$branch_dir" "$status"
            fi
        fi
    done
}

echo "REPO                 BRANCH                         PATH"
echo "-------------------- ------------------------------ ----"

for repo_dir in "$WORKTREES_ROOT"/*; do
    if [[ -d "$repo_dir" ]]; then
        repo_name=$(basename "$repo_dir")

        # Apply filter if specified
        if [[ -n "$FILTER_REPO" ]] && [[ "$repo_name" != "$FILTER_REPO" ]]; then
            continue
        fi

        list_repo_worktrees "$repo_dir"
    fi
done
