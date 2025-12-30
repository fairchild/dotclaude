# settings.json Reference

Complete reference for Claude Code settings configuration.

## File Locations

| Level | Path | Purpose |
|-------|------|---------|
| Global | `~/.claude/settings.json` | User defaults for all projects |
| Project | `.claude/settings.json` | Project-specific, version-controlled |
| Local | `.claude/settings.local.json` | Per-machine overrides, gitignored |

Settings merge hierarchically: global → project → local.

## Schema

```json
{
  "env": {},
  "permissions": {},
  "hooks": {},
  "statusLine": {},
  "model": "",
  "alwaysThinkingEnabled": true
}
```

## Permissions

Controls which tools run automatically, require confirmation, or are blocked.

### Structure

```json
"permissions": {
  "allow": ["pattern1", "pattern2"],
  "deny": ["pattern3"],
  "ask": ["pattern4"],
  "defaultMode": "default"
}
```

### Pattern Format

- `ToolName` - matches all uses of that tool
- `ToolName(glob)` - matches tool with argument matching glob pattern
- For Bash commands, the glob matches the command string: `Bash(git log:*)` matches any command starting with `git log:`. The `:` and `*` are literal glob characters, not special syntax

### Examples

```json
"permissions": {
  "allow": [
    "Bash(git status)",
    "Bash(git log:*)",
    "Bash(npm test:*)",
    "Read(./src/**)",
    "Write(./build/**)"
  ],
  "deny": [
    "Read(.env)",
    "Read(.env.*)",
    "Read(**/.env)",
    "Read(**/*.pem)",
    "Read(**/*.key)",
    "Read(~/.ssh/**)",
    "Read(~/.aws/**)",
    "Write(.env*)",
    "Write(secrets/**)"
  ],
  "ask": [
    "Bash(git push:*)",
    "Bash(git reset:*)",
    "Bash(rm -rf:*)"
  ]
}
```

### Common Tool Names

- `Bash` - shell commands
- `Read` - file reading
- `Write` - file creation
- `Edit` - file modification
- `Glob` - file pattern search
- `Grep` - content search
- `WebFetch` - URL fetching
- `Task` - subagent launch
- `mcp__servername__toolname` - MCP tools

## Hooks

Execute scripts at lifecycle events.

### Available Events

| Event | When | Common Uses |
|-------|------|-------------|
| `PreToolUse` | Before tool executes | Validation, input modification |
| `PostToolUse` | After tool completes | Formatting, linting |
| `Stop` | Before session ends | Generate summaries, cleanup |
| `SessionStart` | When session begins | Environment setup |
| `PreCompact` | Before context compaction | Save state |
| `Notification` | On notifications | Custom alerting |

### Hook Structure

```json
"hooks": {
  "EventName": [
    {
      "matcher": "ToolPattern",
      "hooks": [
        {
          "type": "command",
          "command": "script.sh",
          "timeout": 30
        }
      ]
    }
  ]
}
```

### Matcher Patterns

- Empty `""` - matches all
- `"Write"` - matches Write tool
- `"Write|Edit"` - matches Write or Edit
- Tool-specific matchers may include file patterns

### Hook Types

**Command Hook**
```json
{
  "type": "command",
  "command": "path/to/script.sh",
  "timeout": 30
}
```

**Prompt Hook** (for PreToolUse/PostToolUse)
```json
{
  "type": "prompt",
  "prompt": "Evaluate this action...",
  "timeout": 30
}
```

### Environment Variables

Hooks receive context via environment variables:
- `$CLAUDE_FILE_PATHS` - space-separated list of affected file paths. Quote when using in shell to handle paths with spaces: `"$CLAUDE_FILE_PATHS"`
- `$ARGUMENTS` - tool arguments as JSON string. Quote to preserve: `"$ARGUMENTS"`

Standard OS variables (`PATH`, `HOME`, etc.) and any variables from the `env` section in settings.json are also available.

### Return Values (Prompt Hooks)

**PreToolUse** can return:
```json
{
  "decision": "approve" | "block",
  "reason": "explanation",
  "permissionDecision": "deny" | "ask",
  "updatedInput": {}
}
```

**PostToolUse** can return:
```json
{
  "decision": "block",
  "reason": "explanation",
  "additionalContext": "info for Claude"
}
```

- `"block"` prevents Claude from seeing the tool output (useful for filtering sensitive data)
- Omitting `decision` or returning nothing allows normal processing (implicit approve)
- Changes from the tool are NOT reverted - blocking only affects what Claude sees

### Example Hooks

Auto-format after writes:
```json
"PostToolUse": [{
  "matcher": "Write|Edit",
  "hooks": [{
    "type": "command",
    "command": "prettier --write $CLAUDE_FILE_PATHS"
  }]
}]
```

Generate session title on stop:
```json
"Stop": [{
  "hooks": [{
    "type": "command",
    "command": "~/.claude/hooks/stop.sh"
  }]
}]
```

## StatusLine

Custom status bar displayed during sessions.

### Configuration

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/statusline.sh"
}
```

### Input (via stdin)

Script receives JSON:
```json
{
  "workspace": {
    "current_dir": "/path/to/project"
  },
  "model": {
    "display_name": "Opus 4.5"
  },
  "session_id": "abc123",
  "cost": {
    "total_cost_usd": 0.15,
    "total_lines_added": 50,
    "total_lines_removed": 10
  }
}
```

### Output

Script prints status line with ANSI colors. Example output:
```
project-name main (3) Opus 4.5 $0.150 +50 -10 (5K+10K+50K):2K [1:32]
```

## Model

Set the default model:

```json
"model": "opus"
```

Options:
- `"opus"` - Claude Opus 4.5
- `"sonnet"` - Claude Sonnet
- `"haiku"` - Claude Haiku
- Full model ID (e.g., `"claude-opus-4-5-20251101"`)

## Environment Variables

Set environment for the session:

```json
"env": {
  "NODE_ENV": "development",
  "DEBUG": "true"
}
```

## Other Options

```json
{
  "alwaysThinkingEnabled": true,
  "enabledPlugins": {
    "plugin-name@source": true
  }
}
```
