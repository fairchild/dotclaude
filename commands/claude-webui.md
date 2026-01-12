---
description: Launch the Claude config visualizer web dashboard
---

Launch the webui to visualize ~/.claude configuration (commands, agents, skills, plugins, MCP servers).

## Arguments

Check if the user provided any arguments after `/claude-webui`:

- **kill | stop | off | terminate | down** → Stop the server and exit
- **refresh | scan | rescan** → Rescan config before launching
- **no args** → Start server without rescanning (uses existing data.json)

## If stopping (kill/stop/off/terminate/down)

Stop any running webui server:
```bash
pkill -f "bun.*serve.ts" && echo "Webui server stopped"
```

Done - no further steps.

## If launching

### 1. Rescan (only if refresh/scan arg provided)

If the user passed `refresh`, `scan`, or `rescan`:
```bash
bun ~/.claude/webui/scan.ts
```

### 2. Start server

Launch the web server in the background:
```bash
bun ~/.claude/webui/serve.ts &
```

### 3. Open browser

```bash
open http://localhost:3000
```

Inform the user they can run `/claude-webui stop` to terminate the server later.
