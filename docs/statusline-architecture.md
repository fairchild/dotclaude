# Status Line Architecture

The status line is a custom status bar for Claude Code sessions, displaying project context, costs, and token metrics.

## Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLAUDE CODE RUNTIME                         │
│                                                                     │
│  settings.json ──► statusLine.command ──► statusline.sh            │
│      (config)                                (renderer)             │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ JSON stdin
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          statusline.sh                              │
│                                                                     │
│  1. Parse JSON (workspace, model, session_id, cost, lines)         │
│  2. Call get-session-tokens.sh for cumulative token data           │
│  3. Render colored status line to stdout                           │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ session_id
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    scripts/get-session-tokens.sh                    │
│                                                                     │
│  1. Find ~/.claude/projects/*/$session_id.jsonl                    │
│  2. Parse JSONL with jq to sum .message.usage across all turns     │
│  3. Return JSON: {input_tokens, output_tokens, cache_*, total_*}   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ cached at
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              ~/.claude/session-titles/$project/$session_id.tokens   │
│                                                                     │
│  TTL: 1 minute (refreshed in background if stale)                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    commands/status_line.md                          │
│                                                                     │
│  /status_line command - verbose explainer with ASCII diagrams      │
│  Calls get-session-tokens.sh directly for current token data       │
└─────────────────────────────────────────────────────────────────────┘
```

## File Reference

| File | Role | Invoked by |
|------|------|------------|
| `statusline.sh` | Render compact status bar | Claude Code (via settings.json) |
| `scripts/get-session-tokens.sh` | Extract token data from JSONL | statusline.sh, /status_line |
| `commands/status_line.md` | Verbose explainer command | User (`/status_line`) |
| `settings.json:130-133` | Hook registration | Claude Code startup |

## Data Flow

### 1. Claude Code calls statusline.sh

Claude Code passes JSON via stdin:

```json
{
  "workspace": { "current_dir": "/path/to/project" },
  "model": { "display_name": "Opus 4.5" },
  "session_id": "abc123...",
  "cost": {
    "total_cost_usd": 0.66,
    "total_lines_added": 28,
    "total_lines_removed": 5
  }
}
```

### 2. statusline.sh fetches token data

Calls `get-session-tokens.sh` with session_id, gets:

```json
{
  "input_tokens": 70,
  "output_tokens": 7000,
  "cache_creation_input_tokens": 210000,
  "cache_read_input_tokens": 1600000,
  "total_tokens": 7070,
  "total_input": 1810070
}
```

### 3. Rendered output

```
myproject fix/branch (3) Opus 4.5 $0.66 +28 -5 (70+210K+1.6M):7K [1:267]
```

## Token Caching

Token data is expensive to compute (parses JSONL). The status bar:

1. Checks `~/.claude/session-titles/$project/$session_id.tokens`
2. If missing or >1 min old, spawns background refresh
3. Uses cached data for immediate render

This keeps the status bar responsive while data updates in the background.

## Configuration

In `settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
```

## Troubleshooting

### Status bar shows no tokens

1. Check session file exists: `ls ~/.claude/projects/*/*.jsonl`
2. Verify get-session-tokens.sh works: `~/.claude/scripts/get-session-tokens.sh <session_id>`
3. Check token cache: `cat ~/.claude/session-titles/<project>/<session_id>.tokens`

### Token data is stale

The 1-minute cache TTL means data may lag. Force refresh:

```bash
rm ~/.claude/session-titles/$project/$session_id.tokens
```

### Status bar not appearing

1. Verify settings.json has statusLine config
2. Check statusline.sh is executable: `chmod +x ~/.claude/statusline.sh`
3. Test manually: `echo '{"workspace":{"current_dir":"."}}' | ~/.claude/statusline.sh`

## Related Files

- `README.md` - Quick reference for status line format
- `hooks/stop.sh` - Generates session titles at session end
- `scripts/generate-session-title.ts` - AI-powered session titling
