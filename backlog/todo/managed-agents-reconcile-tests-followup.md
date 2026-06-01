---
priority: 5
---

# managed-agents/cloudflare — tests for listEvents reconcile

## Problem Statement

The V1.1 fix that made the agent loop actually work (commit `81a2567`) was the history-reconcile pass — `runIsolate` calls `listEvents` immediately after opening the stream and dispatches any `agent.tool_use` events that already happened before the subscription attached. The existing `agent-loop.test.ts` mocks only the stream and the post endpoint; the listEvents call hits fetchMock's `disableNetConnect()` and throws, which is caught by `try { … } catch { /* warn */ }` in the runner.

Net effect: every existing agent-loop test runs the reconcile in failure mode. The success path — where `listEvents` returns past events and dispatch happens via that path — is untested.

## What needs to happen

Add tests that mock the `GET /v1/sessions/{id}/events?limit=…` endpoint to return historical events. Cover:

1. **Reconcile dispatches a tool_use that's in history but not on the stream** — list returns `[user.message, agent.tool_use]` while the stream is empty; the runner should dispatch the tool_use and post the result. This is the exact scenario the live-API fix addressed.

2. **Reconcile skips tool_use whose result is already in history** — list returns `[agent.tool_use, user.tool_result]`; the runner should not re-execute. The `answered` set should be populated from the result event's `*_tool_use_id`.

3. **Reconcile + live stream don't double-dispatch** — list returns the tool_use and the stream re-emits it; the runner should only post one result.

4. **Reconcile failure doesn't break the runner** — listEvents returns 500; runner logs `reconcile_failed` and continues into the stream loop normally. (This is the current behavior — pin it.)

## Pointers

- `runtime/isolate/runner.ts` — reconcile block at the top of `runIsolate`
- `runtime/anthropic.ts#listEvents` — the API call to mock
- `tests/agent-loop.test.ts` — existing harness to extend
- `tests/anthropic-protocol.test.ts` — pattern for verifying URL + headers if we also want to pin listEvents shape

## Non-goals

- Real-stream integration testing (the mock-based approach is what fits Workers test harness; vitest-pool-workers won't connect to live Anthropic)
- Pagination of listEvents — separate followup if it turns out we need it
