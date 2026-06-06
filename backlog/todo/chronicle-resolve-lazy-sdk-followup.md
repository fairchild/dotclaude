---
topic: chronicle-quality
arc: memory-loop-quality
priority: 4
timeout: 14d
---

# Chronicle resolve-lib: lazy-import the Anthropic SDK

## Problem

`skills/chronicle/scripts/resolve-lib.ts` imports `@anthropic-ai/sdk` at module top level (line 6). The SDK only matters for semantic resolution — the LLM-assisted matching of a free-text pending item against accomplished work. The manual exact-text path, `resolve.ts "<exact pending text>"`, never touches the model; it's pure string matching against `~/.claude/chronicle/resolved.json`.

But because the import is top-level, the whole module fails to load when `node_modules` is absent, so even a text-only resolve throws:

```
error: ENOENT while resolving package '@anthropic-ai/sdk' from '.../resolve-lib.ts'
```

This surfaced during a routine `/chronicle stale` cleanup on a checkout where the chronicle scripts had never had `bun install` run. `catchup.ts` and `stale.ts` work fine without deps — only resolve is gated, and only because of where the import sits.

## Fix

Move the `Anthropic` import behind the code path that actually needs it — a dynamic `await import("@anthropic-ai/sdk")` inside the semantic-resolution function, or a lazily-constructed client. The exact-text resolve and overlay read/write should run with zero external deps, matching the rest of the read-side scripts.

## Acceptance

- [ ] `bun resolve.ts "<exact text>"` resolves an item with `node_modules` absent (no SDK install).
- [ ] Semantic/auto resolution still works when the SDK and `ANTHROPIC_API_KEY` are present.
- [ ] No top-level `@anthropic-ai/sdk` import remains in `resolve-lib.ts`.

## References

- `skills/chronicle/scripts/resolve-lib.ts:6` — the top-level import to defer
- `skills/chronicle/scripts/resolve.ts` — text-only entrypoint that should not need the SDK
