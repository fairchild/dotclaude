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

-- Activity by repository (aggregates worktrees)
SELECT repo_name, SUM(interactions) as total, SUM(worktrees) as branches
FROM repo_activity GROUP BY repo_name ORDER BY total DESC LIMIT 10;

-- Worktree branches within a repo
SELECT worktree_branch, SUM(interactions) as total
FROM project_activity WHERE repo_name = 'services'
GROUP BY worktree_branch ORDER BY total DESC;

-- Cost by repo (uses pre-calculated cost_usd)
SELECT repo_name, ROUND(SUM(cost_usd), 2) as cost
FROM usage_with_cost
WHERE CAST(timestamp AS TIMESTAMP) >= CURRENT_DATE - INTERVAL 7 DAY
GROUP BY repo_name ORDER BY cost DESC;

-- Full cost summary by repo and model
SELECT * FROM cost_summary ORDER BY cost_usd DESC;
```

## Cost Calculation

The script tracks tokens and calculates API costs automatically:

**Token columns** in `claude_tools`:
- `input_tokens`, `output_tokens` - Direct tokens
- `cache_write_tokens`, `cache_read_tokens` - Prompt caching tokens
- `model` - Model used (opus/sonnet/haiku)

**Cost views**:
- `model_pricing` - API rates per million tokens (update when prices change)
- `usage_with_cost` - Each row has pre-calculated `cost_usd`
- `cost_summary` - Pre-aggregated by repo/model

## Worktree Detection

The script automatically detects git worktrees and extracts repo/branch info:

- **Conductor worktrees**: `/conductor/workspaces/{repo}/{branch}` → repo_name, worktree_branch
- **Git worktrees**: `/.worktrees/{repo}/{branch}` → repo_name, worktree_branch
- **Regular repos**: `/code/{repo}` → repo_name only

New columns in `claude_tools` and views:
- `repo_name` - Repository name (extracted from path)
- `worktree_branch` - Branch name if worktree, NULL otherwise
- `is_worktree` - TRUE if path is a worktree

## Key Tables/Views

- `claude_tools` - Individual tool invocations (with model, tokens, repo/branch)
- `claude_sessions` - Session metadata
- `interactions` - Unified view (Claude + Cursor)
- `repo_activity` - Repository-level summary (aggregates worktrees)
- `project_activity` - Project-level with worktree info
- `usage_with_cost` - Tool invocations with pre-calculated `cost_usd`
- `cost_summary` - Pre-aggregated costs by repo/model
- `model_pricing` - API rates (editable)

Run `--schema` for complete documentation.
