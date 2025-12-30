---
description: Explain the current status line with verbose breakdown and ASCII diagram
---

You are explaining the Claude Code status line to help the user understand session metrics.

## Instructions

1. **Read current token data** by running:
   ```bash
   ~/.claude/scripts/get-session-tokens.sh "$SESSION_ID"
   ```
   (Get SESSION_ID from context or use the most recent session file)

2. **Present a verbose breakdown** of each status line element with current values

3. **Generate a dynamic ASCII diagram** that visualizes the token flow and proportions

4. **Provide a concise session summary** with insights about efficiency

## Output Format

### 1. Current Status Line
Show the compact status line and label each part.

### 2. Verbose Breakdown

For each element, show:
- **Current value**
- **What it means**
- **Why it matters**

Token metrics to explain:
| Metric | Symbol | Current | Description | Price (Opus 4.5) |
|--------|--------|---------|-------------|------------------|
| Input | in | _value_ | Tokens after cache breakpoint (variable suffix) | $5.00/MTok |
| Cache Write | cw | _value_ | Tokens written to cache | $6.25/MTok |
| Cache Read | cr | _value_ | Tokens read from cache | $0.50/MTok |
| Output | out | _value_ | Response tokens | $25.00/MTok |

**Important:** These are **cumulative values** summed across all API calls in the session:
- `cw` ≈ unique input tokens (best approximation for "how much content sent")
- `cr` = same cached content re-read on each turn (grows rapidly, but cheap)
- Formula: `total_billed_input = in + cw + cr`

### 3. ASCII Diagram

Generate a diagram showing token flow. Scale bars proportionally to actual values.
Example structure (adapt values dynamically):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TOKEN FLOW THIS SESSION                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  INPUT TOKENS                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ in (uncached)    [█                                    ]    85   │   │
│  │ cw (cache write) [████████                             ]  260K   │   │
│  │ cr (cache read)  [█████████████████████████████████████]  2.1M   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                    │
│                             ┌──────────────┐                            │
│                             │   CLAUDE     │                            │
│                             │  (context    │                            │
│                             │   window)    │                            │
│                             │    200K      │                            │
│                             └──────────────┘                            │
│                                    ↓                                    │
│  OUTPUT TOKENS                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ out (responses)  [███                                  ]   11K   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  RATIO: [1:202] = 202 input tokens consumed per output token            │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  COST BREAKDOWN                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  in:   85    ×  $5.00/M  =  $0.00                                │   │
│  │  cw:  260K   ×  $6.25/M  =  $1.63                                │   │
│  │  cr:  2.1M   ×  $0.50/M  =  $1.05  ← 90% savings vs uncached     │   │
│  │  out:  11K   × $25.00/M  =  $0.28                                │   │
│  │                            ───────                               │   │
│  │  TOTAL:                    $2.96                                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4. Session Insights

Provide 2-3 bullet points about:
- Cache efficiency (what % of input came from cache)
- Whether the ratio suggests heavy exploration or focused work
- Any recommendations (e.g., "session getting heavy, consider /clear for new topics")

## Key Concepts to Explain

**Status Line vs /context:**
- `/context` shows **current turn snapshot** (what Claude sees NOW): ~116K tokens
- Status line shows **cumulative billing** (summed across ALL turns): millions of tokens
- If you replayed the conversation as 1 API call: input ≈ `/context`, output ≈ status line `out`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  /context (CURRENT TURN)              │  Status Line (CUMULATIVE SESSION)   │
│  What Claude sees RIGHT NOW           │  Billing totals across ALL turns    │
├───────────────────────────────────────┼─────────────────────────────────────┤
│                                       │                                     │
│   ⛁ System prompt      3.1K ─────────┐│                                     │
│   ⛁ System tools      18.5K ─────────┤│   These form the CACHED PREFIX     │
│   ⛁ MCP tools         20.7K ─────────┼──► that gets re-read each turn      │
│   ⛁ Custom agents      1.5K ─────────┤│                                     │
│   ⛁ Memory files       0.9K ─────────┘│   On Turn 1: written to cache (cw)  │
│   ⛁ Messages          25.9K ──────────│── Grows each turn, cached prefix    │
│   ⛶ Free space          84K          │                                     │
│   ⛝ Autocompact buffer  45K          │   On Turn N: read from cache (cr)   │
│   ─────────────────────────          │                                     │
│   TOTAL: ~116K this turn             │                                     │
│                                       │                                     │
├───────────────────────────────────────┼─────────────────────────────────────┤
│                                       │                                     │
│  YOUR LAST MESSAGE ──────────────────►│   in (input_tokens)                 │
│  (tokens after cache breakpoint)      │   Small suffix, not cached          │
│                                       │                                     │
├───────────────────────────────────────┼─────────────────────────────────────┤
│                                       │                                     │
│  CLAUDE'S RESPONSE ──────────────────►│   out (output_tokens)               │
│  (this turn's output)                 │   Cumulative: all responses         │
│                                       │                                     │
└───────────────────────────────────────┴─────────────────────────────────────┘

EXAMPLE: 20-turn session with ~100K stable context

  /context shows:     ~116K tokens (current snapshot)

  Status line shows:  (2K + 120K + 1.9M) : 15K   [1:135]
                       │     │      │       │
                       │     │      │       └─ Total output across 20 turns
                       │     │      │
                       │     │      └─ 100K context × ~19 cache hits = 1.9M
                       │     │         (same tokens re-read each turn)
                       │     │
                       │     └─ ~120K unique input written to cache
                       │        (system + tools + growing messages)
                       │
                       └─ ~2K variable suffix tokens (after breakpoint)

  If replayed as SINGLE API call:
    Input:  ~116K (from /context)
    Output: ~15K  (from status line 'out')
```

**How the numbers grow (turn by turn):**

```
Turn │ /context │  Status Line: (in + cw + cr) : out
─────┼──────────┼─────────────────────────────────────────
  1  │   50K    │  (0 + 50K + 0) : 1K      ← First turn: all cache WRITE
  2  │   55K    │  (0 + 55K + 50K) : 2K    ← Turn 2: previous 50K is cache READ
  3  │   60K    │  (0 + 60K + 105K) : 3K   ← cr accumulates: 50K + 55K
  4  │   65K    │  (0 + 65K + 165K) : 4K   ← cr keeps growing
  ...│   ...    │  ...
 20  │  116K    │  (2K + 120K + 1.9M) : 15K ← cr >> cw (healthy session)
```

**Context Window vs Cache Accumulation:**
- Context window = 200K max per turn (what Claude sees at once)
- Cache read = cumulative across turns (sum of all cache hits)
- These are different! A 2M cache read doesn't mean 2M context.

**Why Cache Reads are Cyan:**
- They're the largest number but cheapest per token (90% discount)
- Highlighting them helps users understand where volume comes from

**The Ratio [1:N]:**
- Shows input efficiency
- Higher = more context per response (heavy sessions)
- Lower = lighter, more output-focused sessions

## Example Session Summary

> **Session Summary:** 25 turns, $2.96 spent, 96% of input from cache.
> This is an efficient exploratory session with moderate context.
> Cache savings: ~$9 vs uncached pricing.

## Tips for Cache-Efficient Coding

**How caching works under the hood:**
- Anthropic stores KV attention states for prompt prefixes
- Cache hits require *exact* prefix match (same tokens, same order)
- Cache write costs 25% more than uncached ($6.25 vs $5.00/MTok)
- Cache read saves 90% ($0.50 vs $5.00/MTok)
- Breakeven: reuse a prefix ~2x to recoup the write premium

**Structure your workflow for cache hits:**
1. **Front-load stable context** — System prompt, tools, CLAUDE.md, and project context stay at the prefix and cache well
2. **Keep variable content at the end** — Your messages and tool results come after the cached prefix
3. **Avoid mid-conversation changes** — Editing system instructions or tools invalidates the cache
4. **Batch related work** — Exploring one area deeply reuses the same context; jumping topics may bust the cache

**Session hygiene:**
- Use `/clear` when switching to unrelated topics (fresh cache is cheaper than stale misses)
- Long sessions accumulate context that re-caches each turn—watch the cw metric
- The 5-10 min TTL means pausing too long can drop your cache

**What NOT to worry about:**
- Reading files is cheap—the content caches on subsequent turns
- Tool definitions cache automatically (they're part of the stable prefix)
- Conversation history caches as it grows—that's why cr >> cw in healthy sessions

**Signs of poor cache efficiency:**
- High `cw` with low `cr` = context keeps changing, nothing reuses
- `in` growing faster than `cr` = prefix instability
- Cost dominated by cache writes = too many short sessions or topic switches
