#!/bin/bash
# SessionEnd hook entrypoint for team-memory sleep pipeline.
# Reads hook JSON from stdin to get the exact transcript path when available.
set -euo pipefail

input="$(cat || true)"
persona="${AI_MEMORY_PERSONA:-}"
[ -z "$persona" ] && exit 0

memory_home="${AI_MEMORY_DIR:-$HOME/.ai-memory}"
transcript=""

if command -v jq &>/dev/null && [ -n "$input" ]; then
  transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null || true)
fi

if [ -z "$transcript" ]; then
  transcript=$(ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1 || true)
fi

[ -z "$transcript" ] && exit 0

CLAUDECODE= \
AI_MEMORY_PERSONA= \
AI_MEMORY_TARGET_PERSONA="$persona" \
AI_MEMORY_TRANSCRIPT="$transcript" \
AI_MEMORY_DIR="$memory_home" \
  claude --agent team-memory-sleep --model haiku --print "Run sleep-time compute for persona $persona" || true
