/**
 * Per-session isolate runner.
 *
 * V1 STATUS: scaffold only. This function is invoked once per claimed work
 * item; in V1 it returns without executing tool calls. The surrounding flow
 * (webhook → claim → keepalive → stop) exercises end-to-end, but the agent
 * loop body is not implemented.
 *
 * Two things need to settle before the loop can land:
 *
 *   1. The HTTP shape for receiving tool calls from Anthropic and posting
 *      results back. The documented endpoints expose `/work/poll`,
 *      `/work/{id}/keepalive`, `/work/{id}/stop`, and `/work/stats`, but the
 *      per-tool-call exchange happens inside the SDK's EnvironmentWorker and
 *      isn't directly described in the public docs. Reading the SDK source
 *      or running the SDK against the beta API will reveal it.
 *
 *   2. The Cloudflare Worker Loader API for spawning a child JS isolate per
 *      session, including how to inject a fetch override that routes the
 *      isolate's outbound HTTP back through this parent worker's egress
 *      layer. The unsafe binding type "worker_loader" is in wrangler.jsonc
 *      but commented out until the shape is verified.
 *
 * When both land, the loop body looks like:
 *
 *   while (sessionActive) {
 *     const call = await client.nextToolCall(work.id);   // long-poll
 *     if (!call) break;
 *     const result = await dispatchToolCall(env, call);  // adapter.ts
 *     await client.postToolResult(work.id, result);
 *   }
 *
 * See docs/architecture.md for the model and docs/isolate-vs-vm-sandboxes.md
 * for the sandbox choice.
 */
import type { AnthropicClient, WorkItem } from "../anthropic.ts";
import type { Env } from "../env.d.ts";
import { log } from "../helpers.ts";

export interface RunIsolateArgs {
  env: Env;
  work: WorkItem;
  client: AnthropicClient;
}

export async function runIsolate({ work }: RunIsolateArgs): Promise<void> {
  log("info", "isolate.scaffold_invoked", { workId: work.id, sessionId: work.data.id });
  // The agent loop body lands in V1.1. Until then this is a structural no-op.
}
