#!/bin/bash
# Chronicle sync reminder - checks for changes and prompts user

CHRONICLE_DIR="$HOME/.claude/chronicle/blocks"
LAST_SYNC_FILE="$HOME/.claude/.chronicle-last-sync"
DEPLOY_DIR="$HOME/code/services/deploy"

# Get latest block modification time
latest_block=$(find "$CHRONICLE_DIR" -name "*.json" -type f -exec stat -f "%m" {} \; 2>/dev/null | sort -rn | head -1)

# Get last sync time (0 if never synced)
last_sync=0
[[ -f "$LAST_SYNC_FILE" ]] && last_sync=$(cat "$LAST_SYNC_FILE")

# Exit if no changes
[[ -z "$latest_block" || "$latest_block" -le "$last_sync" ]] && exit 0

# Count new blocks since last sync
new_count=$(find "$CHRONICLE_DIR" -name "*.json" -type f -newermt "@$last_sync" 2>/dev/null | wc -l | tr -d ' ')

# Show dialog
response=$(osascript -e "
  display dialog \"Chronicle has $new_count new session(s) since last sync to orin.

Sync now?\" buttons {\"Later\", \"Sync Now\"} default button \"Sync Now\" with title \"Chronicle Sync\"
")

if [[ "$response" == *"Sync Now"* ]]; then
  # Run sync
  cd "$DEPLOY_DIR" && ansible-playbook claude.yml --tags chronicle-sync -e chronicle_sync_enabled=true

  # Update last sync timestamp
  date +%s > "$LAST_SYNC_FILE"

  # Notify success
  osascript -e 'display notification "Chronicle synced to orin" with title "Sync Complete"'
fi
