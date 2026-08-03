---
name: analyze-usage
description: Analyze local AI coding-assistant activity across Claude Code, Codex, Cursor, and Pi. Use when the user asks about coding usage, tool or skill statistics, activity patterns, repositories, sessions, token costs, conversation history, or wants to query their AI coding logs. Triggers include "usage", "how much have I used", "most used tools", "skill popularity", "coding stats", "activity patterns", and "session history".
license: Apache-2.0
---

# AI Coding Usage

Use `scripts/analyze-usage` to load local Claude Code, Codex, Cursor, and Pi logs into DuckDB, then answer usage questions with explicit scope and freshness. Treat the database as an activity ledger—not a productivity score or authoritative provider bill.

## Required workflow

1. Run `scripts/analyze-usage update` before current-state analysis. Stop if it fails; updates are atomic, so a failure leaves the prior database intact.
2. Run `scripts/analyze-usage --schema` when constructing unfamiliar queries.
3. Choose a metric whose unit matches the question. Read `references/analysis-guide.md` for query patterns and interpretation boundaries.
4. Report the database refresh time, time window, included harnesses, and any unknown-priced models with the result.
5. For shareable or repeatable reporting, use `report` with explicit UTC boundaries. Verify `pricingCoverage`, reconcile the provider/model totals, and keep the generated aggregate JSON private unless the user chooses a publication surface.

Do not compare raw `interactions` counts across harnesses as if they were equivalent: Claude Code, Codex, and Pi rows are tool calls, while Cursor rows are prompts. Use messages, sessions, active days, or per-source trends for cross-harness comparisons.

## Commands

```bash
scripts/analyze-usage update
scripts/analyze-usage --schema
scripts/analyze-usage query "SELECT * FROM tool_summary"
scripts/analyze-usage report --from 2026-06-13T17:00:00Z --to 2026-07-12T17:00:00Z --output report.json
scripts/analyze-usage search "memory"
scripts/analyze-usage search "don't panic" --fts
scripts/analyze-usage shell
scripts/analyze-usage reload
```

`update` detects changed and deleted files with nanosecond mtime plus file size, then publishes the new database atomically. `reload` rebuilds atomically and keeps a timestamped backup of the prior database.

`report` emits the versioned `analyze-usage-report/v1` aggregate contract. Its default window is the full observed archive; `--from` is inclusive and `--to` is exclusive. The report includes overall and per-harness archive coverage beside report-window activity, provider/model/repository token and cost ledgers, cache effects, and priced/unpriced coverage. Cursor activity is present even when the focus window is empty and even though its source does not expose token accounting. Report output excludes prompts, responses, reasoning, tool arguments, paths, and session identifiers.

## Analysis surfaces

- `messages`, `session_messages`, `session_overview`, and `message_stats` support conversation and session analysis across harnesses.
- `claude_tools`, `codex_tools`, `pi_tools`, and `tool_summary` support tool-call analysis.
- `interactions`, `repo_activity`, `project_activity`, and time views support activity trends; preserve their per-source measurement units. `interactions.timestamp` is UTC and `local_timestamp` drives calendar views in DuckDB's system timezone.
- `codex_token_counts` stores Codex token snapshots; `pi_usage` stores Pi per-message tokens with harness-recorded dollars.
- `usage_with_cost` calculates Claude API-equivalent cost once per assistant turn; `codex_usage_with_cost` applies verified OpenAI Standard API rates and long-context rules to Codex token snapshots; `pi_usage_with_cost` exposes Pi's harness-recorded dollars (`pricing_status = 'native'`, not an estimate).
- `provider_usage_with_cost` normalizes Claude, Codex, and Pi tokens and cost components (plus Claude/Codex no-cache baselines and cache savings; Pi has no local rates, so its baseline columns are NULL). Aggregate with `provider_cost_summary` or `cache_efficiency_summary`.
- `conversation_search` and `search` cover user text, assistant text, and optional reasoning traces.

Unknown models have `pricing_status = 'unknown_model'` and `cost_usd = NULL`; never substitute a guessed rate. `model_pricing` and `codex_model_pricing` are user-editable and built-in defaults are only inserted when missing. Claude/Codex dollar values are API-equivalent workload estimates and Pi dollar values are harness-recorded, but none are subscription invoices or observed purchased-credit spend.

## Data boundaries

The database contains sensitive local material: prompts, assistant text, reasoning traces, developer instructions, tool arguments, paths, and PR metadata. Keep the database and backups private and avoid returning raw conversation content unless the user asks for it.

The `agent_*` tables from `references/canonical-agent-schema.duckdb.sql` are an empty reference schema. Current loaders populate the harness-specific tables and views, not the canonical tables.

## Verification

```bash
uv run skills/analyze-usage/tests/test_analyze_usage.py
```

The regression suite covers bootstrap, legacy migration, sparse and incremental Claude/Codex ingestion, real Cursor SQLite ingestion, deletion and same-second change detection, atomic failure handling, quoted paths and search, turn-level provider costs, long-context pricing, cache savings, editable pricing, repository provenance, local calendar views, report-window boundaries, cross-harness reconciliation, deterministic output, and aggregate-only privacy.
