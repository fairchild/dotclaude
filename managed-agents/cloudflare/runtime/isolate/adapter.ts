/**
 * Adapter: routes a single tool call into a registered tool handler and
 * shapes the result for the Anthropic Work API.
 *
 * Tool handlers run in the parent Worker context (not inside the isolate)
 * because the isolate is an untrusted JS context - we want bindings (KV,
 * Email, the egress fetch) to stay on the trusted side. The isolate makes
 * tool-call requests to its parent via fetch; the parent dispatches here.
 */
import type { ToolCall, ToolResult } from "../anthropic.ts";
import type { Env } from "../env.d.ts";
import { runEgressFetch } from "../egress/handler.ts";
import { customTools } from "../tools/custom-tools.ts";
import type { ToolContext } from "../tools/tool-registry.ts";

export async function dispatchToolCall(env: Env, call: ToolCall): Promise<ToolResult> {
  const tool = customTools.find((t) => t.name === call.name);
  if (!tool) {
    return {
      tool_call_id: call.id,
      content: `unknown tool: ${call.name}`,
      is_error: true,
    };
  }

  const ctx: ToolContext = {
    env,
    fetch: (req, init) => runEgressFetch(env, req, init),
  };

  try {
    const parsed = tool.schema.parse(call.input);
    const result = await tool.handler(parsed, ctx);
    return { tool_call_id: call.id, content: result };
  } catch (err) {
    return {
      tool_call_id: call.id,
      content: `tool error: ${err instanceof Error ? err.message : String(err)}`,
      is_error: true,
    };
  }
}
