# settings.json Reference

Complete reference for Claude Code settings configuration.

## File Locations

| Level | Path | Purpose |
|-------|------|---------|
| Global | `~/.claude/settings.json` | User defaults for all projects <!-- portability: allow --> |
| Project | `.claude/settings.json` | Project-specific, version-controlled |
| Local | `.claude/settings.local.json` | Per-machine overrides, gitignored |

Settings merge hierarchically: global → project → local.

### settings.local.json

The local file (`.claude/settings.local.json`) is gitignored and ideal for:
- **Personal model preference** when the team uses a different default
- **Machine-specific paths** in permissions or hooks
- **Experimental hooks** you're testing before proposing to the team
- **Additional permissions** for your local workflow

```json
{
  "model": "opus",
  "permissions": {
    "allow": ["Bash(~/scripts/my-helper.sh:*)"]
  }
}
```

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
- For Bash, use `:*` suffix for prefix matching: `Bash(git push:*)` matches `git push`, `git push origin main`, etc. The colon is a delimiter (not literal), and `*` means "any arguments"

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

The `matcher` field is optional. If omitted or set to empty string `""`, the hook matches all tools for that event.

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
- `$CLAUDE_FILE_PATHS` - space-separated list of affected file paths. Quote in shell: `"$CLAUDE_FILE_PATHS"`
- `$CLAUDE_TOOL_INPUT` - tool parameters as JSON object
- `$CLAUDE_TOOL_NAME` - name of the tool being executed
- `$CLAUDE_PROJECT_DIR` - current project directory
- `$CLAUDE_WORKING_DIR` - current working directory
- `$CLAUDE_SESSION_ID` - session identifier

Standard OS variables and any variables from the `env` section in settings.json are also available.

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

- `"block"` prompts Claude with the `reason` as feedback after tool execution (for guiding next steps)
- Omitting `decision` or returning nothing means no additional feedback to Claude
- Changes from the tool are NOT reverted - PostToolUse provides feedback, not prevention

### Example Hooks

Auto-format after writes:
```json
"PostToolUse": [{
  "matcher": "Write|Edit",
  "hooks": [{
    "type": "command",
    "command": "prettier --write \"$CLAUDE_FILE_PATHS\""
  }]
}]
```

Generate session title on stop:
```jsonc
"Stop": [{
  "hooks": [{
    "type": "command",
    "command": "~/.claude/hooks/stop.sh"  // portability: allow
  }]
}]
```

## StatusLine

Custom status line displayed during sessions.

### Configuration

```jsonc
"statusLine": {
  "type": "command",
  "command": "~/.claude/scripts/statusline.sh"  // portability: allow
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
    "display_name": "Opus 5"
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
project-name main (3) Opus 5 $0.150 +50 -10 (5K+10K+50K):2K [1:32]
```

## Model

Set the default model:

```json
"model": "opus"
```

Options:
- `"opus"` - Claude Opus 5 (most capable)
- `"sonnet"` - Claude Sonnet 4.5 (balanced)
- `"haiku"` - Claude Haiku 4.5 (fast, lightweight)
- Full model ID (e.g., `"claude-opus-4-6"`, `"claude-sonnet-4-5-20250929"`)

## Rules Files

Modular alternative to large CLAUDE.md files. Rules are auto-loaded from `.claude/rules/`:

```
.claude/rules/
├── testing.md        # Testing conventions
├── security.md       # Security requirements
└── api-patterns.md   # API design rules
```

Each file is a standalone markdown document loaded into context automatically. Use rules files when:
- CLAUDE.md is getting long (>200 lines)
- Different team members maintain different rule sets
- Rules apply conditionally by topic

See [claude-md-patterns.md](claude-md-patterns.md) for full CLAUDE.md authoring guidance.

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
  "cleanupPeriodDays": 30,
  "enabledPlugins": {
    "plugin-name@source": true
  }
}
```

| Field | Description |
|-------|-------------|
| `alwaysThinkingEnabled` | Enable extended thinking for all prompts |
| `cleanupPeriodDays` | Auto-cleanup old session data after N days |
| `enabledPlugins` | Plugin activation (plugin ecosystem is early-stage) |
