# MCP Server Configuration

Configure Model Context Protocol servers for Claude Code.

## File Locations

| Scope | File | Purpose |
|-------|------|---------|
| Global | `~/.claude.json` | User-wide MCP servers |
| Project | `.mcp.json` | Project-specific servers |

Both use the same format. Project servers supplement global ones.

## Configuration Format

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "executable",
      "args": ["arg1", "arg2"],
      "env": {
        "API_KEY": "${ENV_VAR_NAME}"
      }
    }
  }
}
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `type` | No | Transport type, usually `"stdio"` |
| `command` | Yes | Executable to run |
| `args` | No | Array of command arguments |
| `env` | No | Environment variables for the server |

## Environment Variables

Reference environment variables with `${VAR_NAME}`:

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "perplexity-mcp",
      "env": {
        "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY}"
      }
    }
  }
}
```

The variable must be set in your shell environment.

## CLI Management

### Add a server

```bash
# Interactive
claude mcp add

# JSON config (preferred for scripting)
claude mcp add-json --scope=user my-server '{"command":"uvx","args":["mcp-server-name"]}'

# Scopes: local, user (global), project
```

### List servers

```bash
claude mcp list
```

### Get server details

```bash
claude mcp get server-name
```

### Remove a server

```bash
claude mcp remove server-name
```

### Debug connections

```bash
claude --mcp-debug
# Then in session: /mcp
```

## Common Server Examples

### Python servers (via uvx)

```json
{
  "mcpServers": {
    "time": {
      "command": "uvx",
      "args": ["mcp-server-time", "--local-timezone", "America/New_York"]
    },
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db", "path/to/db.sqlite"]
    }
  }
}
```

### Node servers (via npx)

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Direct executables

```json
{
  "mcpServers": {
    "custom": {
      "command": "/path/to/my-mcp-server",
      "args": ["--config", "config.json"]
    }
  }
}
```

## Scope Behavior

| Scope | Storage | Visibility |
|-------|---------|------------|
| `local` | Session memory | Current session only |
| `user` (global) | `~/.claude.json` | All projects |
| `project` | `.mcp.json` | This project only |

Servers from all applicable scopes are available. When a project-scope server has the same name as a user-scope server, the project version completely replaces the global one (no merging of fields).

## Verifying Connections

In a Claude Code session:

```
/mcp
```

Shows connection status for each configured server.

## Troubleshooting

### Server not connecting

1. Check the command exists: `which uvx` or `which npx`
2. Verify env vars are set: `echo $MY_API_KEY`
3. Run with debug: `claude --mcp-debug`
4. Check server directly: `uvx mcp-server-name --help`

### Permission errors

MCP server tools appear as `mcp__servername__toolname`. Add to permissions:

```json
"permissions": {
  "allow": ["mcp__myserver__*"]
}
```
