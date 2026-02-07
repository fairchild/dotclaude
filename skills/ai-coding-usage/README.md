# ai-coding-usage

Unified usage analyzer for AI coding assistants (Claude Code & Cursor).

Loads local logs into a **persistent DuckDB database** for SQL-based analysis. Designed to be agent-friendly with comprehensive `--help` and `--schema` documentation.

## Quick Start

```bash
# Install
cp ai-coding-usage ~/.local/bin/
chmod +x ~/.local/bin/ai-coding-usage

# First run - loads data and shows summary
ai-coding-usage

# See what's available
ai-coding-usage --schema

# Query your data
ai-coding-usage query "SELECT * FROM tool_summary"
```

## Features

- **Unified**: Loads both Claude Code and Cursor data into one database
- **Persistent**: DuckDB database persists between runs (`~/.local/share/ai-coding-usage/usage.duckdb`)
- **Idempotent**: Safe to run repeatedly; use `reload` to refresh data
- **Agent-friendly**: `--help` and `--schema` provide complete documentation for AI agents
- **Fast**: DuckDB is extremely fast for analytical queries

## Commands

| Command | Description |
|---------|-------------|
| `ai-coding-usage` | Load data (if needed) and show summary |
| `ai-coding-usage --help` | Detailed help documentation |
| `ai-coding-usage --schema` | Database schema with example queries |
| `ai-coding-usage reload` | Force reload all data from source logs |
| `ai-coding-usage query "SQL"` | Execute a SQL query |
| `ai-coding-usage search "query"` | Search conversation content |
| `ai-coding-usage shell` | Open interactive DuckDB shell |

## For AI Agents

This tool is designed to be used by AI coding agents. To analyze usage:

1. Run `ai-coding-usage --schema` to get the complete database schema
2. Write SQL queries based on the schema documentation
3. Execute queries with `ai-coding-usage query "YOUR SQL"`

The `--schema` output includes:
- All table and column definitions
- Column types and descriptions
- Example queries for common use cases
- Useful SQL patterns

## Search

Search conversation content across all indexed sessions:

```bash
# ILIKE search (default)
ai-coding-usage search "memory"

# BM25 full-text search
ai-coding-usage search "memory" --fts

# Search reasoning traces
ai-coding-usage search "memory" --thinking

# Search both content and thinking
ai-coding-usage search "memory" --all

# Filters
ai-coding-usage search "refactor" --user --repo bertram-chat --since 7d -n 20
```

| Flag | Description |
|------|-------------|
| `--thinking` | Search reasoning traces instead of content |
| `--all` | Search both content and thinking |
| `--fts` | BM25 ranked full-text search |
| `-n N` | Limit results (default 10) |
| `--user` | User messages only |
| `--asst` | Assistant messages only |
| `--repo X` | Filter to repository |
| `--since T` | Time filter (7d, 4w, or YYYY-MM-DD) |

## Database Schema (Summary)

### Tables

| Table | Description |
|-------|-------------|
| `claude_tools` | Claude Code tool invocations (Bash, Edit, Write, Skill, etc.) |
| `claude_sessions` | Claude Code session metadata |
| `messages` | Conversation content (user text, assistant text + thinking) |
| `cursor_prompts` | Cursor user prompts |
| `cursor_workspaces` | Cursor workspace metadata |

### Unified Views (Cross-Tool Analysis)

| View | Description |
|------|-------------|
| `interactions` | **Primary unified view** - all interactions normalized to one schema |
| `daily_by_source` | Daily counts separated by tool |
| `weekly_summary` | Weekly aggregation by source |
| `project_activity` | Project-level summary across both tools |
| `category_breakdown` | Usage by category (tool names / prompts) |
| `session_summary` | Unified session metrics |
| `peak_hours` | Find your most productive hours |
| `hourly_activity` | Time-series at hourly granularity |
| `recent_interactions` | Last 100 interactions for quick review |

### Conversation Views

| View | Description |
|------|-------------|
| `conversation_search` | Messages with content/thinking previews |
| `session_messages` | Per-session aggregation with topic extraction |
| `recent_conversations` | Last 50 sessions |
| `conversation_pairs` | User/assistant turns joined on parent_uuid |
| `message_stats` | Daily message volume by harness/role |

### Summary Views

| View | Description |
|------|-------------|
| `daily_summary` | Aggregated daily usage across both tools |
| `tool_summary` | Tool usage statistics with percentages |

Run `ai-coding-usage --schema` for complete documentation.

## Example Queries

```sql
-- Most used tools
SELECT tool_name, COUNT(*) as uses
FROM claude_tools
GROUP BY tool_name
ORDER BY uses DESC;

-- Daily usage trend
SELECT * FROM daily_summary 
ORDER BY date DESC 
LIMIT 14;

-- Skill usage
SELECT context as skill_name, COUNT(*) as uses
FROM claude_tools
WHERE tool_name = 'Skill'
GROUP BY context
ORDER BY uses DESC;

-- Search Cursor prompts
SELECT timestamp, prompt_text
FROM cursor_prompts
WHERE prompt_text ILIKE '%refactor%';

-- Compare Claude vs Cursor usage
SELECT 
    DATE_TRUNC('week', date) as week,
    SUM(claude_tools) as claude,
    SUM(cursor_prompts) as cursor
FROM daily_summary
GROUP BY week
ORDER BY week DESC;
```

### Unified Views Examples

```sql
-- All recent interactions across both tools
SELECT * FROM recent_interactions;

-- Interactions per project (both tools combined)
SELECT project_name, source, COUNT(*) as total
FROM interactions
GROUP BY project_name, source
ORDER BY total DESC;

-- Your peak coding hours
SELECT hour_of_day, SUM(interactions) as total
FROM peak_hours
GROUP BY hour_of_day
ORDER BY total DESC
LIMIT 5;

-- Weekly comparison
SELECT week_start, source, interactions, active_days
FROM weekly_summary
ORDER BY week_start DESC, source;

-- Projects where you use both tools
SELECT project_name,
       SUM(CASE WHEN source = 'claude_code' THEN interactions END) as claude,
       SUM(CASE WHEN source = 'cursor' THEN interactions END) as cursor
FROM project_activity
GROUP BY project_name
HAVING claude > 0 AND cursor > 0
ORDER BY claude + cursor DESC;
```

## Data Sources

### Claude Code
- **Location**: `~/.claude/projects/*/*.jsonl`
- **Contents**: Full tool invocation logs including:
  - Tool name (Bash, Edit, Write, Skill, Task, etc.)
  - Context (command, file path, etc.)
  - Timestamps
  - Token usage

### Cursor
- **Location**: `~/Library/Application Support/Cursor/User/workspaceStorage/*/state.vscdb`
- **Contents**: User prompts and chat history
- **Note**: Cursor does not log tool-level detail like Claude Code

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_CODING_USAGE_DB` | `~/.local/share/ai-coding-usage/usage.duckdb` | Database path |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code logs path |

## Requirements

- **DuckDB** (required): `brew install duckdb` or download from [duckdb.org](https://duckdb.org)
- **jq** (optional, for Cursor workspace.json parsing)

## How It Works

1. On first run (or `reload`), scans source directories for log files
2. Parses Claude Code JSONL files and Cursor SQLite databases
3. Loads data into normalized tables in DuckDB
4. Creates summary views for common queries
5. Database persists at `~/.local/share/ai-coding-usage/usage.duckdb`

Subsequent runs skip loading if data exists. Use `reload` to refresh.

## Tips

- Use `LIMIT` when exploring large result sets
- Use `ILIKE` for case-insensitive text search
- The `tool_summary` and `daily_summary` views are pre-computed for fast access
- Use `ai-coding-usage shell` for interactive exploration
- DuckDB supports CTEs, window functions, and modern SQL features
