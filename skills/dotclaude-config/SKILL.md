---
name: dotclaude-config
description: Work with Claude Code configuration in ~/.claude directories. Use when editing settings.json (permissions, hooks, statusline, model), managing MCP servers (.mcp.json), or creating/editing agents, commands, and skills. Also use when questions arise about global vs project config merging.
---

# Claude Code Configuration

This skill helps work with Claude Code configuration directories (~/.claude and project .claude/).

## Configuration Hierarchy

Settings merge from general to specific (later overrides earlier):

1. **Global**: `~/.claude/settings.json` - applies to all projects
2. **Project**: `.claude/settings.json` - project-specific, git-committed
3. **Local**: `.claude/settings.local.json` - per-machine, gitignored

For MCP servers:
- **Global**: `~/.claude.json` (mcpServers key)
- **Project**: `.mcp.json` (mcpServers key)

For instructions:
- **Global**: `~/.claude/CLAUDE.md`
- **Project**: `CLAUDE.md` or `.claude/CLAUDE.md`

## Using Built-in Subagents

This skill's references provide a working snapshot of Claude Code configuration. For current official documentation or features not covered here, use built-in subagents:

### claude-code-guide

Use `Task(subagent_type="claude-code-guide")` to query official Claude Code documentation:

```
Task(subagent_type="claude-code-guide", prompt="How do I configure hooks in settings.json?")
Task(subagent_type="claude-code-guide", prompt="What MCP server options are available?")
Task(subagent_type="claude-code-guide", prompt="How do I create a custom slash command?")
```

**When to use:**
- Questions about latest Claude Code features
- Clarification on undocumented behavior
- Verification of syntax or options
- Claude Agent SDK questions

### Explore

Use `Task(subagent_type="Explore")` to examine the user's actual configuration:

```
Task(subagent_type="Explore", prompt="What hooks are configured in ~/.claude/settings.json?")
Task(subagent_type="Explore", prompt="List all MCP servers in this project")
```

**When to use:**
- Understanding current configuration state
- Finding existing agents, skills, or commands
- Debugging configuration issues

## Quick Reference

### Permissions

Control tool access with `allow`, `deny`, `ask` arrays:

```json
"permissions": {
  "allow": ["Bash(git status)", "Read(./src/**)"],
  "deny": ["Read(.env)", "Read(**/*.key)"],
  "ask": ["Bash(git push:*)"]
}
```

Pattern format: `ToolName(glob-pattern)` or `ToolName` for all uses.

### Hooks

Execute scripts at lifecycle events:

```json
"hooks": {
  "PreToolUse": [{"matcher": "Write", "hooks": [{"type": "command", "command": "..."}]}],
  "PostToolUse": [...],
  "Stop": [...],
  "SessionStart": [...],
  "PreCompact": [...]
}
```

### StatusLine

Custom status bar script:

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/statusline.sh"
}
```

Script receives JSON via stdin with workspace, model, cost, token data.

### Model

```json
"model": "opus"  // or "sonnet", "haiku", full model ID
```

## Detailed Documentation

- **settings.json schema**: See [references/settings-json.md](references/settings-json.md)
- **MCP configuration**: See [references/mcp-config.md](references/mcp-config.md)
- **Extensibility (agents/commands/skills)**: See [references/extensibility.md](references/extensibility.md)

## Common Tasks

### Add a permission

```json
// Allow specific tool pattern
"allow": ["Bash(npm test:*)"]

// Deny sensitive file access
"deny": ["Read(**/*secret*)"]

// Prompt before destructive operations
"ask": ["Bash(rm -rf:*)"]
```

### Add an MCP server

In `.mcp.json` or via CLI:

```bash
claude mcp add-json --scope=user my-server '{"command":"uvx","args":["mcp-server-name"]}'
```

### Create a hook

```json
"hooks": {
  "PostToolUse": [{
    "matcher": "Write|Edit",
    "hooks": [{"type": "command", "command": "prettier --write $CLAUDE_FILE_PATHS"}]
  }]
}
```

### Create an agent

Create `agents/my-agent.md` with frontmatter:

```markdown
---
name: my-agent
description: What the agent does and when to use it
---

# Agent instructions here
```

### Create a skill

Create `skills/my-skill/SKILL.md` with frontmatter:

```markdown
---
name: my-skill
description: What the skill does and triggers for when to use it
---

# Skill instructions
```

Add `references/` for detailed docs, `scripts/` for executables, `assets/` for templates.

### Create a command

Create `commands/my-command.md`:

```markdown
---
description: What /my-command does
---

Prompt that executes when user runs /my-command
```
