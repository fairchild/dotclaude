#!/bin/bash
# Statusline script matching Starship prompt configuration
# Reads JSON input from stdin with workspace and model information

# Read JSON input
input=$(cat)
current_dir=$(echo "$input" | jq -r '.workspace.current_dir')
model=$(echo "$input" | jq -r '.model.display_name')
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')

# Extract cost information
total_cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')

# Get project name from git repo or fallback to directory name
project_name=$(git -C "$current_dir" config --get remote.origin.url 2>/dev/null | sed 's/.*[:/]\([^/]*\)\.git$/\1/' || basename "$current_dir")

# Get token usage from session file (cached to avoid performance hit)
token_cache=~/.claude/session-titles/$project_name/$session_id.tokens
if [[ ! -f "$token_cache" ]] || [[ $(find "$token_cache" -mmin +1 2>/dev/null) ]]; then
    # Refresh cache if older than 1 minute
    mkdir -p ~/.claude/session-titles/$project_name
    ~/.claude/scripts/get-session-tokens.sh "$session_id" > "$token_cache" 2>/dev/null &
fi
if [[ -f "$token_cache" ]]; then
    token_data=$(cat "$token_cache" 2>/dev/null)
    total_tokens=$(echo "$token_data" | jq -r '.total_tokens // 0')
else
    total_tokens=0
fi

# Directory/Worktree name (blue, matching Starship's directory.style)
worktree_name_file="$current_dir/.worktree-name"
if [[ -f "$worktree_name_file" ]]; then
    # Show worktree name if available
    worktree_name=$(cat "$worktree_name_file" 2>/dev/null | tr -d '\n')
    printf "\033[34m%s\033[0m" "$worktree_name"
else
    # Fallback to directory basename
    printf "\033[34m%s\033[0m" "$(basename "$current_dir")"
fi

# Git information (if in a git repo)
if git -C "$current_dir" rev-parse --git-dir >/dev/null 2>&1; then
    # Git branch (bright-black/dim, matching Starship's git_branch.style)
    branch=$(git -C "$current_dir" branch --show-current 2>/dev/null || echo 'HEAD')
    printf " \033[90m%s\033[0m" "$branch"
    
    # Git status with uncommitted file count (cyan)
    uncommitted=$(git -C "$current_dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if [[ $uncommitted -gt 0 ]]; then
        printf " \033[36m(%s)\033[0m" "$uncommitted"
    fi
fi

# Model info
printf " %s" "$model"

# Cost information (yellow/gold)
if [[ $(echo "$total_cost > 0" | bc -l 2>/dev/null || echo "0") -eq 1 ]]; then
    printf " \033[33m\$%.3f\033[0m" "$total_cost"
fi

# Lines changed (green for added, red for removed)
if [[ $lines_added -gt 0 ]] || [[ $lines_removed -gt 0 ]]; then
    printf " \033[32m+%s\033[0m" "$lines_added"
    printf " \033[31m-%s\033[0m" "$lines_removed"
fi

# Token usage (dim white/gray) - show in K format for readability
if [[ $total_tokens -gt 0 ]]; then
    tokens_k=$(echo "scale=1; $total_tokens / 1000" | bc -l 2>/dev/null || echo "0")
    printf " \033[90m%.0fK\033[0m" "$tokens_k"
fi

# Session title (if available) - shown last
title_file=~/.claude/session-titles/$project_name/$session_id.txt
if [[ -f "$title_file" ]]; then
    session_title=$(cat "$title_file")
    printf " \033[90m|\033[0m \033[35m%s\033[0m" "$session_title"  # Pipe separator + Magenta title
fi
