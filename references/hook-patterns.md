# Hook Patterns

Standard hooks to use in your project's `.claude/settings.json`.

## Session Title Generation (Stop)

Generates AI-powered session titles when session ends.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/stop.sh"
          }
        ]
      }
    ]
  }
}
```

Already configured globally. Stores titles in `~/.claude/session-titles/{project}/{session-id}.txt`.

## Beads Integration (SessionStart + PreCompact)

For projects using beads (`bd`) issue tracking.

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bd prime"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bd prime"
          }
        ]
      }
    ]
  }
}
```

**What it does:**
- Refreshes beads context at session start
- Re-primes before context compaction
- Minimal token overhead (~50-100 tokens)

## Beads Mail Check (UserPromptSubmit)

For projects that inject beads updates before each prompt.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bd mail check --inject"
          }
        ]
      }
    ]
  }
}
```

**When to use:** Multi-session projects where coordination matters.

## Custom Status Line

Display project-specific metrics.

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
```

Override with project-specific:

```json
{
  "statusLine": {
    "type": "command",
    "command": ".claude/statusline.sh"
  }
}
```

## Hook Execution Order

Hooks run in this order:
1. `SessionStart` - When session begins
2. `UserPromptSubmit` - Before each user message processed
3. `PreCompact` - Before context window compaction
4. `Stop` - When session ends

## Matcher Patterns

Use `matcher` to conditionally run hooks:

```json
{
  "matcher": "*.ts",           // Only TypeScript files
  "matcher": "src/**",         // Only src directory
  "matcher": "",               // Always run (empty = match all)
}
```
