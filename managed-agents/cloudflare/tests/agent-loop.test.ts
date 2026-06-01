/**
 * V1.1 agent loop tests.
 *
 * - SSE parser helpers (parseSseBlock, findEventBoundary) tested directly.
 * - runIsolate dispatch flow tested by faking the stream + post endpoints
 *   with fetchMock. Bodies are strings (undici MockAgent doesn't pass
 *   ReadableStream through), which means we can't simulate mid-block chunk
 *   splits at the HTTP layer here - the parser is exercised in isolation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import {
  AnthropicClient,
  findEventBoundary,
  parseSseBlock,
} from "../runtime/anthropic.ts";
import { runIsolate } from "../runtime/isolate/runner.ts";

const SESSION_ID = "sesn_loop_test";
const WORK = { id: SESSION_ID, data: { id: SESSION_ID, type: "session" } };

const streamPath = `/v1/sessions/${SESSION_ID}/events/stream`;
const postPath = `/v1/sessions/${SESSION_ID}/events`;

interface PostedEnvelope {
  events: Array<Record<string, unknown>>;
}

let postedBodies: PostedEnvelope[] = [];

function sseBlocks(events: object[]): string {
  return events
    .map((e) => `event: ${(e as { type?: string }).type ?? "message"}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
}

beforeEach(async () => {
  postedBodies = [];
  for (const ns of [env.SECRETS, env.EGRESS_POLICIES]) {
    const list = await ns.list();
    await Promise.all(list.keys.map((k: { name: string }) => ns.delete(k.name)));
  }
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.deactivate();
});

function mockPostEvents(): void {
  fetchMock
    .get(env.ANTHROPIC_API_BASE)
    .intercept({ path: (p: string) => p.startsWith(postPath), method: "POST" })
    .reply((opts: { body?: unknown }) => {
      const body = typeof opts.body === "string" ? opts.body : String(opts.body ?? "");
      try { postedBodies.push(JSON.parse(body) as PostedEnvelope); }
      catch { /* ignore non-JSON */ }
      return { statusCode: 200, data: JSON.stringify({ data: [] }) };
    })
    .persist();
}

function mockStream(events: object[]): void {
  fetchMock
    .get(env.ANTHROPIC_API_BASE)
    .intercept({ path: (p: string) => p.startsWith(streamPath), method: "GET" })
    .reply(200, sseBlocks(events), { headers: { "content-type": "text/event-stream" } });
}

describe("runIsolate — V1.1 agent loop", () => {
  it("dispatches a custom_tool_use event and posts the result", async () => {
    mockStream([
      { type: "agent.custom_tool_use", id: "sevt_call_1", name: "echo", input: { message: "hello" } },
    ]);
    mockPostEvents();

    await runIsolate({ env, work: WORK, client: new AnthropicClient(env) });

    expect(postedBodies.length).toBe(1);
    const ev = postedBodies[0]?.events[0];
    expect(ev?.type).toBe("user.custom_tool_result");
    expect(ev?.custom_tool_use_id).toBe("sevt_call_1");
    expect(ev?.is_error).toBe(false);
    expect(String((ev?.content as Array<{ text: string }>)?.[0]?.text)).toContain("hello");
  });

  it("dispatches multiple tool calls in order", async () => {
    mockStream([
      { type: "agent.custom_tool_use", id: "sevt_1", name: "echo", input: { message: "first" } },
      { type: "agent.custom_tool_use", id: "sevt_2", name: "echo", input: { message: "second" } },
    ]);
    mockPostEvents();

    await runIsolate({ env, work: WORK, client: new AnthropicClient(env) });

    expect(postedBodies.length).toBe(2);
    expect(postedBodies[0]?.events[0]?.custom_tool_use_id).toBe("sevt_1");
    expect(postedBodies[1]?.events[0]?.custom_tool_use_id).toBe("sevt_2");
  });

  it("deduplicates events with the same id", async () => {
    mockStream([
      { type: "agent.custom_tool_use", id: "sevt_dup", name: "echo", input: { message: "once" } },
      { type: "agent.custom_tool_use", id: "sevt_dup", name: "echo", input: { message: "twice" } },
    ]);
    mockPostEvents();

    await runIsolate({ env, work: WORK, client: new AnthropicClient(env) });

    expect(postedBodies.length).toBe(1);
  });

  it("posts is_error for unknown tools", async () => {
    mockStream([
      { type: "agent.custom_tool_use", id: "sevt_unk", name: "no_such_tool", input: {} },
    ]);
    mockPostEvents();

    await runIsolate({ env, work: WORK, client: new AnthropicClient(env) });

    const ev = postedBodies[0]?.events[0];
    expect(ev?.is_error).toBe(true);
    expect(String((ev?.content as Array<{ text: string }>)?.[0]?.text)).toContain("unknown tool");
  });

  it("exits on session.status_terminated and skips later events", async () => {
    mockStream([
      { type: "agent.custom_tool_use", id: "sevt_a", name: "echo", input: { message: "x" } },
      { type: "session.status_terminated", id: "sevt_term" },
      { type: "agent.custom_tool_use", id: "sevt_b", name: "echo", input: { message: "should not run" } },
    ]);
    mockPostEvents();

    await runIsolate({ env, work: WORK, client: new AnthropicClient(env) });

    expect(postedBodies.length).toBe(1);
    expect(postedBodies[0]?.events[0]?.custom_tool_use_id).toBe("sevt_a");
  });

  it("answers a built-in agent.tool_use with a not-implemented error", async () => {
    mockStream([
      { type: "agent.tool_use", id: "sevt_bash", name: "bash", input: { command: "ls" } },
    ]);
    mockPostEvents();

    await runIsolate({ env, work: WORK, client: new AnthropicClient(env) });

    const ev = postedBodies[0]?.events[0];
    expect(ev?.type).toBe("user.tool_result");
    expect(ev?.tool_use_id).toBe("sevt_bash");
    expect(ev?.is_error).toBe(true);
    expect(String((ev?.content as Array<{ text: string }>)?.[0]?.text)).toContain("not implemented");
  });
});

describe("SSE helpers", () => {
  it("findEventBoundary locates \\n\\n", () => {
    expect(findEventBoundary("a\nb\n\nc")).toBe(3);
  });

  it("findEventBoundary locates \\r\\n\\r\\n", () => {
    expect(findEventBoundary("a\r\nb\r\n\r\nc")).toBe(4);
  });

  it("findEventBoundary returns -1 when no boundary", () => {
    expect(findEventBoundary("a\nb\nc")).toBe(-1);
  });

  it("parseSseBlock extracts and JSON-decodes the data line", () => {
    const block = `event: agent.message\ndata: ${JSON.stringify({ type: "agent.message", id: "sevt_x" })}`;
    const parsed = parseSseBlock(block);
    expect(parsed?.type).toBe("agent.message");
    expect(parsed?.id).toBe("sevt_x");
  });

  it("parseSseBlock joins multi-line data fields with newlines", () => {
    const block = `event: msg\ndata: {"text":"line1\\nline2"}`;
    const parsed = parseSseBlock(block);
    expect((parsed as { text?: string })?.text).toBe("line1\nline2");
  });

  it("parseSseBlock returns null for [DONE]", () => {
    expect(parseSseBlock(`data: [DONE]`)).toBeNull();
  });

  it("parseSseBlock returns null for blocks with no data line", () => {
    expect(parseSseBlock(`event: heartbeat`)).toBeNull();
    expect(parseSseBlock(``)).toBeNull();
  });

  it("parseSseBlock returns null for malformed JSON", () => {
    expect(parseSseBlock(`data: not valid json {`)).toBeNull();
  });
});
