#!/bin/bash
# Stop hook: Update session title occasionally after Claude finishes responding

# Read JSON input
input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id')
project_dir=$(echo "$input" | jq -r '.cwd')

# Get project name from git repo or fallback to directory name
project_name=$(git -C "$project_dir" config --get remote.origin.url 2>/dev/null | sed 's/.*[:/]\([^/]*\)\.git$/\1/' || basename "$project_dir")

# Setup paths
title_dir=~/.claude/session-titles/$project_name
title_file="$title_dir/$session_id.txt"
state_file="$title_dir/$session_id.state"

# Create directory if needed
mkdir -p "$title_dir"

# Heuristic: Only update every 10 minutes or if no title exists
should_update=false

if [[ ! -f "$title_file" ]]; then
    should_update=true
else
    # Check last update time
    if [[ -f "$state_file" ]]; then
        last_update=$(cat "$state_file")
        current_time=$(date +%s)
        time_diff=$((current_time - last_update))

        # Update if 10 minutes (600 seconds) have passed
        if [[ $time_diff -gt 600 ]]; then
            should_update=true
        fi
    else
        should_update=true
    fi
fi

# Generate title in background if needed
if [[ "$should_update" == "true" ]]; then
    # Update timestamp immediately to prevent concurrent updates
    date +%s > "$state_file"

    # Run title generation in background
    nohup ~/.claude/hooks/generate-session-title.sh "$session_id" "$project_dir" > /dev/null 2>&1 &
fi
