# Dashboard Service Management (macOS)

Run the Chronicle dashboard as a persistent launchd service or in development mode.

## Commands

```bash
# Development
/chronicle ui watch      # Auto-restart on file changes
/chronicle ui hot        # Hot module reloading (faster, may have state issues)

# Service management
/chronicle ui install    # Install service (one-time)
/chronicle ui start      # Start the service
/chronicle ui stop       # Stop the service
/chronicle ui status     # Check if running
/chronicle ui logs       # View recent logs
/chronicle ui uninstall  # Remove service
```

## Development Commands

### watch
```bash
bun --watch ~/.claude/skills/chronicle/scripts/dashboard.ts
```
Full process restart when files change. Reliable for development.

### hot
```bash
bun --hot ~/.claude/skills/chronicle/scripts/dashboard.ts
```
In-place hot reload without full restart. Faster but may have state issues.

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
Report: "Dashboard service started at http://localhost:3457"

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
- **Port**: 3457 (service), 3456 (development)

## Port Strategy

| Mode | Port | Purpose |
|------|------|---------|
| Service | 3457 | Background launchd service |
| Development | 3456 | Local dev, tests |

Both can run simultaneously - service uses 3457, dev uses 3456.
