---
priority: 4
---

# managed-agents/cloudflare — retry tool_result POSTs

## Problem Statement

When the agent loop emits an `agent.custom_tool_use`, our worker dispatches it and POSTs a `user.custom_tool_result` back. If that POST fails (transient 5xx, network blip, rate limit) the runner logs `isolate.tool_dispatch_failed`, the agent never sees a result, and the session hangs until the idle timer or lease expiration kicks it.

The SDK retries up to 3x with `1s, 2s, 3s` backoff and only short-circuits on a permanent `4xx`. Our worker tries once.

## What's there

In `runtime/isolate/runner.ts#runTool`:

```ts
await client.postEvents(sessionId, [result]);
```

One attempt. The wrapping `runIsolate` catches the error and logs it, but doesn't retry.

`runtime/anthropic.ts#postEvents` is the single fetch. Status check is binary `res.ok` → throw on anything else.

## What needs to happen

1. Add a `postEventsWithRetry` (or option flag on `postEvents`) that retries N times with backoff, skipping retry on `4xx` (except 408/409/429 which the SDK keeps retrying — match that).
2. Wire `runTool` to use the retry variant.
3. Log a clear error on final failure so the operator knows the agent was orphaned. Optionally mark the work item with `stop --force` to avoid wasting the lease.

## Acceptance criteria

- A flaky `postEvents` (first attempt 503, second succeeds) eventually delivers the result and the session completes normally
- Permanent 4xx (e.g. malformed body) fails fast without retry
- Tests cover both the success-after-retry and the permanent-failure paths via fetchMock

## Pointers

- `runtime/anthropic.ts#postEvents` — the function to extend or wrap
- `runtime/isolate/runner.ts#runTool` — the caller
- SDK source: `src/lib/tools/SessionToolRunner.ts#sendResult` — reference, including the 4xx-passthrough list
- Constants in SDK: `SEND_RETRIES = 3`

## Non-goals

- General retry policy across all anthropic.ts methods — the protocol methods (poll/ack/heartbeat/stop) already have decent semantics; this is specifically about tool_result delivery where the cost of "lost" is highest
