# dotclaude

Warp Agent Mode configuration.

## Tracked Files

- `.mcp.json` - MCP server configurations
- `settings.json` - Permissions, hooks, and environment settings
- `CLAUDE.md` - Context and development preferences
- `agents/` - Specialized agent definitions
- `commands/` - Reusable commands (bootstrap, etc.)
- `hooks/` - Session lifecycle hooks
- `statusline.sh` - Status line display script
- `.gitignore` - Excludes personal and generated data

## Excluded Files

- Chat history
- Session state and environment
- Plans and todos
- Debug logs and shell snapshots
- Project-specific data
- Personal scripts
- Session titles
- Analytics data

## Usage

### Global Configuration

Clone as `~/.claude/` to restore settings:

```bash
mv ~/.claude ~/.claude.backup  # backup existing if needed
git clone git@github.com:fairchild/dotclaude.git ~/.claude
```

### Project Configuration

Warp reads `.claude/` directories in projects.
Copy files as needed:

```bash
mkdir -p .claude/commands
cp ~/.claude/CLAUDE.md .claude/
cp ~/.claude/commands/bootstrap.md .claude/commands/
```

Project settings override global settings.
