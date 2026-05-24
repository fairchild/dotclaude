---
topic: chronicle-quality
priority: 2
description: Replace chronicle's thin file-list auto-extractor with narrative-quality block generation to unblock recap/catchup/summarize quality.
---

# Chronicle auto-extractor quality

## Problem Statement

Chronicle's SessionEnd hook runs `extract-lib.ts` to auto-generate a block for every session. Current output is a file-list masquerading as a summary:

```
"summary": "Worked on workspaces: modified agent-sessions.ts, route.ts, route.ts and 28 more"
"accomplished": ["Modified agent-sessions.ts, route.ts, ..."]
```

This is the single biggest quality bottleneck for every read command in chronicle. `/chronicle catchup`, `/chronicle recap`, `/chronicle summarize`, and `/chronicle insights` all synthesize from these blocks — and file-list inputs make file-list-adjacent outputs no matter what the downstream prompt does.

The curator agent (`chronicle-curator`, invoked via `/chronicle curate` or `/chronicle wrapup`) produces much richer blocks on demand — populating `goal`, `challenges`, `nextSteps`, and a real narrative `summary`. But curator runs are manual and rare. Most of the ~hundreds of blocks in `~/.claude/chronicle/blocks/` are thin auto-extracted ones.

Fixing the auto-extractor has **compounding leverage**: every downstream read command gets better without any other changes.

## Why this is deferred

Touches code with known dependencies and a live hook:

- `extract-lib.ts` is invoked by a SessionEnd hook in every Claude Code session — latency and failure modes matter
- Existing tests live at `skills/chronicle/tests/` and cover some extraction paths
- Changing block shape risks breaking the dashboard, catchup, consolidate, and other consumers of the existing field set
- LLM-assisted extraction adds per-session API cost that users may or may not want

This is high leverage *and* high risk. Deserves its own PR with focused testing, not a drive-by fix bundled with the recap/wrapup work in fairchild/dotclaude#150.

## Key Decisions

| Decision | Candidate | Rationale |
|---|---|---|
| Extraction strategy | **Hybrid**: cheap heuristic baseline + opt-in LLM enrichment for substantive sessions | Keeps latency and cost low for trivial sessions; only pays the Opus/Sonnet tax when the session is worth it |
| LLM model at SessionEnd | Sonnet (cost-sensitive, auto-runs on every qualifying session) | Matches the cost profile of `summarize.ts` daily path |
| "Substantive session" threshold | `messageCount >= 5 && filesModified.length >= 2` (or similar) | Skips trivial "asked a question, got an answer" sessions |
| Failure fallback | Fall back to existing heuristic extractor | Never block SessionEnd on API failure |
| Block shape | Populate `goal`, `challenges`, `nextSteps` in auto-blocks (already-optional fields) | No breaking change — consumers already handle missing fields |
| Feature flag | `CHRONICLE_AUTO_EXTRACT_LLM=1` env var, default off initially | Opt-in rollout, easy to bisect regressions |
| Backfill | Separate opt-in script, not automatic | Backfilling old blocks is a distinct cost/value decision |

## Architecture

```
Current:
  SessionEnd hook
    → extract.ts
      → extract-lib.extractSessionContext()
        → heuristic summary (file list)
      → writeBlock()

Proposed:
  SessionEnd hook
    → extract.ts
      → extract-lib.extractSessionContext()      # unchanged, always runs
        → heuristic summary (file list)
      → if CHRONICLE_AUTO_EXTRACT_LLM && isSubstantive(ctx):
          → extract-lib.enrichWithLLM(ctx)       # NEW
            → Sonnet call with transcript excerpt
            → populate goal/challenges/nextSteps/summary
            → on error: keep heuristic output
      → writeBlock()
```

## Implementation Phases

### Phase 1: Benchmark + golden set

**Acceptance:**
- [ ] Script that measures "block quality" heuristically (ratio of file-list-shaped summaries vs narrative summaries across all blocks)
- [ ] A small golden set of 10-20 sessions where we know what good extraction *should* look like (use curator-written blocks as ground truth)
- [ ] Baseline metric captured for current heuristic extractor

**Files to create:**
- `skills/chronicle/scripts/extract-bench.ts` — quality measurement + golden-set comparison

### Phase 2: LLM-assisted extraction behind a flag

**Files to modify:**
- `skills/chronicle/scripts/extract-lib.ts` — add `enrichWithLLM(ctx: SessionContext)` function, import Anthropic client (pattern from `summarize.ts`)
- `skills/chronicle/scripts/extract.ts` — gate the enrichment on `CHRONICLE_AUTO_EXTRACT_LLM` env var and `isSubstantive(ctx)` check
- `skills/chronicle/scripts/package.json` — no changes (SDK already a dep)

**Acceptance:**
- [ ] With flag off: behavior identical to today (tests still pass)
- [ ] With flag on + substantive session: block contains narrative `summary`, `goal`, `challenges`, `nextSteps`
- [ ] With flag on + API failure: falls back to heuristic, block still written, no SessionEnd crash
- [ ] With flag on + trivial session: skips LLM call, writes heuristic block
- [ ] Per-session latency with LLM enrichment < 5 seconds on Sonnet

### Phase 3: Tests + enable by default

**Files to modify:**
- `skills/chronicle/tests/` — add tests for `isSubstantive()`, `enrichWithLLM()` fallback behavior, and hybrid dispatch
- `skills/chronicle/SKILL.md` — document the extraction pipeline and the env var
- `skills/chronicle/scripts/install-services.sh` — no changes (hook unchanged)

**Acceptance:**
- [ ] Existing extract tests pass unchanged
- [ ] New tests cover fallback + gating
- [ ] Default flipped to on after a burn-in period (e.g., 1 week of opt-in use on Michael's machine)

### Phase 4 (optional): Backfill

**Files to create:**
- `skills/chronicle/scripts/backfill-enrich.ts` — opt-in script to re-enrich recent thin blocks by re-reading their transcript JSONLs

**Why optional:** historical blocks are mostly only read by recap/insights, and both of those consumers cross-reference with git log + memory anyway. Backfill is nice-to-have, not load-bearing.

## Verification Commands

```bash
# Baseline (Phase 1)
bun ~/.claude/skills/chronicle/scripts/extract-bench.ts

# Hand-run extraction on a known session transcript (Phase 2)
CHRONICLE_AUTO_EXTRACT_LLM=1 bun ~/.claude/skills/chronicle/scripts/extract.ts \
  < /path/to/test-session.json

# Verify recap quality before/after (requires API key)
bun ~/.claude/skills/chronicle/scripts/recap.ts workspaces --days=14 > /tmp/before.md
# ... enable flag, regenerate blocks for workspaces sessions ...
bun ~/.claude/skills/chronicle/scripts/recap.ts workspaces --days=14 > /tmp/after.md
diff /tmp/before.md /tmp/after.md
```

## Rollback Plan

- Feature is gated behind `CHRONICLE_AUTO_EXTRACT_LLM` env var. Flip off to revert to heuristic-only.
- No block schema changes — the new fields (`goal`, `challenges`, `nextSteps`) are already optional per `types.ts`. Rolling back doesn't orphan any data.
- Backfill (Phase 4) is opt-in and reversible (write backfilled blocks to a separate directory first, swap in after review).

## References

- `skills/chronicle/scripts/extract-lib.ts` — current heuristic extractor
- `skills/chronicle/scripts/extract.ts` — SessionEnd hook entry point
- `skills/chronicle/scripts/summarize.ts` — reference pattern for Anthropic client + env loading + model selection
- `skills/chronicle/agents/chronicle-curator.md` — target output quality
- `skills/chronicle/scripts/types.ts` — `ChronicleBlock` shape (goal/challenges/nextSteps already optional)
- `~/.claude/chronicle/blocks/2026-04-07-dotclaude-chronicle-recap-wrapup.json` — a real curator-written block, useful as a quality target for the golden set
- Discussion that identified this as the highest-leverage deferred work: fairchild/dotclaude#150 conversation thread

## Related work (from the same discussion)

This plan came out of a broader conversation about the "is chronicle too bloated?" question. Three sketches were considered:

- **Sketch A** — 4-command restructure (`write`/`show`/`manage`/`ui`). Rejected: high migration cost, breaks muscle memory, risk of middle outcome.
- **Sketch B** — automation-first (Chronicle shrinks to 3-4 on-demand commands; everything else becomes automatic or dashboard-only). Long-term direction, not a concrete project.
- **Sketch C** — deprecation-only Phase 1 (prune retired commands from the Help table). Recommended as the next ergonomic tweak; separate backlog item if pursued.

This plan is **Phase 2 of that conversation** — the concrete engineering change that compounds all three sketches because it improves the underlying data quality everything reads from.

---
- 2026-05-24T06:24:20Z advanced to=doing claimer=conductor:lagos-v2 branch=c-backlog-worker
