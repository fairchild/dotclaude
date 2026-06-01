# Isolate vs VM sandboxes

Cloudflare exposes two sandbox primitives for running per-session agent code: V8 isolates (via Worker Loader / dynamic workers) and microVMs (via Cloudflare Containers). Both implement the same self-hosted environment protocol; what differs is the runtime guarantee.

V1 of this implementation ships the isolate path only. The microVM path is documented here for the choice it represents.

## Comparison

| | Isolate (Worker Loader) | MicroVM (Cloudflare Containers) |
|---|---|---|
| What the agent gets | A sandboxed JS runtime, a virtual filesystem, and the ability to execute JS the agent writes on the fly | A full Linux container with arbitrary binaries, persistent storage, customizable image |
| Cold start | ~5ms | seconds (image dependent) |
| Concurrency model | Many isolates per Worker invocation | One container per session |
| Cost shape | Pay for CPU time you actually use; idle isolates are nearly free | Pay for the container while it exists, idle or not |
| Right fit | High-volume agents that do mostly inference + light tool calls. JS-native tools. Idle-heavy workloads. | Agents that need to compile code, run arbitrary CLIs, or hold persistent disk state. |
| Wrong fit | Agents that need `gcc`, Python with native deps, `chromium`, anything that wants a real OS | Agents that need to scale to thousands of concurrent sessions cheaply |

The 100,000-users-with-5-agents-each scenario is the canonical isolate fit: 500,000 mostly-idle sessions waiting on the model, where a per-session Linux container costs dominate.

## Why V1 ships isolate only

Three reasons:
1. **Lower deployment requirements** — Worker Loader doesn't require the Workers Containers tier
2. **Cleaner protocol illustration** — the isolate path keeps everything in JS; readers don't have to also reason about a Dockerfile to understand the protocol
3. **Cost shape matches dotclaude usage** — the PR review agent (and other dotclaude agents we'd add) trigger sparsely, run a few tool calls each

The microVM path lands when we hit a workload it actually needs.

## What changes if you add the microVM path

Reference: [upstream `src/microvm/`](https://github.com/cloudflare/claude-managed-agents/tree/main/src/microvm). The pieces you'd add:

- `Dockerfile` at the implementation root, with `ant` CLI (or your runtime) as the entrypoint
- `runtime/microvm/sandbox.ts` to spawn a Container instance per session
- `wrangler.jsonc` container binding alongside the Worker Loader binding
- A dispatch decision in `runtime/heartbeat.ts` that picks isolate vs microVM per session (typically via session metadata or per-agent configuration)

The egress layer, tool registry, and webhook handler don't change — they sit above the sandbox boundary.

## See also

- [`architecture.md`](./architecture.md) — how the isolate runner fits into the overall worker
- [`adding-custom-tools.md`](./adding-custom-tools.md) — tool handlers run in the parent Worker regardless of sandbox choice
