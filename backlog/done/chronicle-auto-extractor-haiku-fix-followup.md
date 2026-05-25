---
topic: chronicle-quality
priority: 2
arc: memory-loop-quality
dependencies:
  chronicle-auto-extractor-haiku-diagnosis-plan: "needs the CHRONICLE_DEBUG instrumentation in place to interpret real-session logs"
---

# Chronicle auto-extractor — Haiku fix (post-diagnosis)

## Problem Statement

Phase 1 of the diagnosis plan landed `CHRONICLE_DEBUG=1` instrumentation across `extract.ts` and `extract-lib.ts:callHaiku` (commit b83fc3f). The fix that's needed depends on which of the four hypotheses real SessionEnd logs surface:

- **H1** — `ANTHROPIC_API_KEY` absent from the hook env
- **H2** — model name `claude-3-5-haiku-20241022` retired or wrong
- **H3** — JSON parse fails on Haiku's response
- **H4** — `transcript_path` resolves wrong / `extractSessionContext` returns empty ctx

This task: run the instrumented code through real sessions, identify the cause, ship the matching fix, confirm via `extract-bench.ts`.

## Phases

### Phase 1: Capture

Run several real SessionEnd invocations with `CHRONICLE_DEBUG=1` enabled. Easiest: temporarily set the env var in the SessionEnd hook (`~/.claude/hooks/session-end.sh`), let it ride for a few sessions, then read the captured stderr. If Claude Code's hook output isn't persisted by default, wrap the call:

```bash
CHRONICLE_DEBUG=1 ~/.claude/skills/chronicle/scripts/extract.ts \
  2>>~/.claude/chronicle/debug.log
```

**Acceptance:**
- [ ] At least 3 real SessionEnd runs produce `[chronicle:debug]` lines in a readable log
- [ ] Output lets you name the winning hypothesis with confidence (one of H1–H4)

### Phase 2: Fix per winning hypothesis

| Hypothesis | Likely fix |
|---|---|
| H1 | Add an `env` block in the SessionEnd hook config (or source `~/.claude/.env` from the wrapper). Verify `extract.ts` sees the key. |
| H2 | Bump `HAIKU_MODEL` in `extract-lib.ts` to the current Haiku ID. Cross-check `https://docs.claude.com/en/docs/about-claude/models`. |
| H3 | Widen the fence-strip in `callHaiku`, or wrap with a tolerant parser. Add a regression test against a captured bad-response fixture. |
| H4 | Reconcile the hook's `transcript_path` field name with `extractSessionContext` expectations. |

If the winning cause is *not* one of the four, document the surprise and treat this task as the spec-correction itself.

**Acceptance:**
- [ ] Fix lands as a single PR with a one-line explanation of which hypothesis was true
- [ ] `CHRONICLE_DEBUG=1` re-run on a real session shows the success path (Haiku response logged, JSON parse succeeds)

### Phase 3: Confirm via bench

```bash
bun ~/.claude/skills/chronicle/scripts/extract-bench.ts
```

**Acceptance:**
- [ ] `narrative` bucket count > 0 after at least 5 real SessionEnd runs post-fix
- [ ] `extract-bench-baseline.json` updated to reflect the new ratio
- [ ] Debug logging either removed or left in place (the instrumentation is cheap and silent without the flag — keep it unless there's a reason)

## Out of scope

- Sonnet tier with substantiveness threshold (original plan's Phase 2; open as a new task only if Phase 3 still shows a low narrative ratio).
- Backfill of historical fallback-only blocks.

## References

- `backlog/done/chronicle-auto-extractor-haiku-diagnosis-plan.md` — parent task
- Commit b83fc3f — instrumentation
- `skills/chronicle/scripts/extract-lib.ts:callHaiku` — silent-failure site
- `skills/chronicle/scripts/extract-bench.ts` — measurement instrument

---
- 2026-05-25T16:45:11Z advanced to=doing claimer=fairchild@blue branch=c-c-backlog-worker-v2
- 2026-05-25T16:48:46Z progress | Diagnosis surfaced H2 not H1: model claude-3-5-haiku-20241022 hit EOL 2026-02-19 → 404. Bumped to claude-haiku-4-5-20251001 (commit b5dc864), verified end-to-end produces non-fallback narrative summary. Phase 3 bench confirmation deferred to chronicle-extract-bench-narrative-confirm-followup (needs ≥5 organic SessionEnd runs).
- 2026-05-25T16:49:13Z advanced to=done | PR=https://github.com/fairchild/dotclaude/pull/180
