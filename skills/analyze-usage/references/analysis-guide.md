# Analysis guide

The database is useful when the unit behind each number stays visible. Refresh first, query the narrowest table that answers the question, then state the time window and important exclusions.

## Freshness and coverage

```sql
SELECT value AS last_loaded
FROM _metadata WHERE key = 'last_load';

SELECT harness, COUNT(DISTINCT session_id) AS sessions,
       COUNT(*) AS messages, MIN(timestamp) AS first_seen,
       MAX(timestamp) AS last_seen
FROM messages
GROUP BY harness ORDER BY messages DESC;
```

## Activity trends

Use messages or sessions for cross-harness comparisons. The `interactions` view mixes tool calls for Claude Code and Codex with prompts for Cursor, so it is appropriate for per-source trends but not direct volume rankings.

Source timestamps are stored as UTC. `interactions.local_timestamp`, `daily_summary`, `daily_by_source`, `weekly_summary`, `hourly_activity`, `peak_hours`, and `message_stats` use DuckDB's system timezone for calendar grouping.

```sql
SELECT date, harness, SUM(message_count) AS messages
FROM message_stats
WHERE date >= CURRENT_DATE - INTERVAL 28 DAY
GROUP BY date, harness ORDER BY date, harness;

SELECT repo_name, harness, COUNT(DISTINCT session_id) AS sessions,
       COUNT(*) AS messages
FROM messages
WHERE timestamp >= CURRENT_DATE - INTERVAL 28 DAY
GROUP BY repo_name, harness
ORDER BY sessions DESC, messages DESC;
```

Repository names come from known worktree/code layouts or recorded Codex Git origins. Other working directories keep `repo_name = NULL`; use `project_dir` or `project_activity` when investigating non-repository work.

## Tools and skills

```sql
SELECT * FROM tool_summary ORDER BY source, uses DESC;

SELECT regexp_extract(context, '"skill":"([^"]+)"', 1) AS skill,
       COUNT(*) AS uses
FROM claude_tools
WHERE tool_name = 'Skill'
GROUP BY skill ORDER BY uses DESC;
```

Skill invocation extraction is currently Claude Code-specific. Codex and Cursor do not expose an equivalent normalized skill event.

## Sessions and response timing

```sql
SELECT session_id, harness, repo_name, started_at, ended_at,
       message_count, user_messages, assistant_messages, topic
FROM session_messages
ORDER BY started_at DESC LIMIT 25;

SELECT repo_name, COUNT(*) AS turns,
       ROUND(median(duration_ms) / 1000.0, 1) AS median_seconds,
       ROUND(quantile_cont(duration_ms, 0.9) / 1000.0, 1) AS p90_seconds
FROM turn_durations
WHERE timestamp >= CURRENT_DATE - INTERVAL 28 DAY
GROUP BY repo_name ORDER BY turns DESC;
```

`turn_durations` comes from Claude Code system events; it is not a cross-harness latency measure.

## Cost estimates

```sql
SELECT pricing_status, model, COUNT(*) AS assistant_turns,
       ROUND(SUM(cost_usd), 2) AS estimated_cost_usd
FROM usage_with_cost
GROUP BY pricing_status, model
ORDER BY estimated_cost_usd DESC NULLS LAST;

SELECT * FROM cost_summary ORDER BY cost_usd DESC NULLS LAST;
```

These are Claude API-equivalent estimates from recorded token fields. Subscription charges, provider discounts, batch rates, regional pricing, and unrecorded traffic may differ. If any model is unknown-priced, report priced coverage separately rather than presenting the partial sum as a total.

For cross-provider reporting, use the normalized view and keep tokens visible:

```sql
SELECT provider, harness, model, pricing_status,
       SUM(uncached_input_tokens) AS uncached_input_tokens,
       SUM(cached_input_tokens) AS cached_input_tokens,
       SUM(cache_write_tokens) AS cache_write_tokens,
       SUM(output_tokens) AS output_tokens,
       ROUND(SUM(cost_usd), 2) AS api_equivalent_usd
FROM provider_usage_with_cost
WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL 28 DAY
GROUP BY provider, harness, model, pricing_status
ORDER BY api_equivalent_usd DESC NULLS LAST;
```

Codex rows use verified public OpenAI Standard API prices, including known
long-context multipliers. This is not the same as ChatGPT/Codex subscription or
purchased-credit spend. Internal models such as `codex-auto-review` remain
unknown-priced.

## Cache utilization

Compare observed cost with the same recorded input treated as uncached:

```sql
SELECT provider, harness, model,
       ROUND(100.0 * SUM(cached_input_tokens) /
             NULLIF(SUM(uncached_input_tokens + cached_input_tokens + cache_write_tokens), 0), 2)
         AS cache_utilization_pct,
       ROUND(SUM(cost_usd), 2) AS observed_api_equivalent_usd,
       ROUND(SUM(cost_without_cache_usd), 2) AS no_cache_baseline_usd,
       ROUND(SUM(cache_savings_usd), 2) AS estimated_cache_savings_usd
FROM provider_usage_with_cost
WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL 28 DAY
GROUP BY provider, harness, model
ORDER BY estimated_cache_savings_usd DESC NULLS LAST;
```

Claude cache writes can initially cost more than ordinary input; the savings
calculation includes that write premium before crediting later cache reads.

## Conversation search

```bash
scripts/analyze-usage search "deploy" --repo services --since 4w -n 20
scripts/analyze-usage search "memory" --thinking
scripts/analyze-usage search "architecture decision" --all --fts
```

Search can expose sensitive text. Prefer aggregates and short previews unless the user explicitly asks for transcript content.
