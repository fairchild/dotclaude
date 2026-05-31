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
}

export class ApiError extends Error {
  constructor(
    public readonly op: string,
    public readonly response: Response,
  ) {
    super(`${op}: ${response.status} ${response.statusText}`);
  }
}
