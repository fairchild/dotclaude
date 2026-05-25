/**
 * Thin fetch wrapper over Anthropic's Environments Work API. We hit this
 * directly rather than going through the SDK helpers because the SDK requires
 * /bin/bash, Node 22+, unzip, tar - none of which exist in a Worker. The
 * protocol itself is small enough to call directly.
 *
 * Reference:
 *   https://platform.claude.com/docs/en/api/beta/environments/work
 *
 * Auth: the /work endpoints use the environment key as Bearer auth, NOT the
 * org API key. Setting the API key on the worker host would expose an
 * org-scoped credential to agent tool calls.
 */
import type { Env } from "./env.d.ts";

export interface WorkItem {
  id: string;
  environment_id: string;
  data: {
    /** Session id this work item belongs to. */
    id: string;
    /** Free-form metadata the session was created with. */
    metadata?: Record<string, unknown>;
  };
  /** Server-side lease expiration. We extend with keepalive. */
  expires_at?: string;
}

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
    return `${this.env.ANTHROPIC_API_BASE}${path}`;
  }

  /**
   * Claim the next work item from the queue. Returns null if the queue is
   * empty within the block window.
   */
  async pollWork(opts: { blockMs?: number } = {}): Promise<WorkItem | null> {
    const body = {
      environment_id: this.env.ANTHROPIC_ENVIRONMENT_ID,
      block_ms: opts.blockMs ?? 500,
    };
    const res = await fetch(this.url(`/v1/environments/${this.env.ANTHROPIC_ENVIRONMENT_ID}/work/poll`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new ApiError("pollWork", res);
    return (await res.json()) as WorkItem;
  }

  /**
   * Extend the lease on a claimed work item. Call on a timer until the work
   * completes or you release it.
   */
  async keepalive(workId: string): Promise<void> {
    const res = await fetch(
      this.url(`/v1/environments/${this.env.ANTHROPIC_ENVIRONMENT_ID}/work/${workId}/keepalive`),
      { method: "POST", headers: this.headers() },
    );
    if (!res.ok) throw new ApiError("keepalive", res);
  }

  /**
   * Release a work item. Pass `force: true` to interrupt in-flight tool calls
   * instead of waiting.
   */
  async stop(workId: string, opts: { force?: boolean } = {}): Promise<void> {
    const res = await fetch(
      this.url(`/v1/environments/${this.env.ANTHROPIC_ENVIRONMENT_ID}/work/${workId}/stop`),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ force: opts.force ?? false }),
      },
    );
    if (!res.ok) throw new ApiError("stop", res);
  }

  /**
   * Post a tool call result back to Anthropic so the agent loop can continue.
   */
  async postToolResult(workId: string, result: ToolResult): Promise<void> {
    const res = await fetch(
      this.url(`/v1/environments/${this.env.ANTHROPIC_ENVIRONMENT_ID}/work/${workId}/tool_result`),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(result),
      },
    );
    if (!res.ok) throw new ApiError("postToolResult", res);
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
