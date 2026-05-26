import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SELF, env, fetchMock } from "cloudflare:test";
import { Webhook } from "standardwebhooks";

const SIGNING_KEY = env.ANTHROPIC_WEBHOOK_SIGNING_KEY;
const POLL_URL = new URL("/v1/environments/env_test/work/poll", env.ANTHROPIC_API_BASE);

function signPayload(payload: string): Record<string, string> {
  const wh = new Webhook(SIGNING_KEY);
  const msgId = `msg_${crypto.randomUUID()}`;
  const timestamp = new Date();
  const signature = wh.sign(msgId, timestamp, payload);
  return {
    "webhook-id": msgId,
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": signature,
    "content-type": "application/json",
  };
}

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  // The webhook handler's ctx.waitUntil runs runSession which calls /work/poll.
  // Intercept with a 204 (no work) so the heartbeat exits cleanly.
  fetchMock
    .get(env.ANTHROPIC_API_BASE)
    .intercept({ path: POLL_URL.pathname, method: "POST" })
    .reply(204, "")
    .persist();
});

afterEach(() => {
  fetchMock.deactivate();
});

// Anthropic's Standard Webhooks envelope, decoded from the live API during
// the L4 deploy:
//   { type: "event", id, created_at, data: { type, id, organization_id, workspace_id } }
function envelope(opts: { sessionType: string; sessionId?: string }): string {
  return JSON.stringify({
    type: "event",
    id: `whevt_${crypto.randomUUID()}`,
    created_at: new Date().toISOString(),
    data: {
      type: opts.sessionType,
      id: opts.sessionId ?? "sesn_test",
      organization_id: "org_test",
      workspace_id: "wrkspc_test",
    },
  });
}

describe("POST /webhooks", () => {
  it("accepts a valid session.status_run_started envelope", async () => {
    const payload = envelope({ sessionType: "session.status_run_started", sessionId: "sesn_abc" });
    const res = await SELF.fetch("https://worker.test/webhooks", {
      method: "POST",
      headers: signPayload(payload),
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "accepted", session_id: "sesn_abc" });
  });

  it("rejects a tampered signature with 401", async () => {
    const payload = envelope({ sessionType: "session.status_run_started", sessionId: "sesn_abc" });
    const headers = signPayload(payload);
    headers["webhook-signature"] = `${headers["webhook-signature"]!.slice(0, -4)}AAAA`;
    const res = await SELF.fetch("https://worker.test/webhooks", {
      method: "POST",
      headers,
      body: payload,
    });
    expect(res.status).toBe(401);
  });

  it("returns ignored for non-run-started session events", async () => {
    const payload = envelope({ sessionType: "session.status_idled" });
    const res = await SELF.fetch("https://worker.test/webhooks", {
      method: "POST",
      headers: signPayload(payload),
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ignored", type: "session.status_idled" });
  });

  it("rejects unsigned requests with 401", async () => {
    const payload = envelope({ sessionType: "session.status_run_started", sessionId: "sesn_abc" });
    const res = await SELF.fetch("https://worker.test/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    expect(res.status).toBe(401);
  });
});

describe("other routes", () => {
  it("GET /healthz returns ok", async () => {
    const res = await SELF.fetch("https://worker.test/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("unknown routes return 404", async () => {
    const res = await SELF.fetch("https://worker.test/no-such-route");
    expect(res.status).toBe(404);
  });
});
