# AI coding usage analysis — July 11, 2026

This is an activity analysis of local Claude Code, Codex, and Cursor logs, built with the repaired `analyze-usage` skill. It is useful for seeing where attention goes and how the working style is changing; it is not a productivity score or a provider invoice.

The database was rebuilt from source logs and refreshed through **2026-07-11 10:00 PDT**. The primary comparison window is the preceding 28 days: **2026-06-13 10:00 PDT through 2026-07-11 10:00 PDT**. This exact four-week window was chosen for recent signal and weekday alignment; it is an analytical focus, not the boundary of the retained archive. Claude and Codex message/session counts are comparable enough for directional analysis, while raw `interactions` are not—those rows are tool calls for Claude and Codex but prompts for Cursor.

## Coverage

| Harness | Sessions, 28d | Messages, 28d | Active days, 28d |
|---|---:|---:|---:|
| Claude Code | 167 | 36,336 | 19 |
| Codex | 391 | 29,397 | 27 |
| Cursor | 0 | 0 | 0 |

Cursor's most recent indexed activity is April 12, so it is historical rather than part of the current workflow. The local archive contains 180 Claude sessions and 1,335 Codex sessions overall, but all-time comparison would be misleading because Codex history starts in September 2025 while retained Claude logs begin in April 2026.

The retained message archive spans **August 3, 2025 through July 11, 2026** overall: Cursor begins August 3, Codex September 21, and Claude Code April 11/12. Priceable token history begins September 21 for Codex and April 11/12 for Claude. Older history remains queryable; it is excluded from the headline figures only to keep the report focused on the latest four comparable weeks.

## What changed recently

The center of gravity moved sharply toward Claude in July. June recorded 11,237 Claude messages against 35,435 Codex messages; July to date records **28,097 Claude messages against 7,487 Codex messages**. That is not a claim that one harness replaced the other—the 28-day window still contains 391 Codex sessions versus 167 Claude sessions—but Claude now carries more of the long, message-dense work.

Median session size is similar: 31 messages for Claude and 24 for Codex. The tails differ. Claude's 90th-percentile session has roughly 524 messages, compared with 127 for Codex. My read is that Codex remains the broader, higher-frequency surface while Claude increasingly hosts a smaller number of deep implementation and coordination runs.

## Where the work goes

The repo-level concentration is clear:

| Repository | Harness signal in the last 28 days |
|---|---|
| `workspaces` | 154 Codex sessions / 9,365 messages; 27 Claude sessions / 6,492 messages |
| `trips` | 116 Codex sessions / 6,897 messages; 28 Claude sessions / 5,835 messages |
| `mfwiki` | 19 Codex sessions / 8,935 messages; 32 Claude sessions / 1,255 messages |
| `services` | 51 Codex sessions / 2,104 messages; 7 Claude sessions / 695 messages |
| `dotclaude` | 8 Codex sessions / 111 messages; 3 Claude sessions / 532 messages |

`workspaces`, `trips`, and `mfwiki` dominate both attention and the longest workflows. The repaired attribution now uses known worktree/code layouts or Codex Git origins; arbitrary temporary-directory names are no longer presented as repositories.

## Working style

Shell execution is the dominant operation: 9,516 Claude `Bash` calls and 31,591 Codex `exec_command` calls in 28 days. Claude also logged 2,032 edits, 1,915 reads, 221 agent launches, and 132 inter-agent messages. Codex logged 3,359 patches, 2,938 streamed process interactions, and 502 plan updates. The pattern is execution-heavy but structured—plans, task state, agents, and thread operations sit around a shell-first core.

Steering during active Claude responses is common: 1,524 inputs were queued across 123 sessions. Nearly all were subsequently dequeued or removed, which suggests iterative direction rather than abandoned input. Claude also recorded 263 distinct PR links across 70 sessions, reinforcing how much of the activity is review and publication shaped.

Explicit skill invocations are comparatively sparse. The most used in the 28-day window were `codex-review-loop` (8), then `grill-me`, `backlog`, and `orchestration` (5 each). This only counts Claude's explicit `Skill` tool; prompt-injected or Codex-side skills are not normalized, so it is a lower bound rather than a complete popularity ranking.

## Models, tokens, and cost shape

Claude assistant turns split almost evenly between Opus 4.8 (45.3%) and Fable 5 (44.4%), with Sonnet 5 at 9.6%. After deduplicating copied transcript UUIDs, the API-equivalent estimate for priced Claude turns is **$8,818.49 over 28 days**: roughly $5,327 from Fable 5, $3,263 from Opus 4.8, and $222 from Sonnet 5. Another 121 synthetic turns remain deliberately unpriced.

That figure is a workload-shape estimate, not observed spend. It applies public Claude API token rates to recorded usage fields and does not model subscriptions, negotiated discounts, regional multipliers, long-context tiers, refusal credits, or provider-side adjustments. Fable 5 pricing is $10/$50 per million input/output tokens, with $12.50 cache writes and $1 cache reads; the source is Anthropic's [current pricing documentation](https://platform.claude.com/docs/en/about-claude/pricing).

Codex recorded 30,328 token snapshots in the same window. Applying verified OpenAI API rates to priceable models adds **$2,919.54** of API-equivalent cost. GPT-5.5 accounts for about $2,558 and GPT-5.6 Sol for $360; credit-based `codex-auto-review`, internal models, and missing model identifiers remain unpriced. The combined priceable estimate is therefore **$11,738.03**, not an observed subscription or credit charge.

Cache reuse is the largest cost-shaping factor in the snapshot. **96.82% of priceable Claude input and 95.54% of priceable Codex input was served from cache.** The combined API-equivalent estimate would be about **$77,124.58 without cache pricing**, compared with $11,738.03 under recorded cache semantics: approximately **$65,386.57 of avoided equivalent cost**, or an 84.78% reduction. This is a modeled counterfactual, not a refund or provider invoice; Claude cache-write premiums are included.

## Timing

Claude's median recorded turn duration is 89 seconds; the 90th percentile is 644 seconds. Long turns are normal here, especially in `workspaces`, `mfwiki`, and `dotclaude`, and line up with the deep-session pattern above.

User-role message activity is concentrated late in the local day, with the largest hourly buckets between 9 PM and 1 AM. Treat this as an activity rhythm rather than a sleep/work claim: user-role records include agent-continuation and coordination traffic, not only keyboard-entered prompts.

## Conclusions

1. The workflow is moving from many Codex sessions toward fewer, denser Claude runs while keeping Codex as the broader daily surface.
2. `workspaces`, `trips`, and `mfwiki` are the durable center of the portfolio; optimization or automation there will have disproportionate value.
3. Shell-first execution is paired with meaningful planning and multi-agent structure, rather than being a sequence of isolated commands.
4. Cache reuse is working exceptionally well across both harnesses and is the dominant cost-control mechanism. Model routing remains the next question: Fable and Opus split Claude turns evenly, but Fable accounts for materially more API-equivalent cost.
5. Activity data alone cannot answer whether the work produced better outcomes. The next useful layer is coarse outcome linkage—merged PRs, releases, completed backlog items, and elapsed time to evidence—not more raw event volume.

## Analyzer changes behind this report

The report uses `analyze-usage` 2.0 semantics: atomic reloads and updates, deleted-file handling, nanosecond change detection, sparse-log support, per-session Codex updates, quoted search/path handling, Git-backed repository attribution, local calendar views, one-row-per-turn Claude costs, one-row-per-snapshot Codex costs, current known-model pricing, long-context rates, and explicit unknown pricing. The unified views normalize provider token semantics without double-counting Codex reasoning tokens and expose cache utilization, no-cache baselines, and avoided equivalent cost. The regression suite covers 18 scenarios, including failures observed against the live corpus.
