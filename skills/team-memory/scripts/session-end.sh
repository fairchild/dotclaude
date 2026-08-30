#!/bin/bash
# SessionEnd hook entrypoint for team-memory sleep pipeline.
# Reads hook JSON from stdin to get the exact transcript path.
# Optional fallback to latest transcript is gated by AI_MEMORY_ALLOW_TRANSCRIPT_FALLBACK=1.
set -euo pipefail

input="$(cat || true)"
persona="${AI_MEMORY_PERSONA:-}"
[ -z "$persona" ] && exit 0

script_dir="$(cd "$(dirname "$0")" && pwd)"
skill_dir="$(dirname "$script_dir")"
skill_agent="$skill_dir/agents/team-memory-sleep.md"
claude_home="$HOME/.claude"  # portability: allow — Claude Code's own config dir, identical on every install
global_agent_dir="$claude_home/agents"
global_agent="$global_agent_dir/team-memory-sleep.md"

# Keep global auto-discovered agent synced from the skill-local copy.
if [ -f "$skill_agent" ]; then
  mkdir -p "$global_agent_dir"
  if ! cmp -s "$skill_agent" "$global_agent" 2>/dev/null; then
    cp "$skill_agent" "$global_agent"
  fi
fi
[ -f "$global_agent" ] || exit 0

memory_home="${AI_MEMORY_DIR:-$HOME/.ai-memory}"
transcript=""

if command -v jq &>/dev/null && [ -n "$input" ]; then
  transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null || true)
fi

if [ -z "$transcript" ]; then
  if [ "${AI_MEMORY_ALLOW_TRANSCRIPT_FALLBACK:-0}" = "1" ]; then
    transcript=$(ls -t "$claude_home"/projects/*/*.jsonl 2>/dev/null | head -1 || true)
  else
    exit 0
  fi
fi

[ -z "$transcript" ] && exit 0

# Skip trivial sessions (fewer than 6 user messages)
if [ -f "$transcript" ]; then
  user_msgs=$(grep -c '"role":"user"' "$transcript" 2>/dev/null || true)
  [ "${user_msgs:-0}" -lt 6 ] && exit 0
fi

CLAUDECODE= \
AI_MEMORY_PERSONA= \
AI_MEMORY_TARGET_PERSONA="$persona" \
AI_MEMORY_TRANSCRIPT="$transcript" \
AI_MEMORY_DIR="$memory_home" \
AI_MEMORY_SKILL_DIR="$skill_dir" \
  claude --agent team-memory-sleep --model haiku --print "Run sleep-time compute for persona $persona" || true
