# Dashboard Service Management (macOS)

Run the Chronicle dashboard as a persistent launchd service or in development mode.

Paths in this document are relative to this skill's base directory; run the
commands from there, or prefix them with the base directory the harness
announced.

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
bun --watch scripts/dashboard.ts
```
Full process restart when files change. Reliable for development.

### hot
```bash
bun --hot scripts/dashboard.ts
```
In-place hot reload without full restart. Faster but may have state issues.

## Service Commands Implementation

When user runs `/chronicle ui <command>`, execute:

### install
```bash
scripts/install-services.sh install dashboard
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
scripts/install-services.sh status
```
- If output shows PID: "Dashboard running (PID: {pid})"
- If no output: "Dashboard not running."

### logs
```bash
tail -50 /tmp/chronicle-dashboard.log
```

### uninstall
```bash
scripts/install-services.sh uninstall dashboard
```
Report: "Service uninstalled."

## Manual Commands

All services are managed via `install-services.sh`:

```bash
# List available services
scripts/install-services.sh list

# Install all services
scripts/install-services.sh install

# Install specific service
scripts/install-services.sh install dashboard

# Check status
scripts/install-services.sh status

# Uninstall specific service
scripts/install-services.sh uninstall dashboard

# View logs
tail -f /tmp/chronicle-dashboard.log
```

## Configuration

Plists are generated at install time by `scripts/install-services.sh` using `$HOME` for portability.

Key settings (dashboard):
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
