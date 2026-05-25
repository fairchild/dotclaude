import { describe, expect, it } from "vitest";
import { resolveTemplate } from "../runtime/egress/resolve.ts";
import type { Env } from "../runtime/env.d.ts";

function fakeEnv(secrets: Record<string, string>): Env {
  const get = async (key: string): Promise<string | null> => secrets[key] ?? null;
  return { SECRETS: { get } } as unknown as Env;
}

describe("resolveTemplate", () => {
  it("substitutes a single reference", async () => {
    const env = fakeEnv({ stripe: "sk_test_abc" });
    const out = await resolveTemplate(env, "Bearer ${ref:stripe}");
    expect(out).toBe("Bearer sk_test_abc");
  });

  it("substitutes multiple distinct references", async () => {
    const env = fakeEnv({ a: "alpha", b: "beta" });
    const out = await resolveTemplate(env, "${ref:a}-${ref:b}");
    expect(out).toBe("alpha-beta");
  });

  it("passes through templates with no references", async () => {
    const env = fakeEnv({});
    const out = await resolveTemplate(env, "static value");
    expect(out).toBe("static value");
  });

  it("returns null when any referenced secret is missing", async () => {
    const env = fakeEnv({ a: "alpha" });
    const out = await resolveTemplate(env, "${ref:a}-${ref:missing}");
    expect(out).toBeNull();
  });
});
