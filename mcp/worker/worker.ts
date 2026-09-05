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
 *
 * Every request emits one Analytics Engine datapoint (when the METRICS
 * binding is present): method, skill, outcome, client hints, latency, and
 * sizes. Callers who want their traffic labeled set `x-skills-client`;
 * everything else is coarse (user-agent, country) — no raw IPs are stored.
 */
import { JSONRPCMessageSchema, SUPPORTED_PROTOCOL_VERSIONS, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createSkillsServer } from "../core/server.ts";
import { SnapshotStore, type StoredSkill } from "../core/store.ts";
import { parseSkillUri } from "../core/types.ts";
import { serveHttp } from "./http.ts";
import { negotiate } from "./accept.ts";

interface AnalyticsEngineDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  METRICS?: AnalyticsEngineDataset;
  POSTHOG_API_KEY?: string; // PostHog project token (a publishable client key)
  ALLOWED_ORIGINS?: string; // comma-separated exact origins; same-origin is always allowed
  POSTHOG_HOST?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
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

const manifests = new WeakMap<Env["ASSETS"], { skills: StoredSkill[] }>();

async function loadStore(env: Env): Promise<SnapshotStore> {
  let manifest = manifests.get(env.ASSETS);
  if (!manifest) {
    const response = await env.ASSETS.fetch(new Request("https://assets.local/manifest.json"));
    if (!response.ok) throw new Error(`manifest.json missing from assets (${response.status})`);
    manifest = (await response.json()) as { skills: StoredSkill[] };
    manifests.set(env.ASSETS, manifest);
  }
  return new SnapshotStore(manifest.skills, async (name, rel) => {
    const path = `/skills/${[name, ...rel.split("/")].map(encodeURIComponent).join("/")}`;
    const asset = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
    return asset.ok ? new Uint8Array(await asset.arrayBuffer()) : null;
  });
}

/** What one request resolves to, for both the HTTP reply and the datapoint. */
interface Served {
  response: Response;
  method: string; // JSON-RPC method, or http:<verb> / <unparsed> / <batch>
  skill: string;
  outcome: string; // ok | notification | error:<code> | http:<status>
  responseBytes: number;
}

function json(body: unknown, status = 200): { response: Response; bytes: number } {
  const text = JSON.stringify(body);
  return {
    bytes: new TextEncoder().encode(text).byteLength,
    response: new Response(text, { status, headers: { "Content-Type": "application/json" } }),
  };
}

const MAX_BODY_BYTES = 64 * 1024;

async function serve(request: Request, env: Env): Promise<Served> {
  const reject = (status: number, message: string, code = -32600): Served => {
    const { response, bytes } = json({ jsonrpc: "2.0", id: null, error: { code, message } }, status);
    return { response, method: "<rejected>", skill: "", outcome: `http:${status}`, responseBytes: bytes };
  };
  const origin = request.headers.get("Origin");
  const allowed = [new URL(request.url).origin, ...(env.ALLOWED_ORIGINS?.split(",").map(s => s.trim()) ?? [])];
  if (origin !== null && !allowed.includes(origin)) return reject(403, "Origin not allowed");
  const version = request.headers.get("MCP-Protocol-Version");
  if (version !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) return reject(400, "Unsupported protocol version");
  if (request.method !== "POST") {
    return {
      response: new Response("stateless server: POST a JSON-RPC message", {
        status: 405,
        headers: { Allow: "POST" },
      }),
      method: `http:${request.method}`,
      skill: "",
      outcome: "http:405",
      responseBytes: 0,
    };
  }

  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return reject(415, "Use application/json");
  if (!negotiate(request.headers.get("Accept"), [{ contentType: "application/json" }])) return reject(406, "Accept application/json");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) return reject(413, "Request body too large");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          void reader.cancel().catch(() => {});
          return reject(413, "Request body too large");
        }
        chunks.push(value);
      }
    } catch { return reject(400, "Cannot read request body"); }
    finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return reject(400, "Parse error", -32700); }
  const validated = JSONRPCMessageSchema.safeParse(parsed);
  if (!validated.success) return reject(400, "Invalid JSON-RPC message");
  const message = validated.data;

  const method = "method" in message ? String(message.method) : "<response>";
  const uri = (message as { params?: { uri?: unknown } }).params?.uri;
  const skill = typeof uri === "string" ? (parseSkillUri(uri)?.[0] ?? "") : "";

  const store = await loadStore(env);
  const server = createSkillsServer(store, { name: "dotclaude-skills-hosted" });
  const transport = new OneShotTransport();
  await server.connect(transport);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    transport.onmessage?.(message);
    if (!("method" in message) || !("id" in message)) {
      return { response: new Response(null, { status: 202 }), method, skill, outcome: "notification", responseBytes: 0 };
    }
    const reply = await Promise.race([
      transport.response,
      new Promise<never>((_, reject) => (timeout = setTimeout(() => reject(new Error("handler timeout")), 10_000))),
    ]);
    const { response, bytes } = json(reply);
    const outcome = "error" in reply ? `error:${(reply as { error: { code: number } }).error.code}` : "ok";
    return { response, method, skill, outcome, responseBytes: bytes };
  } catch {
    return reject(500, "Request handler failed", -32603);
  } finally {
    clearTimeout(timeout);
    await server.close();
  }
}

/**
 * Product-level event: one `skill_used` per skill-scoped request, alongside
 * the Analytics Engine firehose. Fire-and-forget via waitUntil so ingestion
 * latency never touches the response.
 */
function emitPosthog(env: Env, ctx: ExecutionContext | undefined, request: Request, served: Served, latencyMs: number): void {
  if (!env.POSTHOG_API_KEY || !served.skill) return;
  const cf = (request as { cf?: { country?: string; colo?: string } }).cf;
  const label = (request.headers.get("x-skills-client") ?? "").slice(0, 32);
  const send = fetch(`${env.POSTHOG_HOST ?? "https://us.i.posthog.com"}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.POSTHOG_API_KEY,
      event: "skill_used",
      distinct_id: label || "public",
      properties: {
        skill: served.skill,
        method: served.method,
        outcome: served.outcome,
        client_label: label,
        user_agent: (request.headers.get("user-agent") ?? "").slice(0, 96),
        country: cf?.country ?? "",
        colo: cf?.colo ?? "",
        latency_ms: latencyMs,
        response_bytes: served.responseBytes,
        transport: "hosted-worker",
      },
    }),
  }).catch(() => {});
  ctx ? ctx.waitUntil(send) : void send;
}

function record(env: Env, request: Request, served: Served, latencyMs: number): void {
  try {
    const cf = (request as { cf?: { country?: string; colo?: string } }).cf;
    env.METRICS?.writeDataPoint({
      blobs: [
        served.method.slice(0, 64),
        served.skill.slice(0, 64),
        served.outcome.slice(0, 32),
        (request.headers.get("x-skills-client") ?? "").slice(0, 32),
        (request.headers.get("user-agent") ?? "").slice(0, 96),
        cf?.country ?? "",
        cf?.colo ?? "",
      ],
      doubles: [latencyMs, served.responseBytes],
      indexes: [served.method.slice(0, 64)],
    });
  } catch {
    // metrics must never take a request down with them
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") {
      return serveHttp(request, env.ASSETS, async () => (await loadStore(env)).skills());
    }
    const started = Date.now();
    const served = await serve(request, env);
    const latencyMs = Date.now() - started;
    record(env, request, served, latencyMs);
    emitPosthog(env, ctx, request, served, latencyMs);
    return served.response;
  },
};
