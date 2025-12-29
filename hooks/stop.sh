#!/bin/bash
# Stop hook: Generate AI-powered session title
# Invokes a Bun TypeScript script that summarizes recent messages

# Read JSON input from stdin and pass directly to Bun script
~/.claude/scripts/generate-session-title.ts
