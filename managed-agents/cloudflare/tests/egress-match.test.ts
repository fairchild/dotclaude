import { describe, expect, it } from "vitest";
import { matchPolicy } from "../runtime/egress/match.ts";
import type { EgressPolicy } from "../runtime/egress/types.ts";

const stripePolicy: EgressPolicy = {
  id: "stripe",
  host: "api.stripe.com",
  action: { type: "inject_header", header: "authorization", value_template: "Bearer ${ref:stripe}" },
};

const githubPolicy: EgressPolicy = {
  id: "github-issues",
  host: "api.github.com",
  path_prefix: "/repos/",
  action: { type: "inject_header", header: "authorization", value_template: "Bearer ${ref:github}" },
};

describe("matchPolicy", () => {
  it("matches by host", () => {
    const match = matchPolicy(new URL("https://api.stripe.com/v1/charges"), [stripePolicy]);
    expect(match).toBe(stripePolicy);
  });

  it("is case-insensitive on host", () => {
    const match = matchPolicy(new URL("https://API.STRIPE.COM/v1/charges"), [stripePolicy]);
    expect(match).toBe(stripePolicy);
  });

  it("returns null when no host matches", () => {
    const match = matchPolicy(new URL("https://example.com/foo"), [stripePolicy, githubPolicy]);
    expect(match).toBeNull();
  });

  it("respects path_prefix when present", () => {
    const repos = matchPolicy(new URL("https://api.github.com/repos/foo/bar"), [githubPolicy]);
    expect(repos).toBe(githubPolicy);

    const user = matchPolicy(new URL("https://api.github.com/user"), [githubPolicy]);
    expect(user).toBeNull();
  });

  it("returns first match when multiple apply", () => {
    const broad: EgressPolicy = { ...stripePolicy, id: "broad" };
    const narrow: EgressPolicy = { ...stripePolicy, id: "narrow", path_prefix: "/v1/" };
    const match = matchPolicy(new URL("https://api.stripe.com/v1/charges"), [broad, narrow]);
    expect(match?.id).toBe("broad");
  });
});
