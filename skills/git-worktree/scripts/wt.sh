#!/usr/bin/env bash
set -euo pipefail

# wt - Git worktree manager with conductor.json integration
# Usage: wt <branch> | wt archive [branch] | wt list

WORKTREES_ROOT="${WORKTREES_ROOT:-$HOME/.worktrees}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[wt]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[wt]${NC} $1"; }
log_error() { echo -e "${RED}[wt]${NC} $1" >&2; }

usage() {
    cat <<EOF
Usage: wt <command> [args]

Commands:
  <branch>           Create worktree for branch, run conductor setup
  cd <branch>        Change to worktree directory (shell function)
  home               Return to main repository (shell function)
  archive [branch]   Run conductor archive, remove worktree
  list               List all worktrees

Environment:
  WORKTREES_ROOT     Base directory for worktrees (default: ~/.worktrees)
EOF
    exit 1
}

detect_editor() {
    # Check common editor env vars and commands
    if [[ -n "${EDITOR:-}" ]]; then
        basename "$EDITOR"
    elif command -v cursor &>/dev/null; then
        echo "cursor"
    elif command -v zed &>/dev/null; then
        echo "zed"
    elif command -v code &>/dev/null; then
        echo "code"
    else
        echo ""
    fi
}

get_repo_name() {
    local url
    url=$(git remote get-url origin 2>/dev/null || echo "")
    if [[ -z "$url" ]]; then
        basename "$(git rev-parse --show-toplevel)"
    else
        basename "$url" .git
    fi
}

get_main_repo() {
    local git_dir
    git_dir=$(git rev-parse --git-dir 2>/dev/null)

    if [[ -f "$git_dir" ]]; then
        # Inside worktree - .git is a file pointing to main repo
        local gitdir_content
        gitdir_content=$(cat "$git_dir")
        echo "${gitdir_content#gitdir: }" | sed 's|/\.git/worktrees/.*||'
    else
        git rev-parse --show-toplevel
    fi
}

get_conductor_script() {
    local key="$1"
    local conductor_json="$2"

    if [[ -f "$conductor_json" ]] && command -v jq &>/dev/null; then
        jq -r ".scripts.$key // empty" "$conductor_json"
    fi
}

# Environment files to copy from main repo
ENV_FILES=(".env" ".env.local" ".dev.vars")

copy_env_files() {
    local main_repo="$1"
    local worktree_path="$2"
    local copied=()

    for f in "${ENV_FILES[@]}"; do
        if [[ -f "$main_repo/$f" ]]; then
            cp "$main_repo/$f" "$worktree_path/$f"
            copied+=("$f")
        fi
    done

    if [[ ${#copied[@]} -gt 0 ]]; then
        log_info "Copied: ${copied[*]}"
    fi
}

cmd_create() {
    local branch="$1"
    local base_branch="${2:-main}"

    if ! git rev-parse --git-dir &>/dev/null; then
        log_error "Not in a git repository"
        exit 1
    fi

    local main_repo
    main_repo=$(get_main_repo)
    local repo_name
    repo_name=$(get_repo_name)
    local worktree_path="$WORKTREES_ROOT/$repo_name/$branch"
    local conductor_json="$main_repo/conductor.json"

    log_info "Creating worktree: $branch"
    log_info "Path: $worktree_path"

    if [[ -d "$worktree_path" ]]; then
        log_error "Worktree already exists: $worktree_path"
        exit 1
    fi

    mkdir -p "$(dirname "$worktree_path")"

    # Determine branch status and create worktree
    if git show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null; then
        log_info "Using existing local branch"
        (cd "$main_repo" && git worktree add "$worktree_path" "$branch")
    elif git show-ref --verify --quiet "refs/remotes/origin/$branch" 2>/dev/null; then
        log_info "Tracking remote branch"
        (cd "$main_repo" && git worktree add "$worktree_path" "$branch")
    else
        log_info "Creating new branch from $base_branch"
        (cd "$main_repo" && git worktree add -b "$branch" "$worktree_path" "$base_branch")
    fi

    log_ok "Worktree created"

    # Copy env files from main repo
    copy_env_files "$main_repo" "$worktree_path"

    # Run conductor setup if present
    if [[ -f "$conductor_json" ]]; then
        local setup_script
        setup_script=$(get_conductor_script "setup" "$conductor_json")
        if [[ -n "$setup_script" ]]; then
            log_info "Running conductor setup..."
            (
                export CONDUCTOR_ROOT_PATH="$main_repo"
                cd "$worktree_path"
                eval "$setup_script"
            )
            log_ok "Setup complete"
        fi
    fi

    echo ""
    log_ok "Ready: $worktree_path"
    echo ""
    echo "  wt cd $branch"

    local editor
    editor=$(detect_editor)
    if [[ -n "$editor" ]]; then
        echo "  $editor $worktree_path"
    fi
}

cmd_archive() {
    local branch="${1:-}"

    if ! git rev-parse --git-dir &>/dev/null; then
        log_error "Not in a git repository"
        exit 1
    fi

    local repo_name
    repo_name=$(get_repo_name)

    if [[ -z "$branch" ]]; then
        # Try to detect from current directory
        if [[ "$PWD" == "$WORKTREES_ROOT/$repo_name/"* ]]; then
            branch=$(basename "$PWD")
        else
            log_error "Usage: wt archive <branch>"
            exit 1
        fi
    fi

    local worktree_path="$WORKTREES_ROOT/$repo_name/$branch"

    if [[ ! -d "$worktree_path" ]]; then
        log_error "Worktree not found: $worktree_path"
        exit 1
    fi

    # Find main repo from worktree
    local main_repo
    if [[ -f "$worktree_path/.git" ]]; then
        local gitdir_content
        gitdir_content=$(cat "$worktree_path/.git")
        main_repo=$(echo "${gitdir_content#gitdir: }" | sed 's|/\.git/worktrees/.*||')
    else
        log_error "Invalid worktree: $worktree_path"
        exit 1
    fi

    local conductor_json="$main_repo/conductor.json"

    # Run conductor archive if present
    if [[ -f "$conductor_json" ]]; then
        local archive_script
        archive_script=$(get_conductor_script "archive" "$conductor_json")
        if [[ -n "$archive_script" ]]; then
            log_info "Running conductor archive..."
            (
                export CONDUCTOR_ROOT_PATH="$main_repo"
                cd "$worktree_path"
                eval "$archive_script"
            )
            log_ok "Archive complete"
        fi
    fi

    log_info "Removing worktree: $branch"

    (cd "$main_repo" && git worktree remove "$worktree_path" --force)
    (cd "$main_repo" && git worktree prune)

    # Clean up empty repo directory
    local repo_dir="$WORKTREES_ROOT/$repo_name"
    if [[ -d "$repo_dir" ]] && [[ -z "$(ls -A "$repo_dir")" ]]; then
        rmdir "$repo_dir"
    fi

    log_ok "Done"
}

cmd_list() {
    "$SCRIPT_DIR/list-worktrees.sh" "$@"
}

main() {
    local cmd="${1:-}"

    case "$cmd" in
        ""|--help|-h)
            usage
            ;;
        list)
            shift
            cmd_list "$@"
            ;;
        archive)
            shift
            cmd_archive "${1:-}"
            ;;
        cd|home)
            log_error "wt $cmd requires shell function. Add to ~/.zshrc:"
            echo "  source ~/.claude/skills/git-worktree/shell/wt.zsh"
            exit 1
            ;;
        *)
            cmd_create "$@"
            ;;
    esac
}

main "$@"
