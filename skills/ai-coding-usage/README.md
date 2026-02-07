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
- **Incremental**: Auto-detects new/changed files and updates only what's needed
- **Persistent**: DuckDB database persists between runs (`~/.local/share/ai-coding-usage/usage.duckdb`)
- **Safe**: Timestamped backup before every load/reload
- **Agent-friendly**: `--help` and `--schema` provide complete documentation for AI agents
- **Fast**: DuckDB is extremely fast for analytical queries

## Commands

| Command | Description |
|---------|-------------|
| `ai-coding-usage` | Auto-detect changes, incremental update, show summary |
| `ai-coding-usage update` | Explicit incremental update |
| `ai-coding-usage reload` | Force reload all data (with backup) |
| `ai-coding-usage --help` | Detailed help documentation |
| `ai-coding-usage --schema` | Database schema with example queries |
| `ai-coding-usage query "SQL"` | Execute a SQL query |
| `ai-coding-usage search "query"` | Search conversation content |
| `ai-coding-usage shell` | Open interactive DuckDB shell |

## For AI Agents

This tool is designed to be used by AI coding agents. To analyze usage:

1. Run `ai-coding-usage --schema` to get the complete database schema
2. Write SQL queries based on the schema documentation
3. Execute queries with `ai-coding-usage query "YOUR SQL"`

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

### Core Tables

| Table | Description |
|-------|-------------|
| `claude_tools` | Claude Code tool invocations (with source_file for incremental) |
| `claude_sessions` | Claude Code session metadata |
| `messages` | Conversation content (user text, assistant text + thinking) |
| `cursor_prompts` | Cursor user prompts |
| `cursor_workspaces` | Cursor workspace metadata |

| `system_events` | System records: turn_duration, api_error, stop_hook_summary |
| `queue_operations` | User inputs queued during assistant responses |
| `pr_links` | Session-to-PR mappings |
| `_sessions_index` | Session metadata from sessions-index.json (summary, first_prompt) |
| `_loaded_files` | File mtime tracking for incremental loading |

### Views

| View | Description |
|------|-------------|
| `turn_durations` | Response timing from system events |
| `api_errors` | API error events |
| `session_overview` | Sessions joined with index metadata (summary, first_prompt) |

### Unified Views (Cross-Tool Analysis)

| View | Description |
|------|-------------|
| `interactions` | **Primary unified view** - all interactions normalized to one schema |
| `daily_by_source` | Daily counts separated by tool |
| `weekly_summary` | Weekly aggregation by source |
| `project_activity` | Project-level summary across both tools |
| `repo_activity` | Repository-level (aggregates worktrees) |
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

### Cost Views

| View | Description |
|------|-------------|
| `model_pricing` | API rates per million tokens (editable) |
| `usage_with_cost` | Tool invocations with pre-calculated `cost_usd` |
| `cost_summary` | Pre-aggregated costs by repo/model |

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

-- Turn durationsSELECT * FROM turn_durations ORDER BY duration_ms DESC LIMIT 10;

-- Session overview with summariesSELECT session_id, repo_name, summary FROM session_overview
WHERE summary IS NOT NULL ORDER BY started_at DESC LIMIT 10;

-- API errorsSELECT * FROM api_errors ORDER BY timestamp DESC;

-- PR linksSELECT * FROM pr_links;

-- Skill usage
SELECT context as skill_name, COUNT(*) as uses
FROM claude_tools
WHERE tool_name = 'Skill'
GROUP BY context
ORDER BY uses DESC;

-- Compare Claude vs Cursor usage
SELECT
    DATE_TRUNC('week', date) as week,
    SUM(claude_tools) as claude,
    SUM(cursor_prompts) as cursor
FROM daily_summary
GROUP BY week
ORDER BY week DESC;
```

## Data Sources

### Claude Code
- **Location**: `~/.claude/projects/*/*.jsonl`
- **Contents**: Full tool invocation logs, messages, system events, queue operations, PR links
- **Metadata**: `sessions-index.json` files with session summaries

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

1. On first run, scans source directories and loads all log files
2. On subsequent runs, auto-detects new/changed files via mtime comparison
3. Incrementally updates only changed files (delete stale rows by `source_file`, reinsert)
4. Creates timestamped backup before every load/reload
5. Database persists at `~/.local/share/ai-coding-usage/usage.duckdb`

Use `reload` to force a full rebuild from scratch.
