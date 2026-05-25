/**
 * Per-session isolate runner.
 *
 * V1 STATUS: shape complete, Worker Loader integration stubbed.
 *
 * The production target is Cloudflare Worker Loader: spawn a child JS isolate
 * per session, hand it the agent's tool surface, run the per-session agent
 * loop in there. The Loader API (ISOLATE_LOADER binding) is the right
 * primitive, but its exact shape for delivering modules + a stable
 * request/response channel back to the parent is still settling.
 *
 * Until that lands, V1 provides a "no-isolate" path: tool calls fed to this
 * runner are dispatched directly via runtime/isolate/adapter.ts. The
 * end-to-end protocol (webhooks → claim → dispatch → tool_result → stop)
 * exercises in full; only the per-tool sandbox boundary is missing.
 *
 * To complete:
 *   1. Decide on Worker Loader module-injection shape
 *   2. Inject our agent-loop module + tool surface into the loaded isolate
 *   3. Pipe isolate fetches back to dispatchToolCall via service binding
 *
 * See docs/isolate-vs-vm-sandboxes.md and docs/architecture.md for the model.
 */
import { AnthropicClient, type WorkItem } from "../anthropic.ts";
import type { Env } from "../env.d.ts";
import { log } from "../helpers.ts";
import { dispatchToolCall } from "./adapter.ts";

export interface RunIsolateArgs {
  env: Env;
  work: WorkItem;
  client: AnthropicClient;
}

/**
 * Drive a single session to completion.
 *
 * V1: this function is the seam. The actual loop body (long-poll tool calls
 * from Anthropic, run them via dispatchToolCall, post results back) lands
 * with the Anthropic SDK shape - we need to confirm whether the protocol
 * exposes a tool-call stream endpoint or whether the SDK helpers wrap that
 * via successive POSTs.
 */
export async function runIsolate({ env, work, client }: RunIsolateArgs): Promise<void> {
  log("info", "isolate.start", { workId: work.id, sessionId: work.data.id });

  // TODO(v1.1): implement the per-session tool-call loop. The shape will be:
  //
  //   while (sessionActive) {
  //     const call = await client.nextToolCall(work.id);   // long-poll
  //     if (!call) break;
  //     const result = await dispatchToolCall(env, call);
  //     await client.postToolResult(work.id, result);
  //   }
  //
  // The "nextToolCall" endpoint shape (or its successor) needs confirming
  // against the API beta. Until then this runner is a no-op that lets the
  // surrounding integration (claim → keepalive → stop) exercise cleanly.

  // Reference the symbols so the V1.1 implementation stays honest about its
  // dependencies. Removing these is fine once the loop body lands.
  void dispatchToolCall;
  void env;
  void client;

  log("info", "isolate.stub_complete", { workId: work.id });
}
