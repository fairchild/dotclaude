# Dashboard Service Management (macOS)

Run the Chronicle dashboard as a persistent launchd service.

## Commands

```bash
/chronicle ui install    # Install service (one-time)
/chronicle ui start      # Start the service
/chronicle ui stop       # Stop the service
/chronicle ui status     # Check if running
/chronicle ui logs       # View recent logs
/chronicle ui uninstall  # Remove service
```

## Service Commands Implementation

When user runs `/chronicle ui <command>`, execute:

### install
```bash
cp ~/.claude/skills/chronicle/config/com.chronicle.dashboard.plist ~/Library/LaunchAgents/
```
Report: "Service installed. Run `/chronicle ui start` to start it."

### start
```bash
launchctl load ~/Library/LaunchAgents/com.chronicle.dashboard.plist
```
Report: "Dashboard service started at http://localhost:3456"

### stop
```bash
launchctl unload ~/Library/LaunchAgents/com.chronicle.dashboard.plist
```
Report: "Dashboard service stopped."

### status
```bash
launchctl list | grep chronicle
```
- If output shows PID: "Dashboard running (PID: {pid})"
- If no output: "Dashboard not running."

### logs
```bash
tail -50 /tmp/chronicle-dashboard.log
```

### uninstall
```bash
launchctl unload ~/Library/LaunchAgents/com.chronicle.dashboard.plist 2>/dev/null
rm ~/Library/LaunchAgents/com.chronicle.dashboard.plist
```
Report: "Service uninstalled."

## Manual Commands

If not using skill commands:

```bash
# Install
cp ~/.claude/skills/chronicle/config/com.chronicle.dashboard.plist ~/Library/LaunchAgents/

# Start
launchctl load ~/Library/LaunchAgents/com.chronicle.dashboard.plist

# Stop
launchctl unload ~/Library/LaunchAgents/com.chronicle.dashboard.plist

# Check status
launchctl list | grep chronicle

# View logs
tail -f /tmp/chronicle-dashboard.log
```

## Configuration

The plist is at `~/.claude/skills/chronicle/config/com.chronicle.dashboard.plist`.

Key settings:
- **RunAtLoad**: false (doesn't start on login by default)
- **KeepAlive**: restarts on crash
- **Logs**: `/tmp/chronicle-dashboard.log` and `/tmp/chronicle-dashboard.err`
- **Port**: 3456
