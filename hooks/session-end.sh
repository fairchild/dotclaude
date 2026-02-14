#!/bin/bash
# SessionEnd hook: Extract chronicle block on session exit
# Captures accomplishments, pending threads, and summary

~/.claude/skills/chronicle/scripts/extract.ts

# Print exit banner from persona theme
if [[ -n "${AI_MEMORY_PERSONA:-}" ]]; then
  MEMORY_DIR="${AI_MEMORY_DIR:-$HOME/.ai-memory}"
  theme_file="$MEMORY_DIR/$AI_MEMORY_PERSONA/theme.json"
  if [[ -f "$theme_file" ]] && command -v jq &>/dev/null; then
    icon=$(jq -r '.icon // ""' "$theme_file")
    color=$(jq -r '.color // ""' "$theme_file")
    tagline=$(jq -r '.tagline // ""' "$theme_file")
    if [[ -n "$color" ]]; then
      hex="${color#\#}"
      r=$((16#${hex:0:2})); g=$((16#${hex:2:2})); b=$((16#${hex:4:2}))
      C=$(printf '\033[38;2;%d;%d;%dm' "$r" "$g" "$b")
      R='\033[0m'
    else
      C='\033[36m'; R='\033[0m'
    fi
    printf "\n${C}%s %s %s — session complete${R}\n" "$icon" "$AI_MEMORY_PERSONA" "$tagline"
  fi
fi
