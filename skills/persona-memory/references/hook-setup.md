# Hook Setup

Add these hooks to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ~/.claude/skills/persona-memory/scripts/session-start.ts"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ~/.claude/skills/persona-memory/scripts/session-end.ts"
          }
        ]
      }
    ]
  }
}
```

## Launching With Persona Memory

Use launcher wrapper:

```bash
claude-persona
```

or call script directly:

```bash
~/.claude/skills/persona-memory/scripts/launch-claude.sh
```

## Recommended Environment Variables

```bash
export AI_MEMORY_HOME="$HOME/.ai-memory"
export AI_MEMORY_PROFILE="default"
export AI_MEMORY_MAX_CONTEXT="2200"
```

## Notes

- Hooks should remain fail-open.
- Launcher enforces personality injection.
- Hooks support session lifecycle memory maintenance.
