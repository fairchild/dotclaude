---
topic: chronicle-quality
priority: 3
arc: memory-loop-quality
timeout: 14d
dependencies:
  chronicle-auto-extractor-haiku-fix-followup: "needs the HAIKU_MODEL bump to ride for several real SessionEnd runs before bench numbers are meaningful"
---

# Chronicle extract-bench narrative confirmation

## Problem Statement

The HAIKU_MODEL bump (`claude-3-5-haiku-20241022` → `claude-haiku-4-5-20251001`) shipped in the Haiku-fix followup. End-to-end smoke test on a single real transcript produced a non-fallback block — but `extract-bench.ts` still reports `narrative: 0` because:

1. Only one post-fix block exists; sample is too small.
2. The single sample happened to hit the classifier's `curator` threshold (`accLen >= 5 && challLen >= 1 && stepLen >= 2`), so it landed in the curator bucket rather than narrative. Lighter-weight sessions should produce narrative-class blocks naturally.

This task confirms the fix at population level once organic SessionEnd activity has accumulated.

## Phases

### Phase 1: Wait + count

Let the fix ride for at least 5 real SessionEnd runs in the dotclaude/chengdu worktree (or any worktree where the fix is deployed). No work required during the wait — chronicle blocks accumulate on their own.

After ≥5 post-fix blocks exist (filter by `timestamp >= b5dc864`'s commit time), run:

```bash
bun ~/.claude/skills/chronicle/scripts/extract-bench.ts
```

**Acceptance:**
- [ ] At least 5 SessionEnd blocks dated after the HAIKU_MODEL bump commit exist in `~/.claude/chronicle/blocks/`
- [ ] `narrative` bucket > 0 in the bench report (or, if all post-fix blocks classify as curator-grade, document the surprise and either lower the curator threshold or rename the buckets)

### Phase 2: Update baseline

```bash
bun ~/.claude/skills/chronicle/scripts/extract-bench.ts --write-baseline
```

Inspect the resulting `extract-bench-baseline.json` diff. Expected direction:

- `fallback` ratio drops noticeably (was 0.649 30-day, should fall as new blocks shift the average)
- `narrative` count > 0
- `curator` count grows alongside narrative

Commit the new baseline so future regressions are visible in PR diffs.

**Acceptance:**
- [ ] `extract-bench-baseline.json` updated and committed
- [ ] Commit message names the model bump as the cause of the shift

### Out of scope

- Reclassifying high-density Haiku outputs out of the `curator` bucket (a separate measurement-design task if it surfaces as misleading).
- Backfilling historical fallback blocks (original parent task's out-of-scope; still out of scope here).
- Removing the `CHRONICLE_DEBUG=1` instrumentation (kept in place — cheap and silent).

## References

- `backlog/done/chronicle-auto-extractor-haiku-fix-followup.md` — parent (closes alongside this task being authored)
- `skills/chronicle/scripts/extract-bench.ts` — measurement instrument
- `skills/chronicle/scripts/extract-bench-baseline.json` — current baseline (pre-fix)
- Commit b5dc864 — model bump

---
