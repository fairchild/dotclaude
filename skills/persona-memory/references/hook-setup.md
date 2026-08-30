# Hook Setup

Add these hooks to `~/.claude/settings.json`: <!-- portability: allow — names Claude Code's own settings file -->

A hook command runs from an arbitrary cwd, so it needs an absolute path.
`<skill-dir>` below stands for this skill's base directory — expand it when you
write the entry.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun <skill-dir>/scripts/session-start.ts"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun <skill-dir>/scripts/session-end.ts"
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

or call the script directly from this skill's base directory:

```bash
scripts/launch-claude.sh
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
