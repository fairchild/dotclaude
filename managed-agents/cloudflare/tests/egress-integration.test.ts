import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { runEgressFetch } from "../runtime/egress/handler.ts";
import type { EgressPolicy } from "../runtime/egress/types.ts";

const HOST = "httpbin.test.invalid";
const BASE = `https://${HOST}`;

async function setPolicies(policies: EgressPolicy[]): Promise<void> {
  await env.EGRESS_POLICIES.put("policies:index", JSON.stringify(policies.map((p) => p.id)));
  for (const p of policies) {
    await env.EGRESS_POLICIES.put(`policy:${p.id}`, JSON.stringify(p));
  }
}

async function clearKv(): Promise<void> {
  for (const ns of [env.EGRESS_POLICIES, env.SECRETS]) {
    const list = await ns.list();
    await Promise.all(list.keys.map((k: { name: string }) => ns.delete(k.name)));
  }
}

beforeEach(async () => {
  await clearKv();
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.deactivate();
});

describe("runEgressFetch", () => {
  it("injects the configured header when a policy matches", async () => {
    await env.SECRETS.put("HTTPBIN_KEY", "sk_test_abc");
    await setPolicies([{
      id: "httpbin",
      host: HOST,
      action: { type: "inject_header", header: "authorization", value_template: "Bearer ${ref:HTTPBIN_KEY}" },
    }]);

    let observedAuth: string | null = null;
    fetchMock
      .get(BASE)
      .intercept({ path: "/headers", method: "GET" })
      .reply((req: { headers: Headers | Record<string, string> }) => {
        observedAuth = new Headers(req.headers as HeadersInit).get("authorization");
        return { statusCode: 200, data: "ok" };
      });

    const res = await runEgressFetch(env, `${BASE}/headers`);
    expect(res.status).toBe(200);
    expect(observedAuth).toBe("Bearer sk_test_abc");
  });

  it("passes through unmodified when no policy matches", async () => {
    let observedAuth: string | null = null;
    fetchMock
      .get(BASE)
      .intercept({ path: "/anything", method: "GET" })
      .reply((req: { headers: Headers | Record<string, string> }) => {
        observedAuth = new Headers(req.headers as HeadersInit).get("authorization");
        return { statusCode: 200, data: "ok" };
      });

    const res = await runEgressFetch(env, `${BASE}/anything`);
    expect(res.status).toBe(200);
    expect(observedAuth).toBeNull();
  });

  it("fails closed with 502 when a referenced secret is missing", async () => {
    await setPolicies([{
      id: "httpbin",
      host: HOST,
      action: { type: "inject_header", header: "authorization", value_template: "Bearer ${ref:MISSING_KEY}" },
    }]);

    const res = await runEgressFetch(env, `${BASE}/headers`);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("required secret missing");
  });

  it("respects path_prefix when narrowing a policy", async () => {
    await env.SECRETS.put("HTTPBIN_KEY", "sk_test_abc");
    await setPolicies([{
      id: "scoped",
      host: HOST,
      path_prefix: "/api/",
      action: { type: "inject_header", header: "authorization", value_template: "Bearer ${ref:HTTPBIN_KEY}" },
    }]);

    let apiAuth: string | null = null;
    let publicAuth: string | null = null;
    fetchMock
      .get(BASE)
      .intercept({ path: "/api/v1/charges", method: "GET" })
      .reply((req) => {
        apiAuth = new Headers(req.headers as HeadersInit).get("authorization");
        return { statusCode: 200, data: "" };
      });
    fetchMock
      .get(BASE)
      .intercept({ path: "/public", method: "GET" })
      .reply((req) => {
        publicAuth = new Headers(req.headers as HeadersInit).get("authorization");
        return { statusCode: 200, data: "" };
      });

    await runEgressFetch(env, `${BASE}/api/v1/charges`);
    await runEgressFetch(env, `${BASE}/public`);
    expect(apiAuth).toBe("Bearer sk_test_abc");
    expect(publicAuth).toBeNull();
  });
});
