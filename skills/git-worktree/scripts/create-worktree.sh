#!/usr/bin/env bash
set -euo pipefail

# Create a git worktree at ~/.worktrees/<repo>/<branch>
# Usage: create-worktree.sh [options] <branch> [base-branch]

WORKTREES_ROOT="$HOME/.worktrees"

# Defaults
PLAN_ONLY=false
SKIP_SETUP=false
PR_NUMBER=""
BRANCH=""
BASE_BRANCH="main"

usage() {
    cat <<EOF
Usage: create-worktree.sh [options] <branch> [base-branch]

Options:
  --plan         Show what would be done without executing
  --skip-setup   Create worktree without running setup command
  --pr <number>  Create worktree for an existing PR

Arguments:
  branch         Name of the branch for the worktree
  base-branch    Branch to base from (default: main)

Examples:
  create-worktree.sh feature-auth
  create-worktree.sh --plan feature-auth
  create-worktree.sh --pr 123
  create-worktree.sh feature-auth develop
EOF
    exit 1
}

# Check for jq
check_jq() {
    if ! command -v jq &>/dev/null; then
        echo "Error: jq is required but not installed."
        echo ""
        echo "Install with:"
        echo "  macOS:  brew install jq"
        echo "  Ubuntu: sudo apt install jq"
        echo "  Fedora: sudo dnf install jq"
        exit 1
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --plan)
            PLAN_ONLY=true
            shift
            ;;
        --skip-setup)
            SKIP_SETUP=true
            shift
            ;;
        --pr)
            PR_NUMBER="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        -*)
            echo "Unknown option: $1"
            usage
            ;;
        *)
            if [[ -z "$BRANCH" ]]; then
                BRANCH="$1"
            else
                BASE_BRANCH="$1"
            fi
            shift
            ;;
    esac
done

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

# Get branch info for a PR
get_pr_branch() {
    local pr="$1"
    gh pr view "$pr" --json headRefName --jq '.headRefName' 2>/dev/null
}

# Detect setup command
detect_setup_command() {
    local worktree_path="$1"

    # 1. Check .cursor/environment.json
    if [[ -f "$worktree_path/.cursor/environment.json" ]]; then
        local install_cmd
        install_cmd=$(jq -r '.install // empty' "$worktree_path/.cursor/environment.json" 2>/dev/null || echo "")
        if [[ -n "$install_cmd" ]]; then
            echo "$install_cmd"
            return
        fi
    fi

    # 2. Check .devcontainer/devcontainer.json
    if [[ -f "$worktree_path/.devcontainer/devcontainer.json" ]]; then
        local post_create
        post_create=$(jq -r '.postCreateCommand // empty' "$worktree_path/.devcontainer/devcontainer.json" 2>/dev/null || echo "")
        if [[ -n "$post_create" ]]; then
            echo "$post_create"
            return
        fi
    fi

    # 3. Auto-detect based on project files
    if [[ -f "$worktree_path/bun.lockb" ]] || [[ -f "$worktree_path/bun.lock" ]]; then
        echo "bun install"
    elif [[ -f "$worktree_path/pnpm-lock.yaml" ]]; then
        echo "pnpm install"
    elif [[ -f "$worktree_path/yarn.lock" ]]; then
        echo "yarn install"
    elif [[ -f "$worktree_path/package-lock.json" ]]; then
        echo "npm install"
    elif [[ -f "$worktree_path/package.json" ]]; then
        echo "npm install"
    elif [[ -f "$worktree_path/uv.lock" ]]; then
        echo "uv sync"
    elif [[ -f "$worktree_path/pyproject.toml" ]]; then
        if grep -q '\[tool\.uv\]' "$worktree_path/pyproject.toml" 2>/dev/null; then
            echo "uv sync"
        elif [[ -f "$worktree_path/poetry.lock" ]]; then
            echo "poetry install"
        else
            echo "pip install -e ."
        fi
    elif [[ -f "$worktree_path/requirements.txt" ]]; then
        echo "pip install -r requirements.txt"
    elif [[ -f "$worktree_path/Gemfile" ]]; then
        echo "bundle install"
    elif [[ -f "$worktree_path/go.mod" ]]; then
        echo "go mod download"
    elif [[ -f "$worktree_path/Cargo.toml" ]]; then
        echo "cargo fetch"
    fi
}

# Detect setup from main repo (for --plan before worktree exists)
detect_setup_command_from_main() {
    detect_setup_command "$(git rev-parse --show-toplevel)"
}

# Handle PR checkout
if [[ -n "$PR_NUMBER" ]]; then
    check_jq
    BRANCH=$(get_pr_branch "$PR_NUMBER")
    if [[ -z "$BRANCH" ]]; then
        echo "Error: Could not find PR #$PR_NUMBER or get its branch name"
        exit 1
    fi
    echo "PR #$PR_NUMBER -> branch: $BRANCH"
fi

if [[ -z "$BRANCH" ]]; then
    usage
fi

REPO_NAME=$(get_repo_name)
WORKTREE_PATH="$WORKTREES_ROOT/$REPO_NAME/$BRANCH"

# Determine if branch is new or existing
BRANCH_STATUS="new"
BRANCH_SOURCE="$BASE_BRANCH"
if git show-ref --verify --quiet "refs/heads/$BRANCH" 2>/dev/null; then
    BRANCH_STATUS="local"
    BRANCH_SOURCE=""
elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH" 2>/dev/null; then
    BRANCH_STATUS="remote"
    BRANCH_SOURCE="origin/$BRANCH"
fi

# Detect setup command from main repo
SETUP_CMD=$(detect_setup_command_from_main)

# Plan mode - output JSON and exit
if [[ "$PLAN_ONLY" == true ]]; then
    check_jq
    jq -n \
        --arg path "$WORKTREE_PATH" \
        --arg branch "$BRANCH" \
        --arg status "$BRANCH_STATUS" \
        --arg base "$BASE_BRANCH" \
        --arg setup "$SETUP_CMD" \
        --argjson skip_setup "$SKIP_SETUP" \
        '{
            path: $path,
            branch: $branch,
            branch_status: $status,
            base_branch: $base,
            setup_command: (if $setup == "" then null else $setup end),
            skip_setup: $skip_setup
        }'
    exit 0
fi

# Check if worktree already exists
if [[ -d "$WORKTREE_PATH" ]]; then
    echo "Worktree already exists at: $WORKTREE_PATH"
    exit 1
fi

# Create parent directory
mkdir -p "$(dirname "$WORKTREE_PATH")"

# Create the worktree
case "$BRANCH_STATUS" in
    local)
        echo "Creating worktree for existing local branch: $BRANCH"
        git worktree add "$WORKTREE_PATH" "$BRANCH"
        ;;
    remote)
        echo "Creating worktree for remote branch: origin/$BRANCH"
        git worktree add "$WORKTREE_PATH" "$BRANCH"
        ;;
    new)
        echo "Creating worktree with new branch: $BRANCH (from $BASE_BRANCH)"
        git worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_BRANCH"
        ;;
esac

echo ""
echo "Worktree created at: $WORKTREE_PATH"

# Run setup unless skipped
if [[ "$SKIP_SETUP" == false ]] && [[ -n "$SETUP_CMD" ]]; then
    check_jq
    echo ""
    echo "Running setup: $SETUP_CMD"
    (cd "$WORKTREE_PATH" && eval "$SETUP_CMD")
    echo "Setup complete."
elif [[ -n "$SETUP_CMD" ]]; then
    echo ""
    echo "Skipped setup: $SETUP_CMD"
fi

echo ""
echo "To switch to this worktree:"
echo "  cd $WORKTREE_PATH"
