#!/bin/bash
# ============================================================================
# Claude Code Status Line
# ============================================================================
#
# Displays: project branch (files) model $cost +add -del (in+cw+cr):out [1:N]
#
# Input: JSON via stdin from Claude Code containing:
#   - workspace.current_dir  : working directory
#   - model.display_name     : model name (e.g., "Opus 4.5")
#   - session_id             : session identifier
#   - cost.total_cost_usd    : cumulative session cost
#   - cost.total_lines_added/removed : lines changed by Claude
#
# Token formula (in+cw+cr):out shows CUMULATIVE values across all turns:
#   in  = tokens after cache breakpoint (variable suffix, full price)
#   cw  = cache_write tokens (written to cache, 1.25x price) ≈ unique input
#   cr  = cache_read tokens (from cache, 0.1x price) [cyan] - grows fastest
#   out = output tokens (Claude's responses)
#   [1:N] = cumulative input:output ratio
#
# Dependencies: jq, bc, git
# See README.md for full documentation
# ============================================================================

set -euo pipefail

# ----------------------------------------------------------------------------
# Colors (ANSI escape codes)
# ----------------------------------------------------------------------------
BLUE='\033[34m'
DIM='\033[90m'
CYAN='\033[36m'
YELLOW='\033[33m'
GREEN='\033[32m'
RED='\033[31m'
MAGENTA='\033[35m'
RESET='\033[0m'

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

# Format token count: 1500000 -> "1.5M", 25000 -> "25K", 500 -> "500"
format_tokens() {
    local val=$1
    if [[ $val -ge 1000000 ]]; then
        echo "$(echo "scale=1; $val / 1000000" | bc -l 2>/dev/null)M"
    elif [[ $val -ge 1000 ]]; then
        echo "$(echo "scale=0; $val / 1000" | bc -l 2>/dev/null)K"
    else
        echo "$val"
    fi
}

# Extract project name from git remote or fallback to directory basename
get_project_name() {
    local dir=$1
    git -C "$dir" config --get remote.origin.url 2>/dev/null \
        | sed 's/.*[:/]\([^/]*\)\.git$/\1/' \
        || basename "$dir"
}

# ----------------------------------------------------------------------------
# Parse Input
# ----------------------------------------------------------------------------
input=$(cat)

current_dir=$(echo "$input" | jq -r '.workspace.current_dir')
model=$(echo "$input" | jq -r '.model.display_name')
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')

total_cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')

project_name=$(get_project_name "$current_dir")

# ----------------------------------------------------------------------------
# Token Data (cached to avoid parsing JSONL on every render)
# ----------------------------------------------------------------------------
token_cache=~/.claude/session-titles/$project_name/$session_id.tokens
CACHE_TTL_MINUTES=1

# Refresh cache in background if stale
if [[ ! -f "$token_cache" ]] || [[ $(find "$token_cache" -mmin +$CACHE_TTL_MINUTES 2>/dev/null) ]]; then
    mkdir -p ~/.claude/session-titles/$project_name
    ~/.claude/scripts/get-session-tokens.sh "$session_id" > "$token_cache" 2>/dev/null &
fi

# Read cached token data
if [[ -f "$token_cache" ]]; then
    token_data=$(cat "$token_cache" 2>/dev/null)
    input_tokens=$(echo "$token_data" | jq -r '.input_tokens // 0')
    output_tokens=$(echo "$token_data" | jq -r '.output_tokens // 0')
    cache_write=$(echo "$token_data" | jq -r '.cache_creation_input_tokens // 0')
    cache_read=$(echo "$token_data" | jq -r '.cache_read_input_tokens // 0')
else
    input_tokens=0 output_tokens=0 cache_write=0 cache_read=0
fi

# ----------------------------------------------------------------------------
# Render Status Line
# ----------------------------------------------------------------------------

# Project name (blue)
worktree_name_file="$current_dir/.worktree-name"
if [[ -f "$worktree_name_file" ]]; then
    printf "${BLUE}%s${RESET}" "$(cat "$worktree_name_file" | tr -d '\n')"
else
    printf "${BLUE}%s${RESET}" "$(basename "$current_dir")"
fi

# Git branch + uncommitted count
if git -C "$current_dir" rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git -C "$current_dir" branch --show-current 2>/dev/null || echo 'HEAD')
    printf " ${DIM}%s${RESET}" "$branch"

    uncommitted=$(git -C "$current_dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if [[ $uncommitted -gt 0 ]]; then
        printf " ${CYAN}(%s)${RESET}" "$uncommitted"
    fi
fi

# Model
printf " %s" "$model"

# Cost (yellow)
if [[ $(echo "$total_cost > 0" | bc -l 2>/dev/null || echo "0") -eq 1 ]]; then
    printf " ${YELLOW}\$%.3f${RESET}" "$total_cost"
fi

# Lines changed (green/red)
if [[ $lines_added -gt 0 ]] || [[ $lines_removed -gt 0 ]]; then
    printf " ${GREEN}+%s${RESET}" "$lines_added"
    printf " ${RED}-%s${RESET}" "$lines_removed"
fi

# Token formula: (in+cw+cr):out [1:N]
if [[ $input_tokens -gt 0 ]] || [[ $output_tokens -gt 0 ]] || [[ $cache_write -gt 0 ]] || [[ $cache_read -gt 0 ]]; then
    in_str=$(format_tokens $input_tokens)
    cw_str=$(format_tokens $cache_write)
    cr_str=$(format_tokens $cache_read)
    out_str=$(format_tokens $output_tokens)

    # Ratio: total_input / output
    total_input=$((input_tokens + cache_write + cache_read))
    if [[ $output_tokens -gt 0 ]]; then
        ratio=$(echo "scale=0; $total_input / $output_tokens" | bc -l 2>/dev/null || echo "0")
    else
        ratio="∞"
    fi

    # (in+cw+cr):out [1:N] — cache_read in cyan (cheapest)
    printf " ${DIM}(${RESET}%s${DIM}+${RESET}%s${DIM}+${CYAN}%s${DIM}):${RESET}%s ${DIM}[1:%s]${RESET}" \
        "$in_str" "$cw_str" "$cr_str" "$out_str" "$ratio"
fi

# Session title (if set)
title_file=~/.claude/session-titles/$project_name/$session_id.txt
if [[ -f "$title_file" ]]; then
    title=$(cat "$title_file")
    # Highlight shift indicator (N) in yellow if present
    if [[ $title =~ ^\(([0-9]+)\)\ (.*)$ ]]; then
        shift_count="${BASH_REMATCH[1]}"
        title_text="${BASH_REMATCH[2]}"
        printf " ${DIM}|${RESET} ${YELLOW}(%s)${RESET} ${MAGENTA}%s${RESET}" "$shift_count" "$title_text"
    else
        printf " ${DIM}|${RESET} ${MAGENTA}%s${RESET}" "$title"
    fi
fi
