#!/bin/bash
# Chronicle sync reminder - checks for changes and prompts user
#
# Required env vars (set in ~/.claude/.env):
#   CHRONICLE_SYNC_TARGET  - Display name for remote host
#   CHRONICLE_DEPLOY_DIR   - Path to ansible deploy directory

set -euo pipefail

# Load .env
[[ -f "$HOME/.claude/.env" ]] && export $(grep -v '^#' "$HOME/.claude/.env" | xargs)

# Validate required config
if [[ -z "${CHRONICLE_SYNC_TARGET:-}" || -z "${CHRONICLE_DEPLOY_DIR:-}" ]]; then
  echo "Missing required env vars. Set CHRONICLE_SYNC_TARGET and CHRONICLE_DEPLOY_DIR in ~/.claude/.env"
  exit 1
fi

CHRONICLE_DIR="$HOME/.claude/chronicle/blocks"
LAST_SYNC_FILE="$HOME/.claude/.chronicle-last-sync"

# Get latest block modification time
latest_block=$(find "$CHRONICLE_DIR" -name "*.json" -type f -exec stat -f "%m" {} \; 2>/dev/null | sort -rn | head -1)

# Get last sync time (0 if never synced)
last_sync=0
[[ -f "$LAST_SYNC_FILE" ]] && last_sync=$(cat "$LAST_SYNC_FILE")

# Exit if no changes
[[ -z "$latest_block" || "$latest_block" -le "$last_sync" ]] && exit 0

# Count new blocks since last sync
if [[ "$last_sync" -eq 0 ]]; then
  new_count=$(find "$CHRONICLE_DIR" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
else
  # macOS: use -newer with a reference file
  mkdir -p "$HOME/.claude/tmp"
  touch -t "$(date -r "$last_sync" +%Y%m%d%H%M.%S)" "$HOME/.claude/tmp/.sync-ref" 2>/dev/null
  new_count=$(find "$CHRONICLE_DIR" -name "*.json" -type f -newer "$HOME/.claude/tmp/.sync-ref" 2>/dev/null | wc -l | tr -d ' ')
  rm -f "$HOME/.claude/tmp/.sync-ref"
fi

# Show dialog
response=$(osascript -e "
  display dialog \"Chronicle has $new_count new session(s) since last sync to $CHRONICLE_SYNC_TARGET.

Sync now?\" buttons {\"Later\", \"Sync Now\"} default button \"Sync Now\" with title \"Chronicle Sync\"
")

if [[ "$response" == *"Sync Now"* ]]; then
  # Run sync
  cd "$CHRONICLE_DEPLOY_DIR" && ansible-playbook claude.yml --tags chronicle-sync -e chronicle_sync_enabled=true

  # Update last sync timestamp
  date +%s > "$LAST_SYNC_FILE"

  # Notify success
  osascript -e "display notification \"Chronicle synced to $CHRONICLE_SYNC_TARGET\" with title \"Sync Complete\""
fi
