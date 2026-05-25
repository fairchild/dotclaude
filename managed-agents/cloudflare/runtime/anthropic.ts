/**
 * Thin fetch wrapper over Anthropic's Environments Work API. We call this
 * directly rather than going through the SDK helpers because the SDK
 * requires /bin/bash, Node 22+, unzip, and tar - none of which exist in a
 * Worker.
 *
 * Auth: the /work endpoints use the environment key as Bearer auth, NOT the
 * org API key. Setting the API key on the worker host would expose an
 * org-scoped credential to agent tool calls.
 *
 * V1 STATUS: only `stop` is verified against the public docs (the page links
 * `/v1/environments/{id}/work/{id}/stop` and `/v1/environments/{id}/work/stats`
 * explicitly). The other methods below are inferred from how the SDK
 * helpers behave and from the protocol's logical shape; field names and
 * paths need verification against the live beta API before this is anything
 * more than a sketch.
 *
 * Reference:
 *   https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes
 *   https://platform.claude.com/docs/en/api/beta/environments/work
 */
import type { Env } from "./env.d.ts";

export interface WorkItem {
  id: string;
  environment_id: string;
  data: {
    id: string;
    metadata?: Record<string, unknown>;
  };
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

  /** [INFERRED] Claim the next work item from the queue. */
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

  /** [INFERRED] Extend the lease on a claimed work item. */
  async keepalive(workId: string): Promise<void> {
    const res = await fetch(
      this.url(`/v1/environments/${this.env.ANTHROPIC_ENVIRONMENT_ID}/work/${workId}/keepalive`),
      { method: "POST", headers: this.headers() },
    );
    if (!res.ok) throw new ApiError("keepalive", res);
  }

  /** [DOCUMENTED] Release a work item. */
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

  /** [INFERRED] Post a tool call result back to Anthropic. */
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
