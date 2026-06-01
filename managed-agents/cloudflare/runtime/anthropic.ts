/**
 * Thin fetch wrapper over Anthropic's Environments Work API. Verified against
 * the live beta API on 2026-05-30:
 *
 *   GET  /v1/environments/{id}/work/poll?beta=true            long-poll claim
 *   POST /v1/environments/{id}/work/{work_id}/ack?beta=true   acknowledge claim
 *   POST /v1/environments/{id}/work/{work_id}/heartbeat?beta=true  extend lease
 *   POST /v1/environments/{id}/work/{work_id}/stop?beta=true  release
 *   GET  /v1/environments/{id}/work/stats?beta=true           queue metrics
 *
 * All endpoints take the environment key as Bearer auth. The org API key
 * never touches the worker host - that's a separate org-wide credential
 * used only by ops scripts (see scripts/ops.ts).
 *
 * Reference shape (from a real /work/poll response):
 *   { id: "sesn_…", type: "work", environment_id, state: "queued"|…,
 *     data: { type: "session", id }, metadata, secret,
 *     created_at, acknowledged_at, started_at, stop_requested_at,
 *     stopped_at, latest_heartbeat_at }
 *
 * For session-type work items, `id` and `data.id` are both the session id.
 */
import type { Env } from "./env.d.ts";

export type WorkState =
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "stopped";

/**
 * Tool call/result shapes for the V1.1 agent loop body. The actual HTTP
 * surface for delivering tool calls to the worker and posting results back
 * hasn't been pinned down yet (the SDK's EnvironmentWorker wraps it via
 * Messages API + its own dispatch). For now these are kept for the
 * adapter's typing.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  tool_call_id: string;
  content: unknown;
  is_error?: boolean;
}

export interface WorkItem {
  id: string;
  type: "work";
  environment_id: string;
  state: WorkState;
  data: { type: string; id: string };
  metadata: Record<string, unknown>;
  secret: string | null;
  created_at: string;
  acknowledged_at: string | null;
  started_at: string | null;
  stop_requested_at: string | null;
  stopped_at: string | null;
  latest_heartbeat_at: string | null;
}

export class AnthropicClient {
  constructor(private readonly env: Env) {}

  private headers(): HeadersInit {
    return {
      authorization: `Bearer ${this.env.ANTHROPIC_ENVIRONMENT_KEY}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": this.env.ANTHROPIC_BETA_HEADER,
      "content-type": "application/json",
    };
  }

  private url(path: string): string {
    return `${this.env.ANTHROPIC_API_BASE}${path}?beta=true`;
  }

  private get envBase(): string {
    return `/v1/environments/${this.env.ANTHROPIC_ENVIRONMENT_ID}/work`;
  }

  /**
   * Long-poll for the next queued work item. Returns null on 204/empty.
   *
   * The `reclaim_older_than_ms` query param controls when poll reclaims
   * already-acked items whose worker has stopped heartbeating. Default is
   * 5000ms; for a scaffold runner that returns before the first heartbeat
   * fires, the default reclaims items we just acked and the worker chases
   * its own tail. Setting a longer reclaim window (5 minutes here) lets
   * fresh queued items surface above ones that already passed through.
   */
  async pollWork(opts: { blockMs?: number; reclaimOlderThanMs?: number } = {}): Promise<WorkItem | null> {
    const params = new URLSearchParams();
    if (opts.blockMs != null) params.set("block_ms", String(opts.blockMs));
    params.set("reclaim_older_than_ms", String(opts.reclaimOlderThanMs ?? 300_000));
    const res = await fetch(`${this.url(`${this.envBase}/poll`)}&${params.toString()}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new ApiError("pollWork", res);
    return (await res.json()) as WorkItem;
  }

  /** Acknowledge a polled work item - transitions state to "starting". */
  async ack(workId: string): Promise<WorkItem> {
    const res = await fetch(this.url(`${this.envBase}/${workId}/ack`), {
      method: "POST",
      headers: this.headers(),
      body: "{}",
    });
    if (!res.ok) throw new ApiError("ack", res);
    return (await res.json()) as WorkItem;
  }

  /** Extend the lease on a claimed work item. */
  async heartbeat(workId: string, opts: { desiredTtlSeconds?: number } = {}): Promise<void> {
    const qs = opts.desiredTtlSeconds ? `&desired_ttl_seconds=${opts.desiredTtlSeconds}` : "";
    const res = await fetch(this.url(`${this.envBase}/${workId}/heartbeat`) + qs, {
      method: "POST",
      headers: this.headers(),
      body: "{}",
    });
    if (!res.ok) throw new ApiError("heartbeat", res);
  }

  /** Release a work item. */
  async stop(workId: string): Promise<void> {
    const res = await fetch(this.url(`${this.envBase}/${workId}/stop`), {
      method: "POST",
      headers: this.headers(),
      body: "{}",
    });
    if (!res.ok && res.status !== 409) throw new ApiError("stop", res);
  }

  // ===== session events surface =====

  private sessionUrl(sessionId: string, path = ""): string {
    return `${this.env.ANTHROPIC_API_BASE}/v1/sessions/${sessionId}${path}?beta=true`;
  }

  /**
   * Open an SSE stream of session events and yield each parsed event object.
   * Iteration ends when the stream closes (end of session) or the AbortSignal
   * fires. The Anthropic API sends Standard SSE blocks (event:/data:/\n\n);
   * we only need the JSON in the data field — the type lives inside it.
   */
  async *streamEvents(
    sessionId: string,
    opts: { signal?: AbortSignal } = {},
  ): AsyncGenerator<SessionEvent, void, void> {
    const res = await fetch(this.sessionUrl(sessionId, "/events/stream"), {
      method: "GET",
      headers: { ...this.headers(), accept: "text/event-stream" },
      signal: opts.signal,
    });
    if (!res.ok || !res.body) throw new ApiError("streamEvents", res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE events are delimited by a blank line. Pull complete blocks.
        let sep: number;
        while ((sep = findEventBoundary(buf)) >= 0) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep).replace(/^(?:\r?\n){1,2}/, "");
          const event = parseSseBlock(block);
          if (event) yield event;
        }
      }
      // Flush any trailing block at stream end.
      if (buf.trim()) {
        const event = parseSseBlock(buf);
        if (event) yield event;
      }
    } finally {
      try { reader.releaseLock(); } catch { /* reader already released */ }
    }
  }

  /**
   * List past events for a session. Used by the agent loop to reconcile
   * history right after opening the live stream - SSE doesn't replay events
   * that fired before the subscription attached, and the webhook → poll →
   * stream open path always leaves a window where a tool_use can be emitted
   * and missed.
   */
  async listEvents(sessionId: string, opts: { limit?: number } = {}): Promise<SessionEvent[]> {
    const limit = opts.limit ?? 1000;
    const res = await fetch(this.sessionUrl(sessionId, "/events") + `&limit=${limit}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) throw new ApiError("listEvents", res);
    const body = (await res.json()) as { data?: SessionEvent[] };
    return body.data ?? [];
  }

  /** Post one or more events to a session. Used for tool_result, user.message. */
  async postEvents(sessionId: string, events: SessionEventParam[]): Promise<void> {
    const res = await fetch(this.sessionUrl(sessionId, "/events"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ events }),
    });
    if (!res.ok) throw new ApiError("postEvents", res);
  }
}

// ===== session event types =====

/**
 * One session event as the API surfaces it. Discriminated by `type`. We don't
 * enumerate every shape - only the fields the runner reads. Unknown event
 * types pass through and are ignored by the dispatcher.
 */
export type SessionEvent =
  | AgentCustomToolUseEvent
  | AgentToolUseEvent
  | UserCustomToolResultEvent
  | UserToolResultEvent
  | AgentMessageEvent
  | SessionStatusEvent
  | { type: string; id?: string; [key: string]: unknown };

export interface AgentCustomToolUseEvent {
  type: "agent.custom_tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface AgentToolUseEvent {
  type: "agent.tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface UserCustomToolResultEvent {
  type: "user.custom_tool_result";
  id?: string;
  custom_tool_use_id: string;
}

export interface UserToolResultEvent {
  type: "user.tool_result";
  id?: string;
  tool_use_id: string;
}

export interface AgentMessageEvent {
  type: "agent.message";
  id: string;
  stop_reason?: "end_turn" | "tool_use" | "max_tokens" | string;
}

export interface SessionStatusEvent {
  type: "session.status_terminated" | "session.deleted" | "session.status_idled";
  id?: string;
}

/** Params for posting a tool-result event back to a session. */
export type SessionEventParam =
  | { type: "user.custom_tool_result"; custom_tool_use_id: string; is_error?: boolean; content: SessionContent[] }
  | { type: "user.tool_result"; tool_use_id: string; is_error?: boolean; content: SessionContent[] }
  | { type: "user.message"; content: SessionContent[] };

export type SessionContent =
  | { type: "text"; text: string }
  | { type: "image"; source: unknown }
  | { type: "document"; source: unknown };

// ===== SSE helpers (exported for tests) =====

export function findEventBoundary(s: string): number {
  const a = s.indexOf("\n\n");
  const b = s.indexOf("\r\n\r\n");
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

export function parseSseBlock(block: string): SessionEvent | null {
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return null;
  try {
    return JSON.parse(data) as SessionEvent;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly op: string,
    public readonly response: Response,
  ) {
    super(`${op}: ${response.status} ${response.statusText}`);
  }
}
