---
priority: 2
arc: memory-loop-quality
---

# Chronicle auto-extractor — Haiku diagnosis

## Problem Statement

Phase 1 of `chronicle-auto-extractor-quality-plan` (PR #168) measured the live block distribution and produced a result that shifts the original plan's framing:

```
fallback   147   81.2%   <- extract-lib.fallbackEntry() output
narrative    0    0.0%
curator     34   18.8%   <- /chronicle curate + chronicle-curator agent
```

`extract-lib.ts` already wires Haiku via `callHaiku()` (claude-3-5-haiku-20241022, 800 max_tokens, JSON-parsing the response). On API failure or missing key, it returns `null` and `extractChronicleBlock` falls through to `fallbackEntry`. The 0% narrative bucket means: either every SessionEnd invocation is hitting that null path, or the JSON parse is failing reliably enough that no block ever lands with the LLM-populated fields.

Until we know which, the original plan's Phase 2 (gate a new LLM tier behind `CHRONICLE_AUTO_EXTRACT_LLM`, upgrade to Sonnet, substantiveness threshold) is solving the wrong problem. If Haiku just isn't running, the cheap fix is fixing what's there.

## Hypotheses (ranked)

1. **`ANTHROPIC_API_KEY` not in SessionEnd hook env.** The hook is invoked by Claude Code itself; environment propagation depends on how the hook is registered. Easy to verify by logging `process.env.ANTHROPIC_API_KEY ? "present" : "absent"` in `extract.ts` for one session.
2. **Model name 4xx.** `claude-3-5-haiku-20241022` may have been retired or renamed. SDK throws → caught silently by the empty `catch` in `callHaiku`. Verify by running `extract-lib` directly on a known transcript with a known-good key.
3. **JSON parse failure.** Haiku occasionally returns code-fenced or partial JSON. `callHaiku` strips ` ```json ` fences but not other formatting variants. Surface by adding the parse error to a debug log.
4. **Transcript path resolution.** `extractSessionContext` reads `transcriptPath`; if the SessionEnd hook passes a stale path, ctx fields stay empty → `isSubstantive` would return false in any future gate, but already today `extractChronicleBlock` would early-return on `messageCount < 2 && filesModified.length === 0`. Easy to verify by logging ctx shape pre-Haiku.

## Key Decisions

| Decision | Direction |
|---|---|
| Don't add a new LLM tier until #1 is known | The benchmark already exists (`extract-bench.ts`); rerun after fix to confirm narrative bucket fills |
| Surface failures rather than swallowing them | Replace the bare `catch {}` in `callHaiku` with at least `console.error(err)` behind a `CHRONICLE_DEBUG=1` flag |
| Diagnosis lives in `extract-lib.ts` + the hook config, not new code | If the fix turns into "add Sonnet path with substantiveness threshold", that's the original plan's Phase 2 — re-open via a new task |

## Implementation

### Phase 1: Instrument

**Files to modify:**
- `skills/chronicle/scripts/extract-lib.ts` — gated debug logging in `callHaiku` (env var detection, model name in use, error type, JSON parse failures)
- `skills/chronicle/scripts/extract.ts` — log ctx shape pre-Haiku under `CHRONICLE_DEBUG=1`

**Acceptance:**
- [ ] One real SessionEnd run with `CHRONICLE_DEBUG=1` produces enough log output to identify which of the 4 hypotheses is the cause
- [ ] No log noise without the flag

### Phase 2: Fix

Depends on which hypothesis wins:
- **(H1) API key missing:** wire it via the hook's environment. Likely a `~/.claude/settings.json` `hooks.SessionEnd[*].env` map, or a `mise` env load in the hook script. Verify by checking that `extract-bench.ts` shows the narrative bucket > 0 after a few real sessions.
- **(H2) Model name dead:** bump to current Haiku model ID. Cross-check against the latest Anthropic model list at decision time.
- **(H3) JSON parse:** widen the strip to handle other formatting variants, or use a tolerant parser. Add a test against a captured bad-response fixture.
- **(H4) Transcript path:** confirm the hook's `transcript_path` JSON field matches `extractSessionContext`'s expectations; fix the field name on whichever side is wrong.

### Phase 3: Confirm

**Acceptance:**
- [ ] `bun extract-bench.ts` shows narrative bucket > 0 after at least 5 real SessionEnd runs
- [ ] `extract-bench-baseline.json` updated to reflect new ratio
- [ ] Debug logging removed or kept gated behind the flag

## Out of scope

- Sonnet tier with substantiveness threshold — that's the original plan's Phase 2. Open as a new task only if Phase 2 above isn't sufficient.
- Backfill — original plan's Phase 4; deferrable indefinitely.

## References

- PR #168 — Phase 1 baseline that surfaced this finding
- `skills/chronicle/scripts/extract-lib.ts:callHaiku` — the silent-failure site
- `skills/chronicle/scripts/extract-bench.ts` — measurement instrument; rerun to confirm fix
- `backlog/done/chronicle-auto-extractor-quality-plan.md` — closed slice that produced this

---
- 2026-05-25T00:21:52Z advanced to=doing claimer=fairchild@blue branch=c-backlog-worker-v1
- 2026-05-25T00:32:43Z progress | Phase 1 instrumentation shipped (commit b83fc3f); Phases 2 (fix) and 3 (confirm) need real SessionEnd output first — followed up by chronicle-auto-extractor-haiku-fix-followup in todo/

---
- 2026-05-25T00:34:15Z advanced to=done | PR=https://github.com/fairchild/dotclaude/pull/177
