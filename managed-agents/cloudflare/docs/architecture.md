# Architecture

## The protocol

Anthropic's self-hosted environment is a work queue. Agent loops run on Anthropic's infrastructure; tool execution runs on yours. The two halves connect through HTTP endpoints under `/v1/environments/{id}/work/`:

| Endpoint | Direction | Status |
|---|---|---|
| `POST /v1/environments/{id}/work/{id}/stop` | worker → Anthropic | documented |
| `POST /v1/environments/{id}/work/stats` | worker → Anthropic | documented |
| `POST /v1/environments/{id}/work/poll` | worker → Anthropic | inferred from SDK behavior |
| `POST /v1/environments/{id}/work/{id}/keepalive` | worker → Anthropic | inferred |
| `POST /v1/environments/{id}/work/{id}/tool_result` | worker → Anthropic | inferred |
| Per-tool-call delivery (long-poll? SSE?) | Anthropic → worker | not yet pinned down |

The SDK's `EnvironmentWorker.handleItem()` wraps the per-session exchange end-to-end and the public docs don't fully expose its wire shape. V1 of this implementation ships only the verified pieces in working form; the inferred endpoints are sketched out in `runtime/anthropic.ts` as the design intent and will be pinned to the real surface in V1.1.

Inside the worker's hold on a session, Anthropic delivers tool calls one at a time. The worker executes each one and posts the result. When the agent reaches `end_turn` or the work item's lease expires, the session releases.

A session can be triggered into the queue by a webhook subscription (event type `session.status_run_started`) — that's how we know to start polling.

All `/work/*` endpoints authenticate with the **environment key** (Bearer auth), not the org API key. The API key is org-scoped and never touches the worker host.

## How this worker implements it

```
                ┌─────────────────────────────────────────┐
                │ Anthropic                               │
                │ ┌──────────┐  ┌─────────────────────┐   │
                │ │ Agent    │  │ Per-environment     │   │
                │ │ loop     │→ │ work queue          │   │
                │ └──────────┘  └──────────┬──────────┘   │
                └────────┬─────────────────┼──────────────┘
                         │ webhook         │ poll/keepalive/stop
                         │ (session start) │ tool_result
                         ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ Cloudflare Worker  (managed-agents/cloudflare/runtime/)          │
│                                                                  │
│ index.ts            fetch()                email()               │
│                       │                      │                   │
│ webhooks.ts        verify HMAC               │                   │
│                       │                      │                   │
│ heartbeat.ts       claim → keepalive ──┐     │                   │
│                                        ▼     ▼                   │
│ isolate/runner.ts  per-session sandbox   email-handler.ts        │
│                       │                      │                   │
│ isolate/adapter.ts dispatch tool call        ▼                   │
│                       │                  AGENT_INBOX (KV)        │
│ tools/*            run tool handler                              │
│                       │                                          │
│ egress/handler.ts  inject credentials                            │
│                       │                                          │
└───────────────────────┼──────────────────────────────────────────┘
                        ▼
              outbound HTTP to whatever
              the tool needs to reach
```

## File-by-file map

| File | Role |
|---|---|
| [`runtime/index.ts`](../runtime/index.ts) | Worker entry: `fetch` and `email` exports |
| [`runtime/webhooks.ts`](../runtime/webhooks.ts) | Standard Webhooks signature verify; dispatch to `heartbeat.runSession` |
| [`runtime/anthropic.ts`](../runtime/anthropic.ts) | Fetch wrapper over the `/work` endpoints |
| [`runtime/heartbeat.ts`](../runtime/heartbeat.ts) | Per-session claim + keepalive loop |
| [`runtime/isolate/runner.ts`](../runtime/isolate/runner.ts) | Per-session sandbox (V1 stub; Worker Loader TODO) |
| [`runtime/isolate/adapter.ts`](../runtime/isolate/adapter.ts) | Tool call → handler dispatch |
| [`runtime/egress/handler.ts`](../runtime/egress/handler.ts) | Outbound fetch interceptor for credential injection |
| [`runtime/tools/tool-registry.ts`](../runtime/tools/tool-registry.ts) | Tool definition shape |
| [`runtime/tools/custom-tools.ts`](../runtime/tools/custom-tools.ts) | Example tools (echo, http_get) |
| [`runtime/email-handler.ts`](../runtime/email-handler.ts) | Per-agent inbound mail routing |

## V1 vs V1.1

V1 ships the wiring around the loop: webhook receive, signature verify, work-item lifecycle hooks, egress, tool registry (with GitHub tools for the pr-review agent), and email routing. The runner that executes tool calls inside an isolate is a scaffold — it logs and returns. The actual loop body lands in V1.1 once two things are verified against the live API:

1. The HTTP shape for tool-call delivery and result posting (the inferred endpoints above)
2. The Cloudflare Worker Loader binding for per-session isolates

Until then, deploying V1 lets you exercise the surrounding integration (webhook delivery, KV layout, Email Routing wiring, agent registration) without burning real session work — claimed work items get released immediately.

## Tradeoffs in this implementation

- **Webhook-triggered, not always-on.** We rely on the `session.status_run_started` event to start polling. The other supported model is a continuously-polling worker; that's a better fit for high steady-state volume but burns CPU when idle. A webhook-driven Worker is the natural shape for Cloudflare's billing model.
- **Per-session isolate via Worker Loader.** The right primitive for cheap-cold-start, JS-only sandboxes. The microVM (Cloudflare Containers) path covers full-Linux needs and is the alternative — see [`isolate-vs-vm-sandboxes.md`](./isolate-vs-vm-sandboxes.md).
- **Direct API calls, not the SDK.** Anthropic's SDK helpers require `/bin/bash`, `unzip`, `tar`, Node 22+ — none of which exist in a Worker. The `/work` protocol is small enough to wrap directly. Cost: we re-do the work the SDK already does; benefit: the runtime stays Workers-native.
- **Tool handlers run in the parent Worker, not the isolate.** The isolate is the untrusted side; bindings (KV, Email, the egress fetch) stay on the trusted side. The isolate sends tool-call requests out via its own fetch; the parent dispatches them.

## What's not here

- **MicroVM sandbox** (Cloudflare Containers + Dockerfile): see [`isolate-vs-vm-sandboxes.md`](./isolate-vs-vm-sandboxes.md) for when you'd want it. Upstream's `cloudflare/claude-managed-agents` ships both.
- **State persistence between sessions**: R2 snapshots are an upstream feature. V1 sessions are stateless.
- **Dashboard UI**: configure secrets and egress policies via `wrangler` or the Cloudflare dashboard.
- **VPC / Workers Mesh**: not wired in V1. The egress layer extends naturally to private services via VPC bindings.

## References

- [Anthropic docs — self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes)
- [Anthropic docs — Environments Work API](https://platform.claude.com/docs/en/api/beta/environments/work)
- [Cloudflare Worker Loader](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/)
- [Standard Webhooks spec](https://www.standardwebhooks.com/)
