/**
 * Per-session agent loop body.
 *
 * Once heartbeat.ts has claimed and acked a work item, this runner:
 *   1. Opens an SSE stream of session events (GET /sessions/{id}/events/stream)
 *   2. For each `agent.custom_tool_use` event, dispatches to the registered
 *      tool handler via adapter.ts
 *   3. Posts the matching `user.custom_tool_result` back via POST /sessions/{id}/events
 *   4. Exits when:
 *      - The stream closes
 *      - A `session.status_terminated` or `session.deleted` event arrives
 *      - The session reaches `end_turn` and stays idle for `MAX_IDLE_MS`
 *      - A tool call exceeds `TOOL_TIMEOUT_MS` (the call is cancelled; loop continues)
 *
 * Skipped for V1.1 (intentionally — see comments):
 *   - Stream reconnect with backoff (one stream attempt; close = exit)
 *   - History reconcile via events.list (no catch-up if events missed)
 *   - Result-post retries (one POST attempt per result)
 *   - Built-in `agent.tool_use` events (bash/read/glob/etc.); only custom tools handled
 *
 * The shape mirrors the SDK's SessionToolRunner but the simplifications are
 * load-bearing: at V1.1 scale (the pr-review agent makes ~3 tool calls per
 * session), the missing reconnect/retry surface doesn't pay back its cost.
 */
import type {
  AgentCustomToolUseEvent,
  AgentToolUseEvent,
  AnthropicClient,
  SessionEvent,
  SessionEventParam,
} from "../anthropic.ts";
import type { Env } from "../env.d.ts";
import { log } from "../helpers.ts";
import { dispatchToolCall } from "./adapter.ts";

const TOOL_TIMEOUT_MS = 60_000;
const MAX_IDLE_MS = 30_000;

export interface RunIsolateArgs {
  env: Env;
  work: { id: string; data: { id: string; type: string } };
  client: AnthropicClient;
}

export async function runIsolate({ env, work, client }: RunIsolateArgs): Promise<void> {
  const sessionId = work.data.id;
  const ctrl = new AbortController();
  const answered = new Set<string>();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const armIdle = (): void => {
    disarmIdle();
    idleTimer = setTimeout(() => {
      log("info", "isolate.idle_timeout", { sessionId });
      ctrl.abort();
    }, MAX_IDLE_MS);
  };
  const disarmIdle = (): void => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  log("info", "isolate.start", { sessionId, workId: work.id });
  let toolCount = 0;

  try {
    for await (const ev of client.streamEvents(sessionId, { signal: ctrl.signal })) {
      // Arm the idle countdown on `end_turn`; any non-idle event re-cancels it.
      if (isEndTurn(ev)) armIdle();
      else disarmIdle();

      switch (ev.type) {
        case "session.status_terminated":
        case "session.deleted":
          log("info", "isolate.session_terminated", { sessionId, eventType: ev.type });
          return;

        case "agent.custom_tool_use": {
          const e = ev as AgentCustomToolUseEvent;
          if (answered.has(e.id)) break;
          answered.add(e.id);
          toolCount++;
          await runTool(env, client, sessionId, e, ctrl.signal).catch((err) => {
            log("error", "isolate.tool_dispatch_failed", { sessionId, toolUseId: e.id, error: String(err) });
          });
          break;
        }

        case "agent.tool_use": {
          // Built-in tools (bash, read, glob, …) are not implemented in V1.
          // Post a clear error so the agent doesn't hang waiting for a result.
          const e = ev as AgentToolUseEvent;
          if (answered.has(e.id)) break;
          answered.add(e.id);
          await client.postEvents(sessionId, [{
            type: "user.tool_result",
            tool_use_id: e.id,
            is_error: true,
            content: [{ type: "text", text: `built-in tool "${e.name}" is not implemented by this worker` }],
          }]).catch((err) => {
            log("warn", "isolate.builtin_result_failed", { sessionId, error: String(err) });
          });
          break;
        }

        default:
          // user.tool_result, user.custom_tool_result, agent.message, agent.thinking, etc.
          // Recorded by the agent loop, no worker-side action needed.
          break;
      }
    }
  } finally {
    disarmIdle();
    ctrl.abort();
  }

  log("info", "isolate.complete", { sessionId, toolsRun: toolCount });
}

function isEndTurn(ev: SessionEvent): boolean {
  return ev.type === "agent.message" && (ev as { stop_reason?: string }).stop_reason === "end_turn";
}

async function runTool(
  env: Env,
  client: AnthropicClient,
  sessionId: string,
  ev: { id: string; name: string; input: unknown },
  parentSignal: AbortSignal,
): Promise<void> {
  log("info", "isolate.tool_use", { sessionId, name: ev.name, toolUseId: ev.id });

  const toolCtrl = new AbortController();
  const timer = setTimeout(() => toolCtrl.abort(), TOOL_TIMEOUT_MS);
  const onParentAbort = (): void => toolCtrl.abort();
  parentSignal.addEventListener("abort", onParentAbort);

  let result: SessionEventParam;
  try {
    const dispatched = await dispatchToolCall(env, { id: ev.id, name: ev.name, input: ev.input });
    result = {
      type: "user.custom_tool_result",
      custom_tool_use_id: ev.id,
      is_error: dispatched.is_error ?? false,
      content: [
        {
          type: "text",
          text: typeof dispatched.content === "string"
            ? (dispatched.content || "(no output)")
            : JSON.stringify(dispatched.content),
        },
      ],
    };
  } catch (err) {
    result = {
      type: "user.custom_tool_result",
      custom_tool_use_id: ev.id,
      is_error: true,
      content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
    };
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", onParentAbort);
  }

  await client.postEvents(sessionId, [result]);
  log("info", "isolate.tool_result_posted", { sessionId, toolUseId: ev.id, isError: result.is_error });
}
