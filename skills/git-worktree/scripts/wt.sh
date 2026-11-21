#!/usr/bin/env bash
set -euo pipefail

# wt - Git worktree manager with conductor.json integration
# Usage: wt <branch> | wt archive [branch] | wt list

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

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
    --base <branch>       Base branch (default: main)
    --no-editor           Don't open editor after creation
    --carry               Copy untracked files to new worktree
    --context <file>      Copy file to .context/handoff.md (for session forking)
    --open                Open new terminal tab with claude session (macOS)
    --launch-cmd <cmd>    Open new terminal tab and run command (macOS)
  cd <branch>             Change to worktree directory (shell function)
  home                    Return to main repository (shell function)
  apply [branch] [opts]   Rebase onto branch and merge (default: main)
    --archive             Archive worktree after merge without prompting
    --push                Push to remote after merge
  archive [branch]        Run conductor archive, move to .archive (git-ignored
                          files such as node_modules are dropped)
    --delete-branch       Also delete local and remote branches
  done [options]          Archive current worktree and cd home (shell function)
    --delete-branch       Also delete local and remote branches
  clean                   Retire worktrees whose commit has landed (in origin's
                          default branch or a merged pull request), wherever they
                          live; remove clean ones, archive ones with untracked files
    --all                 Every repo with a worktree under WORKTREES_ROOT
                          (default: the current repo)
    --dry-run             List what would happen
    --delete-branch       Also delete branches
  prune [days] [--yes]    Delete archives older than N days (default: 30)
  list, ls                List all worktrees
    --all                 Include worktrees from other sources
  tree                    Tree view of worktrees with git status
  status                  Show all worktrees with session activity
  open [branch]           Open editor for worktree (current or specified)
  install                 Add wt to ~/.zshrc (one-time setup)

Environment:
  WORKTREES_ROOT     Base directory for worktrees (default: ~/.worktrees)
  REPOS_ROOT         Home for repos when outside git (default: ~/code)
  WT_TERMINAL        Terminal app for --open/--launch-cmd (default: auto-detect)
                     Values: ghostty, iTerm2, Terminal (auto-detects from TERM_PROGRAM)
EOF
    exit 1
}

detect_editor() {
    # Return "editor_command|editor_name" for parsing
    # Usage: IFS='|' read -r editor editor_name <<< "$(detect_editor)"
    if [[ -n "${EDITOR:-}" ]]; then
        # Handle EDITOR with flags like "zed --wait"
        local editor_cmd="${EDITOR%% *}"  # First word
        local editor_name
        editor_name=$(basename "$editor_cmd")
        echo "${EDITOR}|${editor_name}"
    elif command -v cursor &>/dev/null; then
        echo "cursor|cursor"
    elif command -v zed &>/dev/null; then
        echo "zed|zed"
    elif command -v code &>/dev/null; then
        echo "code|code"
    else
        echo ""
    fi
}

open_terminal_tab() {
    local dir="$1"
    local cmd="${2:-}"

    if [[ "$(uname)" != "Darwin" ]]; then
        log_error "Terminal tabs: macOS only"
        return 1
    fi

    local full_cmd="cd '$dir'"
    [[ -n "$cmd" ]] && full_cmd="$full_cmd && $cmd"

    # WT_TERMINAL overrides auto-detection from TERM_PROGRAM
    local terminal="${WT_TERMINAL:-${TERM_PROGRAM:-Terminal}}"

    case "$terminal" in
        ghostty)
            # Save and restore clipboard to avoid clobbering user data
            local old_clip
            old_clip=$(pbpaste 2>/dev/null || true)

            # Use clipboard + paste — atomic, handles special chars
            echo -n "$full_cmd" | pbcopy
            osascript <<'ASCRIPT'
tell application "Ghostty" to activate
delay 0.3
tell application "System Events" to tell process "Ghostty"
    keystroke "n" using command down
    delay 0.5
    keystroke "v" using command down
    delay 0.1
    key code 36
end tell
ASCRIPT
            # Restore previous clipboard after a brief delay
            (sleep 1 && echo -n "$old_clip" | pbcopy) &
            ;;
        iTerm*)
            osascript \
                -e 'tell application "iTerm" to tell current window to create tab with default profile' \
                -e "tell application \"iTerm\" to tell current session of current window to write text \"$full_cmd\""
            ;;
        *)
            osascript \
                -e 'tell application "Terminal" to activate' \
                -e "tell application \"Terminal\" to do script \"$full_cmd\""
            ;;
    esac
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
    local branch=""
    local base_branch="main"
    local open_editor=true
    local carry_untracked=false
    local context_file=""
    local launch_cmd=""
    local open_session=false

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
            --context)
                shift
                context_file="$1"
                shift
                ;;
            --base)
                shift
                base_branch="$1"
                shift
                ;;
            --open)
                open_session=true
                shift
                ;;
            --launch-cmd)
                shift
                launch_cmd="$1"
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

    # Run conductor setup if present, otherwise copy env files
    # (setup scripts typically handle env files themselves, e.g., via symlinks)
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
        else
            # No setup script, copy env files as fallback
            copy_env_files "$main_repo" "$worktree_path"
        fi
    else
        # No conductor.json, copy env files as fallback
        copy_env_files "$main_repo" "$worktree_path"
    fi

    # Copy context/handoff file if provided (for session forking)
    if [[ -n "$context_file" ]] && [[ -f "$context_file" ]]; then
        mkdir -p "$worktree_path/.context"
        cp "$context_file" "$worktree_path/.context/handoff.md"
        log_info "Context: .context/handoff.md"
    fi

    echo ""
    log_ok "Ready: $worktree_path"

    # Open editor
    local editor_info editor editor_name
    editor_info=$(detect_editor)
    if [[ -n "$editor_info" ]]; then
        IFS='|' read -r editor editor_name <<< "$editor_info"
    fi

    # --open: build launch_cmd for an interactive claude session (before hints block)
    if [[ "$open_session" == true ]] && [[ -z "$launch_cmd" ]]; then
        if [[ -f "$worktree_path/.context/handoff.md" ]]; then
            launch_cmd="claude 'Read .context/handoff.md and continue the work described there.'"
        else
            launch_cmd="claude"
        fi
    fi

    if [[ "$open_editor" == true ]] && [[ -n "$editor" ]]; then
        log_info "Opening $editor_name..."
        $editor "$worktree_path"
    else
        # Skip hints if launch_cmd will handle the transition
        if [[ -z "$launch_cmd" ]]; then
            echo ""
            echo "  wt cd $branch"
            if [[ -n "$editor" ]]; then
                echo "  $editor $worktree_path"
            fi
        fi
    fi

    # Launch command in new terminal tab if specified
    if [[ -n "$launch_cmd" ]]; then
        log_info "Opening terminal tab..."
        open_terminal_tab "$worktree_path" "$launch_cmd"
    fi
}

_remove_empty_parents() {
    local dir="$1"
    while [[ "$dir" == "$WORKTREES_ROOT/"* ]] && [[ -d "$dir" ]] && [[ -z "$(ls -A "$dir")" ]]; do
        rmdir "$dir"
        dir=$(dirname "$dir")
    done
}

# Move a worktree into .archive. Git-ignored files (dependencies, build output,
# copied env files) stay behind: they regenerate, and they are most of the size.
_archive_path() {
    local worktree_path="$1" repo="$2" repo_name="$3" name="$4"
    git -C "$worktree_path" clean -fdXq 2>/dev/null || true
    local archive_dest="$WORKTREES_ROOT/.archive/$repo_name/$name"
    [[ -e "$archive_dest" ]] && archive_dest="${archive_dest}-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$(dirname "$archive_dest")"
    mv "$worktree_path" "$archive_dest"
    git -C "$repo" worktree prune
    _remove_empty_parents "$(dirname "$worktree_path")"
    log_ok "Archived to: $archive_dest"
}

cmd_archive() {
    local branch=""
    local delete_branch=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --delete-branch) delete_branch=true; shift ;;
            *) [[ -z "$branch" ]] && branch="$1"; shift ;;
        esac
    done

    if ! git rev-parse --git-dir &>/dev/null; then
        log_error "Not in a git repository"
        exit 1
    fi

    local repo_name
    repo_name=$(get_repo_name)

    if [[ -z "$branch" ]]; then
        # Detect from current worktree using git (handles slashed branches)
        if [[ "$PWD" == "$WORKTREES_ROOT/$repo_name/"* ]]; then
            branch=$(git branch --show-current 2>/dev/null) || true
            if [[ -z "$branch" ]]; then
                log_error "Cannot detect branch. Specify explicitly: wt archive <branch>"
                exit 1
            fi
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
    _archive_path "$worktree_path" "$main_repo" "$repo_name" "$branch"

    # Delete branches if requested
    if [[ "$delete_branch" == true ]]; then
        log_info "Deleting local branch: $branch"
        (cd "$main_repo" && git branch -D "$branch" 2>/dev/null) || true
        log_info "Deleting remote branch: $branch"
        (cd "$main_repo" && git push origin --delete "$branch" 2>/dev/null) || true
    fi

    # Print exit hint if we're in the archived directory
    if [[ "$PWD" == "$worktree_path" || "$PWD" == "$worktree_path/"* ]]; then
        echo ""
        log_info "Current directory moved. Run: exit"
    fi
}

cmd_apply() {
    local target_branch="main"
    local auto_archive=false
    local push_after=false

    local target_set=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --archive)
                auto_archive=true
                shift
                ;;
            --push)
                push_after=true
                shift
                ;;
            *)
                if [[ "$target_set" == true ]]; then
                    log_error "Too many arguments. Usage: wt apply [branch] [--archive] [--push]"
                    exit 1
                fi
                target_branch="$1"
                target_set=true
                shift
                ;;
        esac
    done

    # Must be in a git repo
    if ! git rev-parse --git-dir &>/dev/null; then
        log_error "Not in a git repository"
        exit 1
    fi

    # Must be in a worktree (not main repo)
    local git_dir
    git_dir=$(git rev-parse --git-dir)
    if [[ ! -f "$git_dir" ]]; then
        log_error "Not in a worktree. Run from within a worktree directory."
        exit 1
    fi

    # Get current branch
    local current_branch
    current_branch=$(git branch --show-current)
    if [[ -z "$current_branch" ]]; then
        log_error "Cannot determine current branch"
        exit 1
    fi

    # Check for uncommitted changes
    if ! git diff --quiet || ! git diff --cached --quiet; then
        log_error "Uncommitted changes in worktree. Commit or stash first."
        exit 1
    fi

    local main_repo
    main_repo=$(get_main_repo)

    log_info "Applying $current_branch → $target_branch"

    # Rebase onto target to ensure ff-merge will work
    # (no-op if already up to date, otherwise replays commits on top of target)
    log_info "Rebasing onto $target_branch..."
    if ! git rebase "$target_branch"; then
        log_error "Rebase failed. Resolve conflicts, then run:"
        echo "  git rebase --continue"
        echo "  wt apply"
        exit 1
    fi

    # Switch to main repo and target branch
    if ! (cd "$main_repo" && git switch "$target_branch" 2>/dev/null); then
        log_error "Cannot switch to $target_branch in main repo"
        exit 1
    fi

    # Fast-forward merge (guaranteed to work after rebase)
    if ! (cd "$main_repo" && git merge --ff-only -- "$current_branch"); then
        log_error "Unexpected: ff-merge failed after rebase"
        (cd "$main_repo" && git switch - &>/dev/null)
        exit 1
    fi

    log_ok "Merged $current_branch into $target_branch"

    # Push if requested
    if [[ "$push_after" == true ]]; then
        log_info "Pushing to remote..."
        if ! (cd "$main_repo" && git push); then
            log_error "Push failed (merge completed locally)"
            exit 1
        fi
        log_ok "Pushed to remote"
    fi

    # Archive handling
    if [[ "$auto_archive" == true ]]; then
        cmd_archive "$current_branch"
    else
        echo ""
        read -p "[wt] Archive worktree '$current_branch'? [y/N] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            cmd_archive "$current_branch"
        else
            local repo_name
            repo_name=$(get_repo_name)
            log_info "Worktree kept at: $WORKTREES_ROOT/$repo_name/$current_branch"
        fi
    fi
}

cmd_list() {
    local filter_repo=""
    local show_all=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --all) show_all=true; shift ;;
            *) filter_repo="$1"; shift ;;
        esac
    done

    if [[ ! -d "$WORKTREES_ROOT" ]]; then
        echo "No worktrees found. Directory $WORKTREES_ROOT does not exist."
        return 0
    fi

    echo "REPO                 BRANCH                         PATH"
    echo "-------------------- ------------------------------ ----"

    local -a seen_main_repos=()

    for repo_dir in "$WORKTREES_ROOT"/*; do
        [[ -d "$repo_dir" ]] || continue
        [[ "$(basename "$repo_dir")" != "."* ]] || continue
        local repo_name
        repo_name=$(basename "$repo_dir")

        if [[ -n "$filter_repo" ]] && [[ "$repo_name" != "$filter_repo" ]]; then
            continue
        fi

        while IFS= read -r git_file; do
            local branch_dir
            branch_dir=$(dirname "$git_file")
            local branch_name
            branch_name=$(git -C "$branch_dir" branch --show-current 2>/dev/null || echo "${branch_dir#$repo_dir/}")

            local status=""
            if ! (cd "$branch_dir" && git status &>/dev/null); then
                status=" (stale)"
            fi

            printf "%-20s %-30s %s%s\n" "$repo_name" "$branch_name" "$branch_dir" "$status"

            # Track main repos for --all
            if [[ "$show_all" == true ]] && [[ -f "$git_file" ]]; then
                local gitdir_content main_repo already_seen=false
                gitdir_content=$(cat "$git_file")
                main_repo=$(echo "${gitdir_content#gitdir: }" | sed 's|/\.git/worktrees/.*||')
                for seen in "${seen_main_repos[@]:-}"; do
                    [[ "$seen" == "$main_repo" ]] && already_seen=true && break
                done
                [[ "$already_seen" == false ]] && seen_main_repos+=("$main_repo")
            fi
        done < <(find "$repo_dir" -name ".git" -type f 2>/dev/null)
    done

    # Show worktrees from other sources if --all
    if [[ "$show_all" == true ]] && [[ ${#seen_main_repos[@]} -gt 0 ]]; then
        for main_repo in "${seen_main_repos[@]}"; do
            local main_repo_name
            main_repo_name=$(basename "$main_repo")
            while IFS= read -r line; do
                if [[ "$line" == "worktree "* ]]; then
                    local wt_path="${line#worktree }"
                    [[ "$wt_path" == "$WORKTREES_ROOT/"* ]] && continue
                    [[ "$wt_path" == "$main_repo" ]] && continue

                    local source="other"
                    case "$wt_path" in
                        */.claude/worktrees/*) source=".claude" ;;
                        */.cline/worktrees/*) source=".cline" ;;
                        */.codex/worktrees/*) source=".codex" ;;
                        */conductor/*) source="conductor" ;;
                    esac
                    local wt_branch
                    wt_branch=$(git -C "$wt_path" branch --show-current 2>/dev/null || basename "$wt_path")
                    printf "%-20s %-30s %s [%s]\n" "$main_repo_name" "$wt_branch" "$wt_path" "$source"
                fi
            done < <(git -C "$main_repo" worktree list --porcelain 2>/dev/null)
        done
    fi
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
        [[ "$(basename "$repo_dir")" != "."* ]] || continue
        local repo_name
        repo_name=$(basename "$repo_dir")

        echo -e "${CYAN}${repo_name}${NC}"

        # Collect valid worktrees via find (handles slashed branches)
        local branches=()
        while IFS= read -r git_file; do
            branches+=("$(dirname "$git_file")")
        done < <(find "$repo_dir" -name ".git" -type f 2>/dev/null)

        local count=${#branches[@]}
        local i=0
        for branch_dir in "${branches[@]}"; do
            ((i++))
            local branch_name
            branch_name=$(git -C "$branch_dir" branch --show-current 2>/dev/null || echo "${branch_dir#$repo_dir/}")

            local connector="├──"
            [[ $i -eq $count ]] && connector="└──"

            local status_indicator=""
            if (cd "$branch_dir" && git status &>/dev/null); then
                local changes
                changes=$(cd "$branch_dir" && git status --porcelain 2>/dev/null | head -1)
                if [[ -n "$changes" ]]; then
                    status_indicator=" ${YELLOW}*${NC}"
                fi

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

cmd_status() {
    if [[ ! -d "$WORKTREES_ROOT" ]]; then
        echo "No worktrees found."
        return 0
    fi

    local YELLOW='\033[0;33m'

    echo ""
    echo -e "${BLUE}WORKTREES${NC}"
    echo "════════════════════════════════════════════════════════════"

    for repo_dir in "$WORKTREES_ROOT"/*; do
        [[ -d "$repo_dir" ]] || continue
        [[ "$(basename "$repo_dir")" != "."* ]] || continue

        while IFS= read -r git_file; do
            local branch_dir
            branch_dir=$(dirname "$git_file")
            local branch_name
            branch_name=$(git -C "$branch_dir" branch --show-current 2>/dev/null || echo "${branch_dir#$repo_dir/}")
            local git_branch="$branch_name"

            local changes
            changes=$(git -C "$branch_dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
            local status_text="clean"
            [[ "$changes" -gt 0 ]] && status_text="${changes} files"

            local encoded_path
            encoded_path=$(echo "$branch_dir" | sed 's|[/.]|-|g')
            # Reads the invoking user's own Claude Code session logs (prerequisite: Claude Code)
            local claude_dir="$HOME/.claude/projects/$encoded_path"  # portability: allow
            local session_indicator="○"
            local age_text=""

            if [[ -d "$claude_dir" ]]; then
                local newest_mtime
                newest_mtime=$(stat -f %m "$claude_dir"/*.jsonl 2>/dev/null | sort -rn | head -1)
                if [[ -n "$newest_mtime" ]]; then
                    local now
                    now=$(date +%s)
                    local age_minutes=$(( (now - newest_mtime) / 60 ))

                    if [[ $age_minutes -lt 5 ]]; then
                        session_indicator="${GREEN}●${NC}"
                        age_text="${age_minutes}m"
                    elif [[ $age_minutes -lt 60 ]]; then
                        session_indicator="${YELLOW}◐${NC}"
                        age_text="${age_minutes}m"
                    else
                        local age_hours=$(( age_minutes / 60 ))
                        age_text="${age_hours}h"
                    fi
                fi
            fi

            printf "%b %-20s %-20s %8s   %s\n" \
                "$session_indicator" "$branch_name" "$git_branch" "$age_text" "$status_text"
        done < <(find "$repo_dir" -name ".git" -type f 2>/dev/null)
    done
    echo ""
}

cmd_open() {
    local branch="${1:-}"

    # If no branch specified, try current directory
    if [[ -z "$branch" ]]; then
        if [[ "$PWD" == "$WORKTREES_ROOT/"* ]]; then
            local editor_info
            editor_info=$(detect_editor)
            if [[ -n "$editor_info" ]]; then
                local editor editor_name
                IFS='|' read -r editor editor_name <<< "$editor_info"
                log_info "Opening $editor_name..."
                $editor "$PWD"
            else
                log_error "No editor found"
                return 1
            fi
            return 0
        else
            log_error "Usage: wt open [branch]"
            return 1
        fi
    fi

    # Find worktree by branch name
    if ! git rev-parse --git-dir &>/dev/null; then
        log_error "Not in a git repository"
        return 1
    fi

    local repo_name
    repo_name=$(get_repo_name)
    local worktree_path="$WORKTREES_ROOT/$repo_name/$branch"

    if [[ ! -d "$worktree_path" ]]; then
        log_error "Worktree not found: $worktree_path"
        return 1
    fi

    local editor_info
    editor_info=$(detect_editor)
    if [[ -n "$editor_info" ]]; then
        local editor editor_name
        IFS='|' read -r editor editor_name <<< "$editor_info"
        log_info "Opening $editor_name at $worktree_path"
        $editor "$worktree_path"
    else
        log_error "No editor found. Set \$EDITOR or install cursor/zed/code"
        return 1
    fi
}

# --- clean -------------------------------------------------------------------
# A worktree is retired once its HEAD commit has landed: the commit is in
# origin's default branch, or GitHub lists it in a merged pull request, which
# covers squash merges, detached review checkouts and renamed branches.
# Worktrees are found through `git worktree list`, so where they live and what
# made them (wt, an agent's `git worktree add`, a harness) doesn't matter.
# A clean worktree is removed; one holding untracked files is archived.

WT_ACTIVE_MINUTES="${WT_ACTIVE_MINUTES:-120}"

CLEAN_DRY=false
CLEAN_DELETE_BRANCH=false
CLEAN_REMOVE=0
CLEAN_ARCHIVE=0
CLEAN_SKIP=0
CLEAN_UNKNOWN=0
CLEAN_UNMERGED=0

_default_ref() {
    local repo="$1" ref
    if ref=$(git -C "$repo" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null); then
        echo "$ref"
        return 0
    fi
    for ref in origin/main origin/master main master; do
        if git -C "$repo" rev-parse -q --verify "$ref^{commit}" >/dev/null 2>&1; then
            echo "$ref"
            return 0
        fi
    done
    return 0
}

# Prints merged, unmerged, none, or error:<reason>
_pr_state() {
    local worktree="$1" sha="$2" out
    if ! git -C "$worktree" remote get-url origin >/dev/null 2>&1; then
        echo "none"
        return 0
    fi
    if ! command -v gh >/dev/null 2>&1; then
        echo "error:gh is not installed"
        return 0
    fi
    if out=$(cd "$worktree" && gh api "repos/{owner}/{repo}/commits/$sha/pulls" \
        --jq 'if any(.[]; .merged_at != null) then "merged" elif length > 0 then "unmerged" else "none" end' 2>&1); then
        echo "$out"
    elif [[ "$out" == *"No commit found"* || "$out" == *"none of the git remotes"* ]]; then
        echo "none"
    else
        echo "error:$(echo "$out" | head -1)"
    fi
    return 0
}

_minutes_since_session() {
    local dir newest
    dir="$HOME/.claude/projects/$(echo "$1" | sed 's|[^a-zA-Z0-9]|-|g')"  # portability: allow
    [[ -d "$dir" ]] || return 0
    newest=$( (stat -f %m "$dir"/*.jsonl 2>/dev/null || stat -c %Y "$dir"/*.jsonl 2>/dev/null) | sort -rn | head -1) || true
    [[ -n "$newest" ]] && echo $(( ($(date +%s) - newest) / 60 ))
    return 0
}

CLEAN_CWDS=""

# Every process's working directory, as "pid<TAB>command<TAB>cwd" lines
_load_process_cwds() {
    command -v lsof >/dev/null 2>&1 || return 0
    CLEAN_CWDS=$(lsof -w -d cwd -Fpcn 2>/dev/null |
        awk '/^p/{p=substr($0,2)} /^c/{c=substr($0,2)} /^n/{print p "\t" c "\t" substr($0,2)}') || true
    return 0
}

_process_in() {
    [[ -n "$CLEAN_CWDS" ]] || return 0
    printf '%s\n' "$CLEAN_CWDS" |
        awk -F'\t' -v d="$1" '$3 == d || index($3, d "/") == 1 {print $2 " (pid " $1 ")"; exit}'
    return 0
}

_repo_label() {
    local path="$1" repo="$2" rel
    if [[ "$path" == "$WORKTREES_ROOT/"* ]]; then
        rel="${path#"$WORKTREES_ROOT"/}"
        echo "${rel%%/*}"
    else
        basename "${repo%/.git}" .git
    fi
}

_clean_skip() {
    log_info "skip     $1  ($2)"
    CLEAN_SKIP=$((CLEAN_SKIP + 1))
}

_clean_one() {
    local repo="$1" default_ref="$2" path="$3" sha="$4" branch="$5" locked="$6" prunable="$7"
    local label name id
    label=$(_repo_label "$path" "$repo")
    if [[ "$path" == "$WORKTREES_ROOT/$label/"* ]]; then
        name="${path#"$WORKTREES_ROOT/$label"/}"
        id="$label/$name"
    else
        name=$(basename "$path")
        id="$path"
        [[ "$path" == "$HOME/"* ]] && id="~/${path#"$HOME"/}"
    fi

    if [[ "$prunable" == true || ! -d "$path" ]]; then
        log_info "prune    $id  (directory is gone)"
        [[ "$CLEAN_DRY" == true ]] || git -C "$repo" worktree prune
        return 0
    fi
    if [[ "$locked" == true ]]; then
        _clean_skip "$id" "locked"
        return 0
    fi
    if [[ -n "$branch" ]]; then
        case "$branch" in
            main|master|develop|"${default_ref#origin/}") return 0 ;;
        esac
    fi

    local proc mins
    proc=$(_process_in "$path")
    if [[ -n "$proc" ]]; then
        _clean_skip "$id" "$proc is running in it"
        return 0
    fi
    mins=$(_minutes_since_session "$path")
    if [[ -n "$mins" ]] && (( mins < WT_ACTIVE_MINUTES )); then
        _clean_skip "$id" "a Claude session wrote here ${mins}m ago"
        return 0
    fi
    if [[ -n "$(git -C "$path" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
        _clean_skip "$id" "uncommitted changes"
        return 0
    fi

    local why state
    if [[ -n "$default_ref" ]] && git -C "$repo" merge-base --is-ancestor "$sha" "$default_ref" 2>/dev/null; then
        why="in $default_ref"
    else
        state=$(_pr_state "$path" "$sha")
        case "$state" in
            merged) why="in a merged pull request" ;;
            error:*)
                CLEAN_UNKNOWN=$((CLEAN_UNKNOWN + 1))
                _clean_skip "$id" "could not ask GitHub: ${state#error:}"
                return 0
                ;;
            *)
                CLEAN_UNMERGED=$((CLEAN_UNMERGED + 1))
                return 0
                ;;
        esac
    fi

    local ref="${branch:-detached at ${sha:0:8}}" untracked
    untracked=$(git -C "$path" ls-files --others --exclude-standard | wc -l | tr -d ' ')
    if [[ "$untracked" -gt 0 ]]; then
        log_info "archive  $id  ($ref, $why; keeps $untracked untracked file(s))"
        CLEAN_ARCHIVE=$((CLEAN_ARCHIVE + 1))
        [[ "$CLEAN_DRY" == true ]] || _archive_path "$path" "$repo" "$label" "$name"
    else
        log_info "remove   $id  ($ref, $why)"
        CLEAN_REMOVE=$((CLEAN_REMOVE + 1))
        if [[ "$CLEAN_DRY" == false ]]; then
            if ! git -C "$repo" worktree remove "$path"; then
                log_error "git refused to remove $path"
                return 0
            fi
            _remove_empty_parents "$(dirname "$path")"
        fi
    fi

    if [[ "$CLEAN_DRY" == false && "$CLEAN_DELETE_BRANCH" == true && -n "$branch" ]]; then
        git -C "$repo" branch -D "$branch" >/dev/null 2>&1 && log_info "deleted branch $branch" || true
        git -C "$repo" push origin --delete "$branch" >/dev/null 2>&1 || true
    fi
    return 0
}

cmd_clean() {
    local scan_all=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --all|--all-sources) scan_all=true; shift ;;
            --dry-run) CLEAN_DRY=true; shift ;;
            --delete-branch) CLEAN_DELETE_BRANCH=true; shift ;;
            *) log_error "Unknown option: $1"; exit 1 ;;
        esac
    done

    # git reports physical paths; match them against a physical root
    [[ -d "$WORKTREES_ROOT" ]] && WORKTREES_ROOT=$(cd "$WORKTREES_ROOT" && pwd -P)

    local found=() orphans=() f d common
    if git rev-parse --git-dir &>/dev/null; then
        found+=("$(git rev-parse --path-format=absolute --git-common-dir)")
    elif [[ "$scan_all" == false ]]; then
        log_error "Not in a git repository. Use --all to scan $WORKTREES_ROOT"
        exit 1
    fi
    if [[ "$scan_all" == true && -d "$WORKTREES_ROOT" ]]; then
        while IFS= read -r f; do
            d=$(dirname "$f")
            if common=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
                found+=("$common")
            else
                orphans+=("$d")
            fi
        done < <(find "$WORKTREES_ROOT" -mindepth 2 \
            \( -name .archive -o -name node_modules -o -name .venv -o -name target \) -prune \
            -o -name .git -type f -print 2>/dev/null)
    fi

    _load_process_cwds

    local repo line path sha branch locked prunable first default_ref
    while IFS= read -r repo; do
        [[ -n "$repo" ]] || continue
        default_ref=$(_default_ref "$repo")
        path="" sha="" branch="" locked=false prunable=false first=true
        while IFS= read -r line; do
            case "$line" in
                "worktree "*) path="${line#worktree }" ;;
                "HEAD "*) sha="${line#HEAD }" ;;
                "branch "*) branch="${line#branch refs/heads/}" ;;
                locked*) locked=true ;;
                prunable*) prunable=true ;;
                "")
                    if [[ "$first" == true ]]; then
                        first=false
                    elif [[ -n "$path" ]]; then
                        _clean_one "$repo" "$default_ref" "$path" "$sha" "$branch" "$locked" "$prunable" </dev/null
                    fi
                    path="" sha="" branch="" locked=false prunable=false
                    ;;
            esac
        done < <(git -C "$repo" worktree list --porcelain; echo)
    done < <(printf '%s\n' ${found[@]+"${found[@]}"} | sort -u)

    for d in ${orphans[@]+"${orphans[@]}"}; do
        log_info "orphan   ${d#"$WORKTREES_ROOT"/}  (its .git points at a repository that is gone; left alone)"
    done

    echo ""
    if [[ "$CLEAN_DRY" == true ]]; then
        log_ok "Would remove $CLEAN_REMOVE and archive $CLEAN_ARCHIVE. Skipped $CLEAN_SKIP; $CLEAN_UNMERGED not merged."
    else
        log_ok "Removed $CLEAN_REMOVE and archived $CLEAN_ARCHIVE. Skipped $CLEAN_SKIP; $CLEAN_UNMERGED not merged."
    fi
    if [[ $CLEAN_UNKNOWN -gt 0 ]]; then
        log_error "$CLEAN_UNKNOWN worktree(s) could not be checked against GitHub and were left alone. Check: gh auth status"
    fi
}

cmd_prune() {
    local days=30 assume_yes=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes|-y) assume_yes=true; shift ;;
            *) days="$1"; shift ;;
        esac
    done
    local archive_root="$WORKTREES_ROOT/.archive"

    if [[ ! -d "$archive_root" ]]; then
        log_ok "No archives to prune"
        return 0
    fi

    # Find archived worktrees (directories containing a .git file)
    local candidates=()
    local candidate_ages=()

    while IFS= read -r git_file; do
        local archive_dir
        archive_dir=$(dirname "$git_file")
        # stat -f %m on macOS gives mtime in epoch seconds
        local mtime
        mtime=$(stat -f %m "$archive_dir" 2>/dev/null || stat -c %Y "$archive_dir" 2>/dev/null)
        local now
        now=$(date +%s)
        local age_days=$(( (now - mtime) / 86400 ))

        if [[ $age_days -ge $days ]]; then
            candidates+=("$archive_dir")
            candidate_ages+=("$age_days")
        fi
    done < <(find "$archive_root" -name ".git" -type f 2>/dev/null)

    if [[ ${#candidates[@]} -eq 0 ]]; then
        log_ok "No archives older than $days days"
        return 0
    fi

    log_info "Archives older than $days days:"
    local total_size=0
    for i in "${!candidates[@]}"; do
        local dir="${candidates[$i]}"
        local age="${candidate_ages[$i]}"
        local name="${dir#$archive_root/}"
        local size
        size=$(du -sh "$dir" 2>/dev/null | cut -f1)
        echo "  ${age}d  ${size}  $name"
    done

    echo ""
    local total
    total=$(du -sh "$archive_root" 2>/dev/null | cut -f1)
    log_info "${#candidates[@]} archive(s) found ($total total archive size)"
    if [[ "$assume_yes" == false ]]; then
        read -p "[wt] Delete these ${#candidates[@]} archive(s)? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Cancelled"
            return 0
        fi
    fi

    for dir in "${candidates[@]}"; do
        rm -rf "$dir"
    done

    # Clean up empty directories
    find "$archive_root" -type d -empty -delete 2>/dev/null

    log_ok "Pruned ${#candidates[@]} archive(s)"
}

cmd_install() {
    local source_line="source $SCRIPT_DIR/wt.zsh"
    local zshrc="$HOME/.zshrc"

    # Any existing wt.zsh source counts as installed — earlier installs wrote
    # a literal ~-prefixed path, which grep -qF on the resolved path would miss.
    if [[ -f "$zshrc" ]] && grep -qE '^[[:space:]]*source[[:space:]].*/wt\.zsh' "$zshrc"; then
        log_ok "Already installed in ~/.zshrc"
        return 0
    fi

    echo "" >> "$zshrc"
    echo "# wt - Git worktree manager" >> "$zshrc"
    echo "$source_line" >> "$zshrc"
    log_ok "Added to ~/.zshrc — run: source ~/.zshrc"
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
        status)
            cmd_status
            ;;
        open)
            shift
            cmd_open "${1:-}"
            ;;
        archive)
            shift
            cmd_archive "$@"
            ;;
        apply)
            shift
            cmd_apply "$@"
            ;;
        clean)
            shift
            cmd_clean "$@"
            ;;
        prune)
            shift
            cmd_prune "$@"
            ;;
        install)
            cmd_install
            ;;
        cd|home|done)
            log_error "wt $cmd requires shell function. Add to ~/.zshrc:"
            echo "  source $SCRIPT_DIR/wt.zsh"
            exit 1
            ;;
        *)
            cmd_create "$@"
            ;;
    esac
}

main "$@"
