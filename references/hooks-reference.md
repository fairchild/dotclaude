# Hooks Reference

Complete reference for Claude Code hooks, including the new v2.1.0 features for scoped hooks in skills, agents, and commands.

## What's New in v2.1.0 (January 7, 2026)

**Major feature:** Hooks can now be defined directly in skill, agent, and command frontmatter!

- Scoped to component lifecycle (auto-cleanup when finished)
- Support `PreToolUse`, `PostToolUse`, and `Stop` events
- `once: true` option for single-execution hooks
- Enable specialized self-validating agents

## Configuration Locations

| Location | Scope | Use Case |
|----------|-------|----------|
| `~/.claude/settings.json` | Global (all sessions) | Codebase protection, session management |
| `.claude/settings.json` | Project-wide | Project-specific validation |
| Skill/agent frontmatter | Component lifecycle | Specialized validation per skill/agent |

## Hook Types

### PreToolUse
Runs before tool execution. Can modify input, add context, or block execution.

**Common use cases:**
- Security checks before Bash commands
- Validation before file writes
- Add environment context

**Decision options:** `allow`, `deny`, `ask`

**Can return:**
- `additionalContext` - Info passed to Claude
- `updatedInput` - Modified tool parameters

### PostToolUse
Runs immediately after successful tool execution.

**Common use cases:**
- Validate output format (CSV, JSON, YAML)
- Run linters/formatters
- Check file structure
- Log operations

**Decision options:** `allow`, `block`

**Can return:**
- `additionalContext` - Pass validation results to Claude

### Stop
Runs when agent/skill completes (not on user interrupt).

**Common use cases:**
- Final validation checks
- Generate reports
- Cleanup operations
- Session summaries

**Decision options:** `allow`, `block`

### SubagentStop
Runs when subagent (Task tool) completes.

**Available fields:**
- `agent_id` - Subagent identifier
- `agent_transcript_path` - Full transcript for debugging

## Scoped Hooks (Skills/Agents/Commands)

### Skill Example

```yaml
---
name: csv-editor
description: Edit CSV files with validation
hooks:
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: uv run $CLAUDE_PROJECT_DIR/.claude/hooks/validators/csv_validator.py
          timeout: 600
---

# CSV Editor Skill

Purpose: Edit CSV files with automatic validation after every write/edit.
```

### Agent Example

```yaml
---
name: experiment-creator
description: Creates UI experiments with strict conventions
hooks:
  PostToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: uv run $CLAUDE_PROJECT_DIR/.claude/hooks/validators/typescript_syntax_validator.py
        - type: command
          command: uv run $CLAUDE_PROJECT_DIR/.claude/hooks/validators/html_inline_validator.py
  Stop:
    - matcher: ""
      hooks:
        - type: command
          command: uv run $CLAUDE_PROJECT_DIR/.claude/hooks/validators/playwright_test_validator.py
---

# Experiment Creator Agent
...
```

### Command Example

```yaml
---
name: release
description: Create semantic versioned release
hooks:
  PreToolUse:
    - matcher: "Bash(git*)"
      hooks:
        - type: command
          command: uv run $CLAUDE_PROJECT_DIR/.claude/hooks/validators/git_release_preflight.py
  PostToolUse:
    - matcher: "Edit"
      hooks:
        - type: command
          command: uv run $CLAUDE_PROJECT_DIR/.claude/hooks/validators/changelog_format_validator.py
---
```

## Hook Configuration Options

```yaml
hooks:
  PostToolUse:
    - matcher: "Write|Edit"        # Regex: Write OR Edit
      hooks:
        - type: command             # Type: command or prompt
          command: "./script.sh"    # Script to execute
          timeout: 600              # Timeout in seconds (default: 60, max: 600)
          once: true                # Run only once per session (optional)
```

## Environment Variables

Available in all hook scripts:

```bash
$CLAUDE_PROJECT_DIR        # Absolute path to project root
$CLAUDE_ENV_FILE          # Path to persist vars (SessionStart only)
$CLAUDE_CODE_REMOTE       # "true" for web, empty for CLI
$CLAUDE_PLUGIN_ROOT       # For plugin hooks
```

## Hook Input (stdin JSON)

Every hook receives this JSON via stdin:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.csv",
    "content": "..."
  },
  "tool_use_id": "toolu_xyz"
}
```

Parse in Python:
```python
import sys
import json

hook_input = json.load(sys.stdin)
file_path = hook_input["tool_input"]["file_path"]
```

## Hook Output (stdout JSON)

### Basic Output (Non-blocking)
```json
{
  "continue": true,
  "systemMessage": "✅ Validation passed"
}
```

### Blocking Output (Stop execution)
```json
{
  "decision": "block",
  "reason": "CSV validation failed: missing required column 'id'",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Resolve this CSV error in /path/to/file.csv:\n  - Missing column: id\n  - Invalid format on line 5"
  }
}
```

### PreToolUse with Modified Input
```json
{
  "decision": "allow",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Security scan: no issues found",
    "updatedInput": {
      "command": "npm run lint:fix"
    }
  }
}
```

## Exit Codes

- **Exit 0**: Success. JSON output processed, stdout shown in verbose mode
- **Exit 2**: Blocking error. Only stderr used as error message
- **Other**: Non-blocking error. stderr shown in verbose mode

## Validator Script Template

```python
#!/usr/bin/env python3
"""CSV Validator - validates CSV format after Write/Edit"""
import sys
import json
import pandas as pd
from pathlib import Path

def validate_csv(file_path: str) -> list[str]:
    """Returns list of validation errors, empty if valid"""
    errors = []
    try:
        df = pd.read_csv(file_path)

        # Custom validation rules
        if df.empty:
            errors.append("CSV is empty")
        if "id" not in df.columns:
            errors.append("Missing required column: id")

    except Exception as e:
        errors.append(f"CSV parse error: {e}")

    return errors

if __name__ == "__main__":
    # Read hook input from stdin
    hook_input = json.load(sys.stdin)

    # Extract file path from tool input
    file_path = hook_input["tool_input"]["file_path"]

    # Validate
    errors = validate_csv(file_path)

    if errors:
        # Blocking output - agent will see this and auto-fix
        output = {
            "decision": "block",
            "reason": f"CSV validation failed for {file_path}",
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f"Resolve this CSV error in {file_path}:\n" +
                                    "\n".join(f"  - {e}" for e in errors)
            }
        }
        print(json.dumps(output))
        sys.exit(2)
    else:
        # Success output
        output = {
            "continue": True,
            "systemMessage": f"✅ Validation passed: {file_path}"
        }
        print(json.dumps(output))
        sys.exit(0)
```

## Matcher Patterns

| Pattern | Matches |
|---------|---------|
| `"Write"` | Exact match (case-sensitive) |
| `"Write\|Edit"` | Regex: Write OR Edit |
| `"Bash"` | All Bash commands |
| `"mcp__memory__.*"` | All tools from memory MCP server |
| `"*"` or `""` | All tools (match everything) |

## Common Validation Scripts

### TypeScript Syntax Validator
```bash
#!/bin/bash
# Check TypeScript files compile

HOOK_INPUT=$(cat)
FILE_PATH=$(echo "$HOOK_INPUT" | jq -r '.tool_input.file_path')

if [[ "$FILE_PATH" =~ \.ts$ ]]; then
    if ! bun tsc --noEmit "$FILE_PATH" 2>/dev/null; then
        echo '{"decision":"block","reason":"TypeScript compilation failed"}' >&2
        exit 2
    fi
fi

echo '{"continue":true}'
exit 0
```

### JSON Schema Validator
```python
#!/usr/bin/env python3
import sys
import json
import jsonschema

hook_input = json.load(sys.stdin)
file_path = hook_input["tool_input"]["file_path"]

if file_path.endswith(".json"):
    try:
        with open(file_path) as f:
            data = json.load(f)
        # Add schema validation here
    except json.JSONDecodeError as e:
        output = {
            "decision": "block",
            "reason": f"Invalid JSON: {e}"
        }
        print(json.dumps(output))
        sys.exit(2)

print('{"continue":true}')
sys.exit(0)
```

## Best Practices

### 1. Specialized Validation
- **DO**: Create focused validators per domain (CSV, JSON, TypeScript)
- **DON'T**: Create one giant validator for everything

### 2. Fast Feedback
- **DO**: Keep validators fast (<1s for most operations)
- **DON'T**: Run expensive operations in hot paths

### 3. Helpful Error Messages
- **DO**: Tell agent exactly what's wrong and how to fix it
- **DON'T**: Just say "validation failed"

```python
# Good
"additionalContext": "Resolve this CSV error in data.csv:\n  - Missing column: 'email'\n  - Row 5: Invalid date format"

# Bad
"additionalContext": "Validation failed"
```

### 4. Use `once: true` for Setup
- **DO**: Use for one-time initialization checks
- **DON'T**: Use for repeated validation

### 5. Test Validators Independently
```bash
# Test validator manually
echo '{"tool_input":{"file_path":"test.csv"}}' | ./validator.py
```

## Debugging Hooks

```bash
# View registered hooks
/hooks

# Run Claude in debug mode
claude --debug

# Check hook script permissions
ls -la .claude/hooks/validators/

# Test hook script manually
cat test_input.json | uv run .claude/hooks/validators/csv_validator.py
```

## Security Notes

1. **Validate inputs** - Never trust hook input blindly
2. **Quote shell variables** - Use `"$VAR"` not `$VAR`
3. **Use absolute paths** - Specify full paths to scripts
4. **Check file paths** - Block path traversal attempts (`..`)
5. **Timeout appropriately** - Set reasonable timeouts (default: 60s, max: 600s)

## Official Documentation

- **Hooks Reference**: https://code.claude.com/docs/en/hooks
- **Skills Reference**: https://code.claude.com/docs/en/skills
- **Agents Reference**: https://code.claude.com/docs/en/sub-agents
- **Slash Commands**: https://code.claude.com/docs/en/slash-commands
- **Changelog**: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md

## Examples in This Repo

See `hook-patterns.md` for global hook patterns (SessionStart, Stop, etc).

## Philosophy: Specialized Self-Validating Agents

> "Agents plus code beats agents." - IndyDevDan

Key principles:
1. **Focused agents** - One purpose, extraordinarily well
2. **Deterministic validation** - Code-based checks, not vibes
3. **Immediate feedback** - Catch errors before humans see them
4. **Specialized hooks** - Domain-specific validators per skill/agent
5. **Trust through validation** - Build systems that KNOW they work

### Validation Hierarchy

```
┌─────────────────────────────────────┐
│ Global Hooks (settings.json)        │  ← Codebase protection
│  - Security checks                  │
│  - Session management               │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│ Project Hooks (.claude/settings)    │  ← Project standards
│  - Test suite validation            │
│  - Build checks                     │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│ Scoped Hooks (skill/agent)          │  ← Specialized validation
│  - Domain-specific validation       │
│  - Format checks (CSV, JSON, etc)   │
│  - Convention enforcement           │
└─────────────────────────────────────┘
```

## Quick Start: Add Validation to a Skill

1. **Create validator script**
```bash
mkdir -p .claude/hooks/validators
touch .claude/hooks/validators/my_validator.py
chmod +x .claude/hooks/validators/my_validator.py
```

2. **Write validator** (use template above)

3. **Add hook to skill frontmatter**
```yaml
---
name: my-skill
hooks:
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: uv run $CLAUDE_PROJECT_DIR/.claude/hooks/validators/my_validator.py
---
```

4. **Test it**
```bash
# Manual test
echo '{"tool_input":{"file_path":"test.txt"}}' | uv run .claude/hooks/validators/my_validator.py

# Run skill and watch validation
/my-skill
```

That's it! Your skill now has specialized self-validation.
