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
| Input | in | _value_ | Uncached input tokens | $5.00/MTok |
| Cache Write | cw | _value_ | Tokens written to cache | $6.25/MTok |
| Cache Read | cr | _value_ | Tokens read from cache | $0.50/MTok |
| Output | out | _value_ | Response tokens | $25.00/MTok |

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
