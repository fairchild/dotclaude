---
name: ai-coding-usage
description: Analyze AI coding assistant usage patterns across Claude Code and Cursor. Use when user asks about their coding usage, tool statistics, productivity patterns, skill popularity, session history, or wants to query their AI coding logs. Triggers include "usage", "how much have I used", "most used tools", "skill popularity", "coding stats", "productivity patterns".
license: Apache-2.0
---

# AI Coding Usage

Unified usage analyzer for Claude Code and Cursor. Loads logs into DuckDB for SQL analysis.

## Quick Start

```bash
# Run the script (loads data on first run)
scripts/ai-coding-usage

# Show database schema and example queries
scripts/ai-coding-usage --schema

# Query your data
scripts/ai-coding-usage query "SELECT * FROM tool_summary"
```

## Commands

| Command | Description |
|---------|-------------|
| (default) | Load data if needed, show summary |
| `reload` | Force reload all data from source logs |
| `query "SQL"` | Execute SQL query |
| `shell` | Interactive DuckDB shell |
| `--schema` | Database schema with example queries |
| `--help` | Full help documentation |

## Common Queries

```sql
-- Most used tools
SELECT * FROM tool_summary;

-- Daily usage (last 2 weeks)
SELECT * FROM daily_summary ORDER BY date DESC LIMIT 14;

-- Skill popularity
SELECT regexp_extract(context, '"skill":"([^"]+)"', 1) as skill, COUNT(*) as uses
FROM claude_tools WHERE tool_name = 'Skill'
GROUP BY skill ORDER BY uses DESC;

-- Peak coding hours
SELECT hour_of_day, SUM(interactions) as total
FROM peak_hours GROUP BY hour_of_day ORDER BY total DESC LIMIT 5;

-- Project activity
SELECT project_name, SUM(interactions) as total
FROM project_activity GROUP BY project_name ORDER BY total DESC LIMIT 10;
```

## Key Tables/Views

- `claude_tools` - Individual tool invocations
- `claude_sessions` - Session metadata
- `tool_summary` - Aggregated tool stats
- `daily_summary` - Daily usage across both tools
- `interactions` - Unified view (Claude + Cursor)
- `peak_hours` - Hourly activity patterns

Run `--schema` for complete documentation.
