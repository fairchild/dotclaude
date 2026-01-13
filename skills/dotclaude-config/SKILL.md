---
name: dotclaude-config
description: Work with Claude Code configuration at global (~/.claude) or project (.claude/) level. Use when editing settings.json (permissions, hooks, statusline, model), managing MCP servers, or creating agents/commands/skills. Determines context automatically and provides guidance on global vs project placement to avoid duplication.
license: Apache 2.0
---

# Claude Code Configuration

Work with Claude Code configuration at any level - global (`~/.claude/`) or project (`.claude/`).

## First: Determine Context

Before making changes, identify where you're working and what already exists:

```bash
# Where are we?
pwd

# In a project repo or in ~/.claude itself?
[[ "$(pwd)" == "$HOME/.claude"* ]] && echo "GLOBAL" || echo "PROJECT"

# What config exists at each level?
ls -la ~/.claude/settings.json ~/.claude.json 2>/dev/null
ls -la .claude/settings.json .mcp.json 2>/dev/null
```

**Context determines approach:**

| Context | You're configuring... | Primary concern |
|---------|----------------------|-----------------|
| **Global** (`~/.claude`) | Personal defaults for all projects | Reusable patterns |
| **Project** (`.claude/`) | Project-specific behavior | Avoid duplicating global |

## Working in Project Context

When configuring a project's `.claude/` directory, always follow this workflow:

### 1. Audit Global Config First

Before adding anything to project config, examine what's already defined globally:

```bash
# Check global settings
cat ~/.claude/settings.json 2>/dev/null | jq .

# Check global MCP servers
cat ~/.claude.json 2>/dev/null | jq .mcpServers

# List global agents, commands, skills
ls ~/.claude/agents/ ~/.claude/commands/ ~/.claude/skills/ 2>/dev/null
```

### 2. Apply the Reuse Principle

**Only add to project config what is:**
- Unique to this project (project-specific MCP servers, custom workflows)
- Overriding global behavior intentionally (stricter permissions, different model)
- Sharable with the team via version control

**Do NOT duplicate:**
- Permissions already in global config
- MCP servers you use across all projects
- Personal agents/skills that aren't project-specific

### 3. Explain Your Reasoning

When making recommendations, always explain WHY:

```markdown
**Recommendation:** Add this permission to `.claude/settings.json`

**Reasoning:** This permission is project-specific because:
- It references paths unique to this project (`./src/api/**`)
- The global config doesn't cover this use case
- Team members will need this when they clone the repo

**Not adding to global because:** This pattern only makes sense for this project's structure.
```

## Placement Decision Guide

Use this to decide where configuration belongs:

| Configuration | Global (`~/.claude`) | Project (`.claude/`) |
|--------------|---------------------|---------------------|
| **Permissions** | Personal security rules (deny secrets, keys) | Project-specific paths, team-agreed rules |
| **Hooks** | Personal workflows (formatters, linters) | Project build/test hooks, CI-related |
| **StatusLine** | Personal preference | Never (statusline is personal) |
| **Model** | Personal default | Team agreement on model for project |
| **MCP Servers** | Personal tools (perplexity, notion) | Project-specific APIs, databases |
| **Agents** | Personal productivity agents | Project-specific workflows |
| **Skills** | General-purpose skills | Project/domain-specific skills |
| **Commands** | Personal shortcuts | Project-specific operations |
| **CLAUDE.md** | Personal preferences, style | Project context, architecture, conventions |

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

### claude-code-guide

Query official Claude Code documentation:

```
Task(subagent_type="claude-code-guide", prompt="How do hooks work in settings.json?")
```

**When to use:** Latest features, undocumented behavior, syntax verification.

### Explore

Examine actual configuration across levels:

```
Task(subagent_type="Explore", prompt="Compare global and project permissions")
Task(subagent_type="Explore", prompt="What MCP servers are configured at each level?")
```

**When to use:** Understanding current state, finding conflicts, debugging.

## Quick Reference

### Permissions

```json
"permissions": {
  "allow": ["Bash(git status)", "Read(./src/**)"],
  "deny": ["Read(.env)", "Read(**/*.key)"],
  "ask": ["Bash(git push:*)"]
}
```

### Hooks

```json
"hooks": {
  "PostToolUse": [{"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "..."}]}]
}
```

### Model

```json
"model": "opus"  // or "sonnet", "haiku"
```

## Detailed Documentation

- **settings.json schema**: See [references/settings-json.md](references/settings-json.md)
- **MCP configuration**: See [references/mcp-config.md](references/mcp-config.md)
- **Extensibility (agents/commands/skills)**: See [references/extensibility.md](references/extensibility.md)

## Example: Project Config Audit

When asked to configure a project, produce an audit like this:

```markdown
## Configuration Audit

### Global Config (already have)
- **Permissions**: deny secrets/keys, allow git commands
- **MCP**: perplexity-mcp (personal)
- **Hooks**: PostToolUse formatter, Stop session-title
- **Model**: opus

### Project Needs
- Custom permission for `./packages/**` paths
- MCP server for project's Supabase instance
- Agent for project's deployment workflow

### Recommendations

1. **Add to `.claude/settings.json`:**
   ```json
   {"permissions": {"allow": ["Read(./packages/**)"]}}
   ```
   *Reasoning: Project-specific path not in global config*

2. **Add to `.mcp.json`:**
   ```json
   {"mcpServers": {"supabase": {...}}}
   ```
   *Reasoning: Project database, needs team access via git*

3. **Skip adding:**
   - General git permissions (already global)
   - Perplexity MCP (personal, not project-specific)
   - Formatter hooks (already in global PostToolUse)
```

## Common Tasks

### Add a project-specific permission

First check global: `cat ~/.claude/settings.json | jq .permissions`

If not covered, add to `.claude/settings.json`:
```json
"permissions": {"allow": ["Bash(npm run build:*)"]}
```

### Add a project MCP server

Add to `.mcp.json` (not `~/.claude.json`) so team gets it:
```json
{"mcpServers": {"project-db": {"command": "...", "env": {"DB_URL": "${PROJECT_DB_URL}"}}}}
```

### Create a project-specific agent

Create `.claude/agents/deploy.md` for project workflows.
Keep personal agents in `~/.claude/agents/`.

### Override global settings

Project settings merge with (and can override) global:
```json
// .claude/settings.json - stricter for this project
{"permissions": {"deny": ["Write(./contracts/**)"]}}
```
