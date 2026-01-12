---
description: Launch the Claude config visualizer web dashboard
---

Launch the webui to visualize ~/.claude configuration (commands, agents, skills, plugins, MCP servers).

## Steps

1. **Scan configuration** - Run the scanner to generate fresh data:
   ```bash
   bun ~/.claude/webui/scan.ts
   ```

2. **Start server** - Launch the web server in the background:
   ```bash
   bun ~/.claude/webui/serve.ts &
   ```

3. **Open browser** - Open the dashboard:
   ```bash
   open http://localhost:3000
   ```

After viewing, the user can stop the server with `pkill -f "bun.*serve.ts"` or it will terminate when the terminal closes.
