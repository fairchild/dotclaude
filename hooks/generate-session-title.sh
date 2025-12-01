#!/bin/bash
# Background script to generate session title using Claude Code

session_id="$1"
project_dir="$2"

# Get project name from git repo or fallback to directory name
project_name=$(git -C "$project_dir" config --get remote.origin.url 2>/dev/null | sed 's/.*[:/]\([^/]*\)\.git$/\1/' || basename "$project_dir")

title_dir=~/.claude/session-titles/$project_name
title_file="$title_dir/$session_id.txt"

# DISABLED: AI-generated titles via Claude CLI
# The `claude -p` command hangs when run in background/command-substitution mode,
# even with `env -u ANTHROPIC_API_KEY` and running from /tmp.
# Issue: Works in interactive mode but hangs in $(...)  subshells.
#
# Future options:
# 1. Use Anthropic/OpenAI API directly with curl (requires API key management)
# 2. Wait for Claude CLI to support truly non-interactive background mode
# 3. Manual titles via a /title slash command

# Use timestamp-based title - simple and reliable
title="Session $(date +%H:%M)"

# Write title to file
echo "$title" > "$title_file"
