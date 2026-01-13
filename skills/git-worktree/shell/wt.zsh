# wt - Git worktree CLI with conductor.json integration
# Source this file in ~/.zshrc

WORKTREES_ROOT="${WORKTREES_ROOT:-$HOME/.worktrees}"
_WT_SCRIPT="$HOME/.claude/skills/git-worktree/scripts/wt.sh"

_wt_get_repo_name() {
    local url
    url=$(git remote get-url origin 2>/dev/null || echo "")
    if [[ -z "$url" ]]; then
        basename "$(git rev-parse --show-toplevel)"
    else
        basename "$url" .git
    fi
}

_wt_get_main_repo() {
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

wt() {
    local cmd="${1:-}"

    case "$cmd" in
        cd)
            shift
            local branch="${1:-}"
            if [[ -z "$branch" ]]; then
                echo "Usage: wt cd <branch>"
                return 1
            fi

            if ! git rev-parse --git-dir &>/dev/null; then
                echo "Error: Not in a git repository"
                return 1
            fi

            local repo_name
            repo_name=$(_wt_get_repo_name)
            local worktree_path="$WORKTREES_ROOT/$repo_name/$branch"

            if [[ -d "$worktree_path" ]]; then
                cd "$worktree_path" || return 1
            else
                echo "Worktree not found: $worktree_path"
                return 1
            fi
            ;;
        home)
            if ! git rev-parse --git-dir &>/dev/null; then
                echo "Error: Not in a git repository"
                return 1
            fi

            local main_repo
            main_repo=$(_wt_get_main_repo)
            cd "$main_repo" || return 1
            ;;
        *)
            "$_WT_SCRIPT" "$@"
            ;;
    esac
}

# Zsh completion
_wt() {
    local state
    _arguments '1: :->cmd' '2: :->branch'

    case $state in
        cmd)
            _values 'command' 'cd[Change to worktree]' 'home[Return to main repo]' 'list[List worktrees]' 'archive[Archive worktree]'
            # Also complete branch names for direct create
            if git rev-parse --git-dir &>/dev/null; then
                local branches
                branches=(${(f)"$(git branch -a --format='%(refname:short)' 2>/dev/null | sed 's|origin/||' | sort -u)"})
                _values 'branch' $branches
            fi
            ;;
        branch)
            if [[ "$words[2]" == "cd" || "$words[2]" == "archive" ]]; then
                # Complete with existing worktrees
                local repo_name
                if git rev-parse --git-dir &>/dev/null; then
                    local url
                    url=$(git remote get-url origin 2>/dev/null || echo "")
                    if [[ -z "$url" ]]; then
                        repo_name=$(basename "$(git rev-parse --show-toplevel)")
                    else
                        repo_name=$(basename "$url" .git)
                    fi
                    local worktrees_dir="$WORKTREES_ROOT/$repo_name"
                    if [[ -d "$worktrees_dir" ]]; then
                        local worktrees
                        worktrees=(${(f)"$(ls "$worktrees_dir" 2>/dev/null)"})
                        _values 'worktree' $worktrees
                    fi
                fi
            fi
            ;;
    esac
}

compdef _wt wt
