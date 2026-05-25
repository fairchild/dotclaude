import { describe, expect, it } from "vitest";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import worker from "../runtime/index.ts";

interface FakeEmail {
  from: string;
  to: string;
  subject: string;
  bodyBytes: Uint8Array;
  forwardCalls: string[];
}

function fakeMessage(opts: { from: string; to: string; subject: string; body?: string }): {
  message: ForwardableEmailMessage;
  state: FakeEmail;
} {
  const bodyBytes = new TextEncoder().encode(opts.body ?? "");
  const state: FakeEmail = {
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    bodyBytes,
    forwardCalls: [],
  };
  const message = {
    from: opts.from,
    to: opts.to,
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(bodyBytes);
        controller.close();
      },
    }),
    rawSize: bodyBytes.byteLength,
    headers: new Headers({ subject: opts.subject }),
    setReject: () => {},
    forward: async (to: string) => {
      state.forwardCalls.push(to);
    },
    reply: async () => {},
  } as unknown as ForwardableEmailMessage;
  return { message, state };
}

describe("email() handler", () => {
  it("writes agent inbox entry for agent-<id>@<domain>", async () => {
    const { message } = fakeMessage({
      from: "alice@example.com",
      to: "agent-pr-review@example.com",
      subject: "review this PR",
      body: "https://github.com/fairchild/dotclaude/pull/187",
    });
    const ctx = createExecutionContext();
    await worker.email(message, env, ctx);
    await waitOnExecutionContext(ctx);

    const stored = await env.AGENT_INBOX.get("agent:pr-review:last");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.from).toBe("alice@example.com");
    expect(parsed.to).toBe("agent-pr-review@example.com");
    expect(parsed.subject).toBe("review this PR");
    expect(parsed.raw).toContain("github.com/fairchild/dotclaude/pull/187");
    expect(typeof parsed.received_at).toBe("string");
  });

  it("supports underscores and hyphens in agent ids", async () => {
    const { message } = fakeMessage({
      from: "bob@example.com",
      to: "agent-skill_audit-v2@example.com",
      subject: "audit",
    });
    const ctx = createExecutionContext();
    await worker.email(message, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await env.AGENT_INBOX.get("agent:skill_audit-v2:last")).not.toBeNull();
  });

  it("forwards non-agent addresses to postmaster instead of writing KV", async () => {
    const { message, state } = fakeMessage({
      from: "alice@example.com",
      to: "postmaster@example.com",
      subject: "out of office",
    });
    const ctx = createExecutionContext();
    await worker.email(message, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(state.forwardCalls).toEqual(["postmaster@example.com"]);
    // No agent KV key should exist for this delivery.
    const list = await env.AGENT_INBOX.list({ prefix: "agent:" });
    const forwardKey = list.keys.find((k: { name: string }) => k.name === "agent:postmaster:last");
    expect(forwardKey).toBeUndefined();
  });
});
