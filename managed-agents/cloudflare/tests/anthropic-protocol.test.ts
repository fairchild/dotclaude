/**
 * Regression tests for the Anthropic Work API client. Locks in the URL shapes,
 * methods, query params, and headers verified against the live beta API
 * during the L4 deploy. Future changes to anthropic.ts that drift from this
 * shape break the test, not production.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { AnthropicClient } from "../runtime/anthropic.ts";

interface InterceptedRequest {
  url: string;
  method: string;
  authorization: string | null;
  anthropicVersion: string | null;
  anthropicBeta: string | null;
}

function fakeWorkItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sesn_test",
    type: "work",
    environment_id: env.ANTHROPIC_ENVIRONMENT_ID,
    state: "queued",
    data: { type: "session", id: "sesn_test" },
    metadata: {},
    secret: null,
    created_at: "2026-05-31T00:00:00Z",
    acknowledged_at: null,
    started_at: null,
    stop_requested_at: null,
    stopped_at: null,
    latest_heartbeat_at: null,
    ...overrides,
  };
}

let captured: InterceptedRequest | null = null;

function captureFrom(req: { path: string; method: string; headers: Headers | Record<string, string> }): void {
  const h = new Headers(req.headers as HeadersInit);
  captured = {
    url: req.path,
    method: req.method.toUpperCase(),
    authorization: h.get("authorization"),
    anthropicVersion: h.get("anthropic-version"),
    anthropicBeta: h.get("anthropic-beta"),
  };
}

beforeEach(() => {
  captured = null;
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.deactivate();
});

const envBase = (envId: string): string => `/v1/environments/${envId}/work`;

describe("AnthropicClient.pollWork", () => {
  it("issues GET with beta=true and a long reclaim window by default", async () => {
    fetchMock
      .get(env.ANTHROPIC_API_BASE)
      .intercept({ path: (path: string) => path.startsWith(envBase(env.ANTHROPIC_ENVIRONMENT_ID) + "/poll"), method: "GET" })
      .reply((req: { path: string; method: string; headers: Headers | Record<string, string> }) => {
        captureFrom(req);
        return { statusCode: 200, data: JSON.stringify(fakeWorkItem()) };
      });

    const client = new AnthropicClient(env);
    const work = await client.pollWork();

    expect(work?.id).toBe("sesn_test");
    expect(captured?.method).toBe("GET");
    expect(captured?.url).toContain(`${envBase(env.ANTHROPIC_ENVIRONMENT_ID)}/poll`);
    expect(captured?.url).toContain("beta=true");
    expect(captured?.url).toContain("reclaim_older_than_ms=300000");
    expect(captured?.authorization).toBe(`Bearer ${env.ANTHROPIC_ENVIRONMENT_KEY}`);
    expect(captured?.anthropicVersion).toBe("2023-06-01");
    expect(captured?.anthropicBeta).toBe(env.ANTHROPIC_BETA_HEADER);
  });

  it("returns null on 204", async () => {
    fetchMock
      .get(env.ANTHROPIC_API_BASE)
      .intercept({ path: (path: string) => path.startsWith(envBase(env.ANTHROPIC_ENVIRONMENT_ID) + "/poll"), method: "GET" })
      .reply(204, "");

    const client = new AnthropicClient(env);
    expect(await client.pollWork()).toBeNull();
  });

  it("respects block_ms and reclaim_older_than_ms overrides", async () => {
    fetchMock
      .get(env.ANTHROPIC_API_BASE)
      .intercept({ path: (path: string) => path.startsWith(envBase(env.ANTHROPIC_ENVIRONMENT_ID) + "/poll"), method: "GET" })
      .reply((req: { path: string; method: string; headers: Headers | Record<string, string> }) => {
        captureFrom(req);
        return { statusCode: 204, data: "" };
      });

    const client = new AnthropicClient(env);
    await client.pollWork({ blockMs: 500, reclaimOlderThanMs: 60_000 });

    expect(captured?.url).toContain("block_ms=500");
    expect(captured?.url).toContain("reclaim_older_than_ms=60000");
  });
});

describe("AnthropicClient.ack", () => {
  it("issues POST to /work/{id}/ack with beta=true and Bearer auth", async () => {
    fetchMock
      .get(env.ANTHROPIC_API_BASE)
      .intercept({ path: (path: string) => path.startsWith(`${envBase(env.ANTHROPIC_ENVIRONMENT_ID)}/sesn_test/ack`), method: "POST" })
      .reply((req: { path: string; method: string; headers: Headers | Record<string, string> }) => {
        captureFrom(req);
        return { statusCode: 200, data: JSON.stringify(fakeWorkItem({ state: "starting" })) };
      });

    const client = new AnthropicClient(env);
    const result = await client.ack("sesn_test");

    expect(result.state).toBe("starting");
    expect(captured?.method).toBe("POST");
    expect(captured?.url).toContain(`${envBase(env.ANTHROPIC_ENVIRONMENT_ID)}/sesn_test/ack`);
    expect(captured?.url).toContain("beta=true");
    expect(captured?.authorization).toBe(`Bearer ${env.ANTHROPIC_ENVIRONMENT_KEY}`);
  });
});

describe("AnthropicClient.heartbeat", () => {
  it("issues POST to /work/{id}/heartbeat with beta=true", async () => {
    fetchMock
      .get(env.ANTHROPIC_API_BASE)
      .intercept({ path: (path: string) => path.startsWith(`${envBase(env.ANTHROPIC_ENVIRONMENT_ID)}/sesn_test/heartbeat`), method: "POST" })
      .reply((req: { path: string; method: string; headers: Headers | Record<string, string> }) => {
        captureFrom(req);
        return { statusCode: 200, data: "{}" };
      });

    await new AnthropicClient(env).heartbeat("sesn_test");

    expect(captured?.method).toBe("POST");
    expect(captured?.url).toContain(`${envBase(env.ANTHROPIC_ENVIRONMENT_ID)}/sesn_test/heartbeat`);
    expect(captured?.url).toContain("beta=true");
  });

  it("appends desired_ttl_seconds when provided", async () => {
    fetchMock
      .get(env.ANTHROPIC_API_BASE)
      .intercept({ path: (path: string) => path.includes("/heartbeat"), method: "POST" })
      .reply((req: { path: string; method: string; headers: Headers | Record<string, string> }) => {
        captureFrom(req);
        return { statusCode: 200, data: "{}" };
      });

    await new AnthropicClient(env).heartbeat("sesn_test", { desiredTtlSeconds: 30 });

    expect(captured?.url).toContain("desired_ttl_seconds=30");
  });
});

describe("AnthropicClient.stop", () => {
  it("issues POST to /work/{id}/stop with beta=true", async () => {
    fetchMock
      .get(env.ANTHROPIC_API_BASE)
      .intercept({ path: (path: string) => path.startsWith(`${envBase(env.ANTHROPIC_ENVIRONMENT_ID)}/sesn_test/stop`), method: "POST" })
      .reply((req: { path: string; method: string; headers: Headers | Record<string, string> }) => {
        captureFrom(req);
        return { statusCode: 200, data: JSON.stringify(fakeWorkItem({ state: "stopping" })) };
      });

    await new AnthropicClient(env).stop("sesn_test");

    expect(captured?.method).toBe("POST");
    expect(captured?.url).toContain(`${envBase(env.ANTHROPIC_ENVIRONMENT_ID)}/sesn_test/stop`);
    expect(captured?.url).toContain("beta=true");
  });

  it("swallows 409 (already stopped)", async () => {
    fetchMock
      .get(env.ANTHROPIC_API_BASE)
      .intercept({ path: (path: string) => path.includes("/stop"), method: "POST" })
      .reply(409, "Conflict");

    // Should not throw - 409 means already stopped, which is a benign race.
    await expect(new AnthropicClient(env).stop("sesn_test")).resolves.toBeUndefined();
  });

  it("throws on other non-success statuses", async () => {
    fetchMock
      .get(env.ANTHROPIC_API_BASE)
      .intercept({ path: (path: string) => path.includes("/stop"), method: "POST" })
      .reply(500, "Internal Server Error");

    await expect(new AnthropicClient(env).stop("sesn_test")).rejects.toThrow(/stop: 500/);
  });
});
