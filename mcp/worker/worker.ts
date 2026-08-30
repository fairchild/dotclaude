/**
 * Hosted binding: the SEP-2640 skills server over Streamable HTTP on a
 * Cloudflare Worker, serving the snapshot that worker/build.ts emitted as
 * static assets.
 *
 * Each POST runs one JSON-RPC message through a fresh SDK server over a
 * one-shot in-process transport — fully stateless, which is all this
 * extension needs: every method is request/response, the server initiates
 * nothing, and a deployed snapshot has no state to share between requests.
 * GET (the server-initiated event stream) is therefore 405.
 */
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createSkillsServer } from "../core/server.ts";
import { SnapshotStore, type StoredSkill } from "../core/store.ts";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

class OneShotTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private resolveResponse!: (message: JSONRPCMessage) => void;
  readonly response: Promise<JSONRPCMessage>;

  constructor() {
    this.response = new Promise((resolve) => (this.resolveResponse = resolve));
  }
  async start(): Promise<void> {}
  async send(message: JSONRPCMessage): Promise<void> {
    this.resolveResponse(message);
  }
  async close(): Promise<void> {
    this.onclose?.();
  }
}

let manifest: { skills: StoredSkill[] } | undefined;

async function loadStore(env: Env): Promise<SnapshotStore> {
  if (!manifest) {
    const response = await env.ASSETS.fetch(new Request("https://assets.local/manifest.json"));
    if (!response.ok) throw new Error(`manifest.json missing from assets (${response.status})`);
    manifest = (await response.json()) as { skills: StoredSkill[] };
  }
  return new SnapshotStore(manifest.skills, async (name, rel) => {
    const path = `/skills/${[name, ...rel.split("/")].map(encodeURIComponent).join("/")}`;
    const asset = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
    return asset.ok ? new Uint8Array(await asset.arrayBuffer()) : null;
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return new Response("dotclaude skills over MCP; POST /mcp", { status: 404 });
    if (request.method !== "POST") {
      return new Response("stateless server: POST a JSON-RPC message", {
        status: 405,
        headers: { Allow: "POST" },
      });
    }

    // JSON-RPC requests to this server are URIs and cursors — tiny. A cap
    // keeps a hostile body from being parsed and reflected at megabyte scale.
    const MAX_BODY_BYTES = 64 * 1024;
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `request body exceeds ${MAX_BODY_BYTES} bytes` } }, 413);
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `request body exceeds ${MAX_BODY_BYTES} bytes` } }, 413);
    }
    let message: JSONRPCMessage;
    try {
      message = JSON.parse(raw) as JSONRPCMessage;
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    }
    if (Array.isArray(message)) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batches not supported" } }, 400);
    }

    const store = await loadStore(env);
    const server = createSkillsServer(store, { name: "dotclaude-skills-hosted" });
    const transport = new OneShotTransport();
    await server.connect(transport);
    try {
      transport.onmessage?.(message);
      if (!("id" in message) || message.id === null || message.id === undefined) {
        return new Response(null, { status: 202 }); // notification: accepted, no reply
      }
      const reply = await Promise.race([
        transport.response,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("handler timeout")), 10_000)),
      ]);
      return json(reply);
    } finally {
      await server.close();
    }
  },
};
