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

The HAIKU_MODEL bump (`claude-3-5-haiku-20241022` → `claude-haiku-4-5-20251001`) shipped in the Haiku-fix followup. End-to-end smoke test on a single real transcript produced a non-fallback block, and organic SessionEnd data has now accumulated enough to test the population-level result.

Current evidence from 2026-05-26:

- Full bench: `196` blocks, `159` fallback, `1` narrative, `36` curator, `0` thin-other, 30-day fallback ratio `0.662`.
- Post-bump sample (`timestamp >= 2026-05-25T16:48:10Z`, commit `b5dc864`): `10` blocks, `8` fallback, `1` curator, `1` narrative.

The original wait condition is satisfied, and the narrative bucket is no longer zero. But the expected ratio shift did not happen: most post-fix SessionEnd blocks still fall back to file-list summaries. Updating `extract-bench-baseline.json` now would bless the bad state. This task is now a diagnosis pass: explain why post-fix SessionEnd still falls back most of the time, then either fix the narrow cause or leave a sharper follow-up.

## Phases

### Phase 1: Reproduce the current measurement

```bash
bun ~/.claude/skills/chronicle/scripts/extract-bench.ts
```

**Acceptance:**
- [ ] At least 5 SessionEnd blocks dated after the HAIKU_MODEL bump commit exist in `~/.claude/chronicle/blocks/`.
- [ ] The report still shows `narrative > 0`.
- [ ] The post-bump fallback ratio is calculated and recorded before changing code or baseline.

### Phase 2: Diagnose the fallback path

Inspect at least three post-bump fallback blocks and identify which path caused fallback:

- missing or unavailable `ANTHROPIC_API_KEY` in the hook environment
- non-substantive transcript/action shape that should stay heuristic
- stale or missing transcript path
- Anthropic API error
- JSON parse failure
- hook deployment gap where the updated extractor was not actually running

Use `CHRONICLE_DEBUG=1` on a recent real transcript where possible. If the transcript is not available, record that as evidence rather than guessing.

**Acceptance:**
- [ ] At least three post-bump fallback blocks have a documented cause or best-supported cause.
- [ ] The leading root cause is named with evidence.
- [ ] If the fix is narrow, implement it with a regression test.
- [ ] If the fix is not narrow, create a sharper follow-up task and mark this one done-with-followup.

### Phase 3: Update baseline only after the diagnosis

Only run:

```bash
bun ~/.claude/skills/chronicle/scripts/extract-bench.ts --write-baseline
```

after the diagnosis either improves the fallback ratio or intentionally changes the classifier/measurement design. Inspect the resulting `extract-bench-baseline.json` diff before committing.

**Acceptance:**
- [ ] `extract-bench-baseline.json` is updated only after the ratio shift is explained.
- [ ] Commit message names the actual cause, not just the model bump.

### Out of scope

- Backfilling historical fallback blocks (original parent task's out-of-scope; still out of scope here).
- Removing the `CHRONICLE_DEBUG=1` instrumentation (kept in place — cheap and silent).
- Broad extractor redesign or a Sonnet tier unless Phase 2 proves the current Haiku path is working as designed and still insufficient.

## References

- `backlog/done/chronicle-auto-extractor-haiku-fix-followup.md` — parent (closes alongside this task being authored)
- `skills/chronicle/scripts/extract-bench.ts` — measurement instrument
- `skills/chronicle/scripts/extract-bench-baseline.json` — current baseline (pre-fix)
- Commit b5dc864 — model bump
- 2026-05-26 follow-up read — full bench `fallback 159 / narrative 1 / curator 36`, post-bump sample `8 fallback / 1 curator / 1 narrative`

---
- 2026-05-26T06:40:34Z advanced to=doing claimer=fairchild@Mac branch=codex-chronicle-sessionend-fallback
- 2026-05-26T06:47:06Z progress | Diagnosis: post-bump fallbacks were caused by runtime deployment drift. Three real fallback transcripts (ad712858, aafa68bd, 1a52548d) replayed through the stale installed hook logged ANTHROPIC_API_KEY absent despite available ~/.env/~/.zprofile keys; the same transcripts through the repo hook reached Haiku and classified as curator/narrative. Fast-forwarded ~/.claude runtime to 32e949e and verified installed hook now matches repo hashes and reaches Haiku.
- 2026-05-26T06:47:50Z advanced to=done | PR=https://github.com/fairchild/dotclaude/pull/198
