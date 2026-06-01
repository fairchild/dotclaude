import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { dispatchToolCall } from "../runtime/isolate/adapter.ts";

beforeEach(async () => {
  for (const ns of [env.EGRESS_POLICIES, env.SECRETS]) {
    const list = await ns.list();
    await Promise.all(list.keys.map((k: { name: string }) => ns.delete(k.name)));
  }
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.deactivate();
});

describe("dispatchToolCall", () => {
  it("dispatches echo and returns the input verbatim", async () => {
    const result = await dispatchToolCall(env, {
      id: "call_1",
      name: "echo",
      input: { message: "hello" },
    });
    expect(result.tool_call_id).toBe("call_1");
    expect(result.is_error).toBeUndefined();
    expect(result.content).toEqual({ message: "hello" });
  });

  it("dispatches http_get through the egress layer", async () => {
    fetchMock
      .get("https://example.test.invalid")
      .intercept({ path: "/ping", method: "GET" })
      .reply(200, "pong", { headers: { "content-type": "text/plain" } });

    const result = await dispatchToolCall(env, {
      id: "call_2",
      name: "http_get",
      input: { url: "https://example.test.invalid/ping" },
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toMatchObject({ status: 200, body: "pong", truncated: false });
  });

  it("returns is_error for unknown tool names", async () => {
    const result = await dispatchToolCall(env, {
      id: "call_3",
      name: "no_such_tool",
      input: {},
    });
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain("unknown tool");
  });

  it("returns is_error when input fails schema validation", async () => {
    const result = await dispatchToolCall(env, {
      id: "call_4",
      name: "echo",
      input: { wrong_field: 42 },
    });
    expect(result.is_error).toBe(true);
  });

  it("returns is_error when a GitHub tool's API call rejects", async () => {
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: "/repos/fairchild/dotclaude/pulls/999", method: "GET" })
      .reply(404, "Not Found");

    const result = await dispatchToolCall(env, {
      id: "call_5",
      name: "pr_diff",
      input: { owner: "fairchild", repo: "dotclaude", pull_number: 999 },
    });
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain("pr_diff failed");
  });
});
