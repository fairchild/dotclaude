---
name: analyze-usage
description: Analyze local AI coding-assistant activity across Claude Code, Codex, and Cursor. Use when the user asks about coding usage, tool or skill statistics, activity patterns, repositories, sessions, token costs, conversation history, or wants to query their AI coding logs. Triggers include "usage", "how much have I used", "most used tools", "skill popularity", "coding stats", "activity patterns", and "session history".
license: Apache-2.0
---

# AI Coding Usage

Use `scripts/analyze-usage` to load local Claude Code, Codex, and Cursor logs into DuckDB, then answer usage questions with explicit scope and freshness. Treat the database as an activity ledger—not a productivity score or authoritative provider bill.

## Required workflow

1. Run `scripts/analyze-usage update` before current-state analysis. Stop if it fails; updates are atomic, so a failure leaves the prior database intact.
2. Run `scripts/analyze-usage --schema` when constructing unfamiliar queries.
3. Choose a metric whose unit matches the question. Read `references/analysis-guide.md` for query patterns and interpretation boundaries.
4. Report the database refresh time, time window, included harnesses, and any unknown-priced models with the result.

Do not compare raw `interactions` counts across harnesses as if they were equivalent: Claude Code and Codex rows are tool calls, while Cursor rows are prompts. Use messages, sessions, active days, or per-source trends for cross-harness comparisons.

## Commands

```bash
scripts/analyze-usage update
scripts/analyze-usage --schema
scripts/analyze-usage query "SELECT * FROM tool_summary"
scripts/analyze-usage search "memory"
scripts/analyze-usage search "don't panic" --fts
scripts/analyze-usage shell
scripts/analyze-usage reload
```

`update` detects changed and deleted files with nanosecond mtime plus file size, then publishes the new database atomically. `reload` rebuilds atomically and keeps a timestamped backup of the prior database.

## Analysis surfaces

- `messages`, `session_messages`, `session_overview`, and `message_stats` support conversation and session analysis across harnesses.
- `claude_tools`, `codex_tools`, and `tool_summary` support tool-call analysis.
- `interactions`, `repo_activity`, `project_activity`, and time views support activity trends; preserve their per-source measurement units. `interactions.timestamp` is UTC and `local_timestamp` drives calendar views in DuckDB's system timezone.
- `codex_token_counts` stores Codex token snapshots.
- `usage_with_cost` calculates Claude API-equivalent cost once per assistant turn; `codex_usage_with_cost` applies verified OpenAI Standard API rates and long-context rules to Codex token snapshots.
- `provider_usage_with_cost` normalizes Claude and Codex tokens, cost components, no-cache baselines, and cache savings. Aggregate with `provider_cost_summary` or `cache_efficiency_summary`.
- `conversation_search` and `search` cover user text, assistant text, and optional reasoning traces.

Unknown models have `pricing_status = 'unknown_model'` and `cost_usd = NULL`; never substitute a guessed rate. `model_pricing` and `codex_model_pricing` are user-editable and built-in defaults are only inserted when missing. Cross-provider dollar values are API-equivalent workload estimates, not subscription invoices or observed purchased-credit spend.

## Data boundaries

The database contains sensitive local material: prompts, assistant text, reasoning traces, developer instructions, tool arguments, paths, and PR metadata. Keep the database and backups private and avoid returning raw conversation content unless the user asks for it.

The `agent_*` tables from `references/canonical-agent-schema.duckdb.sql` are an empty reference schema. Current loaders populate the harness-specific tables and views, not the canonical tables.

## Verification

```bash
uv run skills/analyze-usage/tests/test_analyze_usage.py
```

The regression suite covers bootstrap, legacy migration, sparse and incremental Claude/Codex ingestion, deletion and same-second change detection, atomic failure handling, quoted paths and search, turn-level provider costs, long-context pricing, cache savings, editable pricing, repository provenance, and local calendar views.
