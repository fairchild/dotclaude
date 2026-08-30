#!/usr/bin/env bash
# Chronicle service manager — generates and installs/uninstalls launchd plists.
# Usage:
#   install-services.sh install [service...]   # Install all or named services
#   install-services.sh uninstall [service...]  # Uninstall all or named services
#   install-services.sh status                  # Show installed service status
#   install-services.sh list                    # List available services
set -euo pipefail

LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
BUN="$HOME/.bun/bin/bun"
# launchd needs absolute paths, so resolve this script's own directory rather
# than assuming where the skill is installed.
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The invoking user's own Claude Code config dir (prerequisite: Claude Code)
CLAUDE_DIR="${HOME}/.claude"  # portability: allow
STD_PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ALL_SERVICES="dashboard summarize summarize-weekly consolidate sync-reminder"

label_for() {
  echo "com.chronicle.$1"
}

env_block() {
  local extra_keys="${1:-}"
  cat <<XML
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>${STD_PATH}</string>${extra_keys}
    </dict>
XML
}

plist_for() {
  local svc=$1 label
  label=$(label_for "$svc")

  case "$svc" in
    dashboard)
      cat <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BUN}</string>
        <string>${SCRIPTS}/dashboard.ts</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/${label}.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/${label}.err</string>
    <key>WorkingDirectory</key>
    <string>${CLAUDE_DIR}</string>
$(env_block "
        <key>PORT</key>
        <string>3457</string>")
</dict>
</plist>
XML
      ;;
    summarize)
      cat <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BUN}</string>
        <string>${SCRIPTS}/summarize.ts</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>0</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/${label}.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/${label}.err</string>
    <key>WorkingDirectory</key>
    <string>${CLAUDE_DIR}</string>
$(env_block)
</dict>
</plist>
XML
      ;;
    summarize-weekly)
      cat <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BUN}</string>
        <string>${SCRIPTS}/summarize.ts</string>
        <string>--weekly</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>0</integer>
        <key>Hour</key>
        <integer>0</integer>
        <key>Minute</key>
        <integer>5</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/${label}.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/${label}.err</string>
    <key>WorkingDirectory</key>
    <string>${CLAUDE_DIR}</string>
$(env_block)
</dict>
</plist>
XML
      ;;
    consolidate)
      cat <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BUN}</string>
        <string>${SCRIPTS}/consolidate.ts</string>
        <string>--apply</string>
        <string>--drop-pending</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Day</key>
        <integer>1</integer>
        <key>Hour</key>
        <integer>2</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/${label}.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/${label}.err</string>
    <key>WorkingDirectory</key>
    <string>${CLAUDE_DIR}</string>
$(env_block)
</dict>
</plist>
XML
      ;;
    sync-reminder)
      cat <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${SCRIPTS}/sync-reminder.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/${label}.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/${label}.err</string>
$(env_block)
</dict>
</plist>
XML
      ;;
    *)
      echo "Unknown service: $svc" >&2
      return 1
      ;;
  esac
}

cmd_install() {
  local services="${*:-$ALL_SERVICES}"
  mkdir -p "$LAUNCH_AGENTS"
  for svc in $services; do
    local label plist_path
    label=$(label_for "$svc")
    plist_path="$LAUNCH_AGENTS/${label}.plist"
    launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
    plist_for "$svc" > "$plist_path"
    launchctl bootstrap "gui/$(id -u)" "$plist_path"
    echo "Installed: $svc → $plist_path"
  done
}

cmd_uninstall() {
  local services="${*:-$ALL_SERVICES}"
  for svc in $services; do
    local label plist_path
    label=$(label_for "$svc")
    plist_path="$LAUNCH_AGENTS/${label}.plist"
    launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
    rm -f "$plist_path"
    echo "Uninstalled: $svc"
  done
}

cmd_status() {
  for svc in $ALL_SERVICES; do
    local label plist_path
    label=$(label_for "$svc")
    plist_path="$LAUNCH_AGENTS/${label}.plist"
    if [[ -f "$plist_path" ]]; then
      local state
      state=$(launchctl print "gui/$(id -u)/${label}" 2>/dev/null | grep "^\s*state = " | head -1 | sed 's/.*= //') || state="not loaded"
      printf "  %-20s installed (%s)\n" "$svc" "$state"
    else
      printf "  %-20s not installed\n" "$svc"
    fi
  done
}

cmd_list() {
  echo "Available services:"
  echo "  dashboard          Web dashboard (port 3457, kept alive)"
  echo "  summarize          Daily AI summaries (midnight)"
  echo "  summarize-weekly   Weekly AI summaries (Sunday 00:05)"
  echo "  consolidate        Monthly block consolidation (1st, 2am)"
  echo "  sync-reminder      Remote sync reminder (daily 9am)"
}

case "${1:-}" in
  install)   shift; cmd_install "$@" ;;
  uninstall) shift; cmd_uninstall "$@" ;;
  status)    cmd_status ;;
  list)      cmd_list ;;
  *)
    echo "Usage: install-services.sh {install|uninstall|status|list} [service...]"
    echo "Run 'install-services.sh list' to see available services."
    exit 1
    ;;
esac
