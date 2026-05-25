import { describe, expect, it } from "vitest";

const AGENT_ADDRESS_PATTERN = /^agent-([a-zA-Z0-9_-]+)@/;

describe("agent address parsing", () => {
  it("extracts agent id from agent-<id>@domain", () => {
    expect("agent-pr-review-abc123@example.com".match(AGENT_ADDRESS_PATTERN)?.[1]).toBe(
      "pr-review-abc123",
    );
  });

  it("accepts underscores and hyphens in the id", () => {
    expect("agent-my_agent-v2@example.com".match(AGENT_ADDRESS_PATTERN)?.[1]).toBe("my_agent-v2");
  });

  it("rejects addresses that don't start with agent-", () => {
    expect("postmaster@example.com".match(AGENT_ADDRESS_PATTERN)).toBeNull();
    expect("alice@example.com".match(AGENT_ADDRESS_PATTERN)).toBeNull();
  });

  it("rejects empty agent id", () => {
    expect("agent-@example.com".match(AGENT_ADDRESS_PATTERN)).toBeNull();
  });
});
