---
priority: 5
---

# managed-agents/cloudflare — make tool timeout actually fire

## Problem Statement

`runtime/isolate/runner.ts#runTool` constructs an AbortController that fires after `TOOL_TIMEOUT_MS` (60s). It also links the parent abort signal. But the resulting signal is **never passed to the tool handler** — `dispatchToolCall(env, call)` takes only `(env, call)` and the handler receives a `ctx` with `env` and `fetch`, neither of which carries the signal.

Net effect: a tool whose handler blocks (e.g. a `ctx.fetch` to a slow API) runs until its own internal timeout — typically the global `fetch` default, which is much longer than 60s. The parent runner moves on (or doesn't, if the handler is `await`ed) and the lease expires. The timer mostly logs that it fired.

## What needs to happen

Thread the abort signal through to where it can actually cancel work:

1. Extend `ToolContext` in `runtime/tools/tool-registry.ts` to include an optional `signal: AbortSignal`.
2. `ctx.fetch(input, init)` should default to passing `ctx.signal` if init.signal isn't set, so handlers that don't explicitly opt out get cancellation for free.
3. `dispatchToolCall(env, call, opts?)` accepts an optional `signal`; pass through to the `ctx` it builds.
4. `runTool` constructs the timeout AbortController as today, then calls `dispatchToolCall(env, call, { signal: toolCtrl.signal })`.

## Acceptance criteria

- A tool whose handler calls `ctx.fetch` against a slow endpoint is cancelled after `TOOL_TIMEOUT_MS`; the runner posts a tool_result with `is_error: true` and a "timeout" message
- Existing tools that don't pass `init.signal` explicitly still get cancellation propagated
- A test using a deliberately-slow fetchMock reply confirms the timeout fires within ~60s rather than ~30s+ later

## Pointers

- `runtime/tools/tool-registry.ts` — `ToolContext` shape
- `runtime/isolate/adapter.ts` — `dispatchToolCall` and the ctx construction
- `runtime/isolate/runner.ts#runTool` — the timeout AbortController already in place

## Non-goals

- Per-tool timeout overrides (TOOL_TIMEOUT_MS is a single global today; that's fine for V1.x)
- Re-running a timed-out tool (timeouts go straight to `is_error: true` result)
