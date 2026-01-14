#!/usr/bin/env bash
set -euo pipefail

# wt - Git worktree manager with conductor.json integration
# Usage: wt <branch> | wt archive [branch] | wt list

WORKTREES_ROOT="${WORKTREES_ROOT:-$HOME/.worktrees}"

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
  <branch> [options]      Create worktree, run setup, open editor
    --no-editor           Don't open editor after creation
    --carry               Copy untracked files to new worktree
  cd <branch>             Change to worktree directory (shell function)
  home                    Return to main repository (shell function)
  archive [branch]        Run conductor archive, move to .archive
  list, ls                List all worktrees
  tree                    Tree view of worktrees with git status

Environment:
  WORKTREES_ROOT     Base directory for worktrees (default: ~/.worktrees)
  REPOS_ROOT         Home for repos when outside git (default: ~/code)
EOF
    exit 1
}

detect_editor() {
    # Return editor command (for execution) and name (for display)
    # Usage: read -r editor editor_name <<< "$(detect_editor)"
    if [[ -n "${EDITOR:-}" ]]; then
        echo "$EDITOR $(basename "$EDITOR")"
    elif command -v cursor &>/dev/null; then
        echo "cursor cursor"
    elif command -v zed &>/dev/null; then
        echo "zed zed"
    elif command -v code &>/dev/null; then
        echo "code code"
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

# --- CARRY MODIFIED FILES (experimental) ---
# Copies modified tracked files to worktree, overwriting clean versions.
# Remove this function and its call site to revert to untracked-only behavior.
carry_modified_files() {
    local worktree_path="$1"
    local repo_root="$2"
    local modified_files
    modified_files=$(cd "$repo_root" && git diff --name-only --diff-filter=M)

    if [[ -z "$modified_files" ]]; then
        return 0
    fi

    local count
    count=$(echo "$modified_files" | wc -l | tr -d ' ')
    log_info "Copying $count modified files..."

    local copied=0
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        mkdir -p "$worktree_path/$(dirname "$file")"
        cp "$repo_root/$file" "$worktree_path/$file"
        ((copied++))
    done <<< "$modified_files"
    log_ok "Carried $copied modified files"
}
# --- END CARRY MODIFIED FILES ---

cmd_create() {
    local branch=""
    local base_branch="main"
    local open_editor=true
    local carry_untracked=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --no-editor)
                open_editor=false
                shift
                ;;
            --carry)
                carry_untracked=true
                shift
                ;;
            *)
                if [[ -z "$branch" ]]; then
                    branch="$1"
                else
                    base_branch="$1"
                fi
                shift
                ;;
        esac
    done

    if [[ -z "$branch" ]]; then
        log_error "Branch name required"
        exit 1
    fi

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

    # Capture untracked files before creating worktree (from repo root for correct paths)
    local untracked_files=""
    if [[ "$carry_untracked" == true ]]; then
        untracked_files=$(cd "$main_repo" && git ls-files --others --exclude-standard)
        if [[ -n "$untracked_files" ]]; then
            local file_count
            file_count=$(echo "$untracked_files" | wc -l | tr -d ' ')
            log_info "Will carry $file_count untracked files"
        fi
    fi

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

    # Copy untracked files if --carry was specified
    if [[ "$carry_untracked" == true ]] && [[ -n "$untracked_files" ]]; then
        log_info "Copying untracked files..."
        local copied=0
        while IFS= read -r file; do
            [[ -z "$file" ]] && continue
            mkdir -p "$worktree_path/$(dirname "$file")"
            cp "$main_repo/$file" "$worktree_path/$file"
            ((copied++))
        done <<< "$untracked_files"
        log_ok "Carried $copied files"
    fi

    # Copy modified tracked files (experimental - see carry_modified_files)
    if [[ "$carry_untracked" == true ]]; then
        carry_modified_files "$worktree_path" "$main_repo"
    fi

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

    # Open editor
    local editor_info editor editor_name
    editor_info=$(detect_editor)
    if [[ -n "$editor_info" ]]; then
        read -r editor editor_name <<< "$editor_info"
    fi

    if [[ "$open_editor" == true ]] && [[ -n "$editor" ]]; then
        log_info "Opening $editor_name..."
        $editor "$worktree_path"
    else
        echo ""
        echo "  wt cd $branch"
        if [[ -n "$editor" ]]; then
            echo "  $editor $worktree_path"
        fi
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
            log_ok "Archive script complete"
        fi
    fi

    log_info "Archiving worktree: $branch"

    # Move to .archive instead of deleting
    local archive_dir="$WORKTREES_ROOT/.archive/$repo_name"
    mkdir -p "$archive_dir"

    # If archive already exists, add timestamp suffix
    local archive_dest="$archive_dir/$branch"
    if [[ -d "$archive_dest" ]]; then
        archive_dest="${archive_dest}-$(date +%Y%m%d-%H%M%S)"
    fi

    mv "$worktree_path" "$archive_dest"

    # Clean up git worktree tracking
    (cd "$main_repo" && git worktree prune)

    # Clean up empty repo directory
    local repo_dir="$WORKTREES_ROOT/$repo_name"
    if [[ -d "$repo_dir" ]] && [[ -z "$(ls -A "$repo_dir")" ]]; then
        rmdir "$repo_dir"
    fi

    log_ok "Archived to: $archive_dest"

    # Print exit hint if we're in the archived directory
    if [[ "$PWD" == "$worktree_path" || "$PWD" == "$worktree_path/"* ]]; then
        echo ""
        log_info "Current directory moved. Run: exit"
    fi
}

cmd_list() {
    local filter_repo="${1:-}"

    if [[ ! -d "$WORKTREES_ROOT" ]]; then
        echo "No worktrees found. Directory $WORKTREES_ROOT does not exist."
        return 0
    fi

    echo "REPO                 BRANCH                         PATH"
    echo "-------------------- ------------------------------ ----"

    for repo_dir in "$WORKTREES_ROOT"/*; do
        [[ -d "$repo_dir" ]] || continue
        local repo_name
        repo_name=$(basename "$repo_dir")

        # Apply filter if specified
        if [[ -n "$filter_repo" ]] && [[ "$repo_name" != "$filter_repo" ]]; then
            continue
        fi

        for branch_dir in "$repo_dir"/*; do
            [[ -d "$branch_dir" ]] || continue
            local branch_name
            branch_name=$(basename "$branch_dir")

            # Check if it's a valid worktree
            [[ -f "$branch_dir/.git" ]] || continue

            local status=""
            if ! (cd "$branch_dir" && git status &>/dev/null); then
                status=" (stale)"
            fi

            printf "%-20s %-30s %s%s\n" "$repo_name" "$branch_name" "$branch_dir" "$status"
        done
    done
}

cmd_tree() {
    if [[ ! -d "$WORKTREES_ROOT" ]]; then
        echo "No worktrees found. Directory $WORKTREES_ROOT does not exist."
        return 0
    fi

    local YELLOW='\033[0;33m'
    local CYAN='\033[0;36m'

    for repo_dir in "$WORKTREES_ROOT"/*; do
        [[ -d "$repo_dir" ]] || continue
        local repo_name
        repo_name=$(basename "$repo_dir")

        echo -e "${CYAN}${repo_name}${NC}"

        # Collect valid worktrees first
        local branches=()
        for branch_dir in "$repo_dir"/*; do
            [[ -d "$branch_dir" ]] || continue
            [[ -f "$branch_dir/.git" ]] || continue
            branches+=("$branch_dir")
        done

        local count=${#branches[@]}
        local i=0
        for branch_dir in "${branches[@]}"; do
            ((i++))
            local branch_name
            branch_name=$(basename "$branch_dir")

            # Use └── for last item, ├── for others
            local connector="├──"
            [[ $i -eq $count ]] && connector="└──"

            # Get git status indicators
            local status_indicator=""
            if (cd "$branch_dir" && git status &>/dev/null); then
                local changes
                changes=$(cd "$branch_dir" && git status --porcelain 2>/dev/null | head -1)
                if [[ -n "$changes" ]]; then
                    status_indicator=" ${YELLOW}*${NC}"
                fi

                # Check for unpushed commits
                local ahead
                ahead=$(cd "$branch_dir" && git rev-list --count @{u}..HEAD 2>/dev/null || echo "0")
                if [[ "$ahead" -gt 0 ]]; then
                    status_indicator="${status_indicator} ${GREEN}↑${ahead}${NC}"
                fi
            else
                status_indicator=" ${RED}(stale)${NC}"
            fi

            echo -e "  ${connector} ${branch_name}${status_indicator}"
        done
    done
}

main() {
    local cmd="${1:-}"

    case "$cmd" in
        ""|--help|-h)
            usage
            ;;
        list|ls)
            shift
            cmd_list "$@"
            ;;
        tree)
            cmd_tree
            ;;
        archive)
            shift
            cmd_archive "${1:-}"
            ;;
        cd|home)
            log_error "wt $cmd requires shell function. Add to ~/.zshrc:"
            echo "  source ~/.claude/skills/git-worktree/scripts/wt.zsh"
            exit 1
            ;;
        *)
            cmd_create "$@"
            ;;
    esac
}

main "$@"
