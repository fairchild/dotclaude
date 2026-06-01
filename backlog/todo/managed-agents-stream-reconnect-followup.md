---
priority: 4
---

# managed-agents/cloudflare — stream reconnect with backoff

## Problem Statement

`runtime/isolate/runner.ts` opens the SSE event stream once. If the connection drops mid-session — Cloudflare edge hiccup, Anthropic-side blip, transient network — the worker exits, the work item's lease eventually times out, and the session goes nowhere. The SDK's `SessionToolRunner.#streamLoop` reconnects with exponential backoff (500ms → 10s cap) and re-reconciles history on each attach.

V1.1 ships without this because at pr-review scale (~3 tool calls per session, ~6-second total), the disconnect window is tiny. The cost will appear in longer-running sessions or against a less-reliable network path.

## What's there

`runtime/isolate/runner.ts` has a single `for await` over `client.streamEvents(...)`. Stream end (clean or error) exits the function. The surrounding `runSession` in `heartbeat.ts` calls `client.stop(work.id)` in its `finally` — which on the API side means the work item ends in `stopped` state and Anthropic's reclaim window can't recover it for another worker.

## What needs to happen

1. Wrap the `for await` in a reconnect loop with exponential backoff (start 500ms, cap 10s, jittered).
2. On reconnect, run the history-reconcile pass again (we already have `listEvents`). The `answered` and `seen` sets dedup against the live stream, so re-dispatch is safe.
3. Bound the reconnect loop by either (a) elapsed time since session start, or (b) total reconnect attempts. Currently V1.1's idle timer (30s after `end_turn`) provides one termination signal; reconnect should respect it.
4. On `4xx` from the stream open, fail fast (no point retrying a fatal permission error). The SDK uses `isFatal4xx` from its backoff utils.

## Acceptance criteria

- Killing the stream mid-session (simulated by an abrupt close in a test fixture) results in a reconnect, a successful reconcile, and the session completing with all tool_results posted
- Total elapsed reconnect time is bounded by the existing `MAX_IDLE_MS` rather than infinite
- 4xx errors on the stream-open call propagate as terminal failures instead of being retried

## Pointers

- `runtime/isolate/runner.ts` — the loop body to wrap
- `runtime/anthropic.ts` — `streamEvents` to call repeatedly
- `~/code/dotclaude/managed-agents/cloudflare/docs/architecture.md` — V1 vs V1.1 framing
- SDK source: `src/lib/tools/SessionToolRunner.ts#streamLoop` — the reference implementation we're modeling

## Non-goals

- Reconnect on the work-item lease (`heartbeat` failure handling lives in `heartbeat.ts`, separate concern)
- Stream resumption via a "last event id" cursor — neither the API nor the SDK uses one
