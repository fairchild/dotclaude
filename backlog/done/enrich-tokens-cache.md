---
status: done
category: plan
pr: 88
branch: token-cache
score: 4
retro_summary: Clean execution — plan was detailed enough to implement in one edit, /reflect caught the jq -s memory concern which became a followup backlog item
completed: 2026-02-08
---

# Enrich .tokens Cache with Model, Cost, Lines Changed

## Problem

Code Cadence reads `~/.claude/session-titles/<project>/<sessionId>.tokens` for cost display, but the file only contains raw token counts from JSONL parsing. Cost is estimated with hardcoded Opus pricing ($15/$75 per M tokens), overstating Sonnet sessions ~5x.

The status line script (`statusline.sh`) already receives authoritative data from Claude Code's stdin JSON — model name, USD cost, lines changed — but doesn't persist it to the `.tokens` cache.

## Consumer

Code Cadence (`~/code/code-cadence`) reads `.tokens` files via `ClaudeDataReader.readTokens()`. It already uses `Codable` with optional fields, so new fields will be ignored by old versions and adopted by new versions without breaking anything.

## What to Change

### `scripts/statusline.sh` (lines 87-94)

Currently writes `.tokens` by calling `get-session-tokens.sh` in the background:

```bash
token_cache=~/.claude/session-titles/$project_name/$session_id.tokens
CACHE_TTL_MINUTES=1

if [[ ! -f "$token_cache" ]] || [[ $(find "$token_cache" -mmin +$CACHE_TTL_MINUTES 2>/dev/null) ]]; then
    mkdir -p ~/.claude/session-titles/$project_name
    ~/.claude/skills/status-line-live/scripts/get-session-tokens.sh "$session_id" > "$token_cache" 2>/dev/null &
fi
```

**Change**: After `get-session-tokens.sh` writes the base token data, merge in the enriched fields from stdin. The simplest approach — pass the extra fields to `get-session-tokens.sh` as arguments, or write them separately and merge with `jq`.

Recommended approach — pass as env vars to the background job:

```bash
if [[ ! -f "$token_cache" ]] || [[ $(find "$token_cache" -mmin +$CACHE_TTL_MINUTES 2>/dev/null) ]]; then
    mkdir -p ~/.claude/session-titles/$project_name
    (
        base=$(~/.claude/skills/status-line-live/scripts/get-session-tokens.sh "$session_id")
        echo "$base" | jq \
            --arg model "$model" \
            --argjson cost "$total_cost" \
            --argjson added "$lines_added" \
            --argjson removed "$lines_removed" \
            '. + {model: $model, cost_usd: $cost, lines_added: $added, lines_removed: $removed}'
    ) > "$token_cache" 2>/dev/null &
fi
```

This keeps `get-session-tokens.sh` unchanged (it still does one thing: parse JSONL for token counts) and the merge happens in the caller.

### No changes to `scripts/get-session-tokens.sh`

Leave it as-is. It does one job well (sum tokens from JSONL). The enrichment is the caller's responsibility since it has the stdin JSON data.

## New `.tokens` Format

```json
{
  "input_tokens": 233,
  "output_tokens": 3905,
  "cache_creation_input_tokens": 1556519,
  "cache_read_input_tokens": 14734741,
  "total_tokens": 4138,
  "total_input": 16291493,
  "model": "Opus 4.6",
  "cost_usd": 13.603,
  "lines_added": 887,
  "lines_removed": 184
}
```

## Variables Already Available in statusline.sh

These are parsed from stdin at lines 74-80 and ready to use:

```bash
model=$(echo "$input" | jq -r '.model.display_name')       # "Opus 4.6"
total_cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')  # 13.603
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')  # 887
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')  # 184
```

No new parsing needed.

## Acceptance Criteria

- [ ] `.tokens` files include `model`, `cost_usd`, `lines_added`, `lines_removed`
- [ ] Old `.tokens` files without new fields continue to work (consumers use optional decoding)
- [ ] Status line continues to render correctly (no regressions)
- [ ] Verify: `cat ~/.claude/session-titles/code-cadence/*.tokens | jq '{model, cost_usd}'` shows values

## Verification

```bash
# After change, start a new Claude Code session, wait for status line render, then:
cat ~/.claude/session-titles/<project>/<sessionId>.tokens | jq .

# Should show model, cost_usd, lines_added, lines_removed alongside existing token fields
```

## References

- `~/.claude/skills/status-line-live/scripts/statusline.sh` — the file to modify (lines 87-94)
- `~/.claude/skills/status-line-live/scripts/get-session-tokens.sh` — no changes needed
- Consumer: `~/code/code-cadence/Cadence/Models/Session.swift` — `TokenStats` struct
- Consumer backlog: `~/code/code-cadence/backlog/session-data-enrichment-plan.md` — Phase 2 reads these fields
