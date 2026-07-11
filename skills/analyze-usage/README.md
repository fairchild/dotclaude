# analyze-usage

Unified usage analyzer for AI coding assistants (Claude Code, Codex, and Cursor).

Loads local logs into a **persistent DuckDB database** for SQL-based analysis. Designed to be agent-friendly with detailed `--help` and `--schema` documentation.

## Quick Start

```bash
# Install
install -d -m 755 ~/.local/bin ~/.local/share/analyze-usage
install -m 755 skills/analyze-usage/scripts/analyze-usage ~/.local/bin/analyze-usage
install -m 644 skills/analyze-usage/references/canonical-agent-schema.duckdb.sql \
  ~/.local/share/analyze-usage/canonical-agent-schema.duckdb.sql

# First run - loads data and shows summary
analyze-usage

# See what's available
analyze-usage --schema

# Query your data
analyze-usage query "SELECT * FROM tool_summary"
```

## Features

- **Unified**: Loads Claude Code, Codex, and Cursor data into one database
- **Incremental**: Detects new, changed, and deleted files with nanosecond mtime plus file size
- **Persistent**: DuckDB database persists between runs (`~/.local/share/analyze-usage/usage.duckdb`)
- **Fail-closed**: Builds updates against a temporary copy and publishes only after success
- **Recoverable reloads**: Rebuilds atomically and keeps a timestamped backup of the prior database
- **Agent-friendly**: `--help` and `--schema` provide complete documentation for AI agents
- **Canonical reference**: Installs an empty normalized schema for future loaders
- **Fast**: DuckDB is extremely fast for analytical queries

## Commands

| Command | Description |
|---------|-------------|
| `analyze-usage` | Auto-detect changes, incremental update, show summary |
| `analyze-usage update` | Explicit incremental update |
| `analyze-usage reload` | Force reload all data (with backup) |
| `analyze-usage --help` | Detailed help documentation |
| `analyze-usage --schema` | Database schema with example queries |
| `analyze-usage query "SQL"` | Execute a SQL query |
| `analyze-usage search "query"` | Search conversation content |
| `analyze-usage shell` | Open interactive DuckDB shell |

## For AI Agents

This tool is designed to be used by AI coding agents. To analyze usage:

1. Run `analyze-usage --schema` to get the complete database schema
2. Write SQL queries based on the schema documentation
3. Execute queries with `analyze-usage query "YOUR SQL"`

## Search

Search conversation content across all indexed sessions:

```bash
# ILIKE search (default)
analyze-usage search "memory"

# BM25 full-text search
analyze-usage search "memory" --fts

# Search reasoning traces
analyze-usage search "memory" --thinking

# Search both content and thinking
analyze-usage search "memory" --all

# Filters
analyze-usage search "refactor" --user --repo bertram-chat --since 7d -n 20
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
| `codex_tools` | Codex tool invocations |
| `codex_sessions` | Codex session metadata |
| `codex_token_counts` | Codex per-turn token snapshots |
| `codex_developer_messages` | Codex developer-role instruction payloads |
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
| `interactions` | Per-source activity events: tool calls for Claude/Codex, prompts for Cursor |
| `daily_by_source` | Daily counts separated by tool |
| `weekly_summary` | Weekly aggregation by source |
| `project_activity` | Project-level summary across both tools |
| `repo_activity` | Repository-level (aggregates worktrees) |
| `category_breakdown` | Usage by category (tool names / prompts) |
| `session_summary` | Unified session metrics |
| `peak_hours` | Find hours with the most recorded activity |
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
| `model_pricing` | Known Claude API rates per million tokens (editable) |
| `codex_model_pricing` | Known OpenAI Standard API-equivalent token rates and long-context rules (editable) |
| `usage_with_cost` | One Claude assistant turn per row with `pricing_status` and API-equivalent `cost_usd` |
| `codex_usage_with_cost` | One Codex token snapshot with token components, long-context handling, and API-equivalent cost |
| `provider_usage_with_cost` | Unified provider/harness/model tokens, cost components, no-cache baseline, and cache savings |
| `provider_cost_summary` | Provider/harness/model token and cost aggregates |
| `cache_efficiency_summary` | Cache utilization, no-cache baseline, and estimated cost reduction |
| `cost_summary` | Backward-compatible Claude repo/model aggregate |

Run `analyze-usage --schema` for complete documentation.

## Canonical Schema Reference

The skill now ships a normalized cross-harness reference schema at
`references/canonical-agent-schema.duckdb.sql`.

- every table has an `id` primary key
- foreign keys use `{table}_id`
- provider-native identifiers use `external_*`
- every table includes `created_at` and `updated_at`

The analyzer loads this SQL file idempotently during database bootstrap. The
tables are a reference schema only; current loaders populate the harness-specific
tables and views.
When the script is installed standalone into `~/.local/bin`, it reads the same
checked-in schema file from `~/.local/share/analyze-usage/`.

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

-- Turn durations
SELECT * FROM turn_durations ORDER BY duration_ms DESC LIMIT 10;

-- Session overview with summaries
SELECT session_id, repo_name, summary FROM session_overview
WHERE summary IS NOT NULL ORDER BY started_at DESC LIMIT 10;

-- API errors
SELECT * FROM api_errors ORDER BY timestamp DESC;

-- PR links
SELECT * FROM pr_links;

-- Skill usage
SELECT context as skill_name, COUNT(*) as uses
FROM claude_tools
WHERE tool_name = 'Skill'
GROUP BY context
ORDER BY uses DESC;

-- Compare harness usage
SELECT
    source,
    COUNT(*) as interactions
FROM interactions
GROUP BY source
ORDER BY interactions DESC;
```

## Data Sources

### Claude Code
- **Location**: `~/.claude/projects/*/*.jsonl`
- **Contents**: Full tool invocation logs, messages, system events, queue operations, PR links
- **Metadata**: `sessions-index.json` files with session summaries

### Codex
- **Location**: `~/.codex/sessions/**/*.jsonl`, `~/.codex/archived_sessions/*.jsonl`
- **Metadata**: `~/.codex/session_index.jsonl`
- **Contents**: session metadata, user/assistant messages, tool calls, token-count snapshots, developer-role instruction payloads
- **Note**: developer-role payloads are stored separately in `codex_developer_messages` so they remain queryable without polluting default conversation search

### Cursor
- **Location**: `~/Library/Application Support/Cursor/User/workspaceStorage/*/state.vscdb`
- **Contents**: User prompts and chat history
- **Note**: Cursor does not log tool-level detail like Claude Code

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANALYZE_USAGE_DB` | `~/.local/share/analyze-usage/usage.duckdb` | Database path |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code logs path |
| `CODEX_HOME` | `~/.codex` | Codex logs path |
| `CURSOR_USER_DIR` | Platform Cursor user directory | Cursor `User` directory override |

## Requirements

- **DuckDB** (required): `brew install duckdb` or download from [duckdb.org](https://duckdb.org)
- **jq** (optional, for Cursor workspace.json parsing)

## How It Works

1. On first run, scans source directories and loads all log files
2. On subsequent runs, detects new, changed, and deleted files using nanosecond mtime plus file size
3. Applies updates to a temporary database copy; the existing database remains intact if any required step fails
4. Incrementally updates affected Claude and Codex session files; Cursor is reloaded wholesale when its small workspace store changes
5. Full reloads create a private timestamped backup before atomically replacing the database
6. Database persists at `~/.local/share/analyze-usage/usage.duckdb`

Use `reload` to force a full rebuild from scratch.

## Testing

Run the regression test harness with:

```bash
uv run skills/analyze-usage/tests/test_analyze_usage.py
```

The suite covers bootstrap and legacy migration plus deletion/same-second detection,
atomic failures, quoted paths and search, provider-level token costs, long-context
pricing, cache savings, editable pricing, Codex ingestion, and Codex-managed worktrees.

## Interpretation and privacy

`interactions` is a common shape, not a common unit: Claude Code and Codex rows
represent tool calls, while Cursor rows represent prompts. Use messages,
sessions, active days, or per-source trends for cross-harness comparisons.
Source timestamps remain UTC; calendar views group through a derived local
timestamp using DuckDB's system timezone.

Cost views are API-equivalent estimates. Known Codex models apply verified
OpenAI Standard API rates and long-context multipliers; this still does not
represent ChatGPT/Codex subscription or purchased-credit spend. Unknown models
remain unpriced instead of receiving a guessed fallback rate. Provider discounts,
batch/priority processing, regional pricing, and unrecorded traffic can differ.

The database and its backups contain prompts, assistant text, reasoning traces,
developer instructions, tool arguments, paths, and PR metadata. Files are
created privately, but they still deserve the same handling as source logs.
