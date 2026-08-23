---
name: signoz-log
description: Send structured logs to SigNoz observability platform. Use when you need to record events, errors, or activity for monitoring. Triggers on log, observe, signoz, telemetry, record event.
license: Apache-2.0
---

# SigNoz Logging

Send structured logs to SigNoz from Claude Code sessions. Session start/stop are logged automatically via hooks.

## Manual Logging

```bash
# Log an event
~/.claude/skills/signoz-log/scripts/signoz-log.sh INFO "deployed langflow v2.1"
~/.claude/skills/signoz-log/scripts/signoz-log.sh WARN "disk usage above 80%"
~/.claude/skills/signoz-log/scripts/signoz-log.sh ERROR "health check failed for immich"

# Override service name (default: project directory name)
~/.claude/skills/signoz-log/scripts/signoz-log.sh INFO "migration complete" "auth-service"
```

## Automatic Hooks

| Event | Message |
|-------|---------|
| SessionStart | `session started` |
| Stop | `session stopped` |

## Log Attributes

Each log includes: `service.name`, `session.id`, `project`, `cwd`, `host.name`, `hook.event`, plus a deterministic `traceId` per session for correlation.

## Viewing Logs

SigNoz UI: `http://la:8080` > Logs tab. Filter by `service.name` or `session.id`.

## Requirements

Tailscale connection to `la`. Fails silently if offline. No API key needed.
