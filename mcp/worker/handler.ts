import { JSONRPCMessageSchema } from "@modelcontextprotocol/core";
import {
  createMcpHandler,
  isLegacyRequest,
  type CacheHint,
  type JSONRPCMessage,
  type McpHttpHandler,
  type Transport,
} from "@modelcontextprotocol/server";

import { createSkillsServer } from "../core/server.ts";
import { SnapshotStore, type StoredSkill } from "../core/store.ts";
import { parseSkillUri } from "../core/types.ts";
import { serveHttp } from "./http.ts";
import { negotiate } from "./accept.ts";


export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ALLOWED_ORIGINS?: string;
  /** Identity announced to clients; a deployment names itself, everyone else gets the package name. */
  SERVER_NAME?: string;
}

/** A snapshot is immutable per deployment, so any client may reuse a result for five minutes. */
export const SNAPSHOT_CACHE: Required<CacheHint> = { ttlMs: 300_000, cacheScope: "public" };


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

const MAX_BODY_BYTES = 64 * 1024;

/**
 * 2026-07-28 traffic (a per-request `_meta` envelope) goes to the SDK's strict
 * modern handler, one per assets binding. 2025-era traffic never reaches it:
 * the one-shot path below keeps answering it exactly as before.
 */
const modernHandlers = new WeakMap<Env["ASSETS"], McpHttpHandler>();

function modernHandler(env: Env): McpHttpHandler {
  let handler = modernHandlers.get(env.ASSETS);
  if (!handler) {
    handler = createMcpHandler(
      async () => createSkillsServer(await loadStore(env), { name: env.SERVER_NAME ?? "skill-server", cache: SNAPSHOT_CACHE }),
      { legacy: "reject", responseMode: "json", maxRequestBodySize: MAX_BODY_BYTES },
    );
    modernHandlers.set(env.ASSETS, handler);
  }
  return handler;
}

/** What one request resolves to, for both the HTTP reply and the datapoint. */
export interface Served {
  response: Response;
  method: string; // JSON-RPC method, or http:<verb> / <unparsed> / <batch>
  skill: string;
  outcome: string; // ok | notification | error:<code> | http:<status>
  responseBytes: number;
}

type Id = string | number | null;

function json(body: unknown, status = 200): { response: Response; bytes: number } {
  const text = JSON.stringify(body);
  return {
    bytes: new TextEncoder().encode(text).byteLength,
    response: new Response(text, { status, headers: { "Content-Type": "application/json" } }),
  };
}

function idOf(parsed: unknown): Id {
  const id = (parsed as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function outcomeOf(reply: unknown): string {
  const error = (reply as { error?: { code?: unknown } } | null)?.error;
  return error ? `error:${error.code}` : "ok";
}

async function readBody(request: Request): Promise<Uint8Array | "too-large" | "unreadable"> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) return "too-large";
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
          return "too-large";
        }
        chunks.push(value);
      }
    } catch { return "unreadable"; }
    finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => (timeout = setTimeout(() => reject(new Error("handler timeout")), 10_000))),
  ]).finally(() => clearTimeout(timeout));
}

export async function serve(request: Request, env: Env): Promise<Served> {
  let id: Id = null;
  const reject = (status: number, message: string, code = -32600): Served => {
    const { response, bytes } = json({ jsonrpc: "2.0", id, error: { code, message } }, status);
    return { response, method: "<rejected>", skill: "", outcome: `http:${status}`, responseBytes: bytes };
  };
  const origin = request.headers.get("Origin");
  const allowed = [new URL(request.url).origin, ...(env.ALLOWED_ORIGINS?.split(",").map(s => s.trim()) ?? [])];
  if (origin !== null && !allowed.includes(origin)) return reject(403, "Origin not allowed");
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

  const body = await readBody(request);
  if (body === "too-large") return reject(413, "Request body too large");
  if (body === "unreadable") return reject(400, "Cannot read request body");
  let parsed: unknown;
  let parseable = true;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { parseable = false; }
  id = idOf(parsed);
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return reject(415, "Use application/json");
  if (!negotiate(request.headers.get("Accept"), [{ contentType: "application/json" }])) return reject(406, "Accept application/json");
  if (!parseable) return reject(400, "Parse error", -32700);

  const method = Array.isArray(parsed) ? "<batch>"
    : typeof (parsed as { method?: unknown })?.method === "string" ? String((parsed as { method: string }).method) : "<response>";
  const uri = (parsed as { params?: { uri?: unknown } } | null)?.params?.uri;
  const skill = typeof uri === "string" ? (parseSkillUri(uri)?.[0] ?? "") : "";

  if (!(await isLegacyRequest(request, parsed))) {
    try {
      const answer = await withTimeout(modernHandler(env).fetch(request, { parsedBody: parsed }));
      const text = await answer.text();
      let reply: unknown = null;
      try { reply = text ? JSON.parse(text) : null; } catch {}
      return {
        response: new Response(text || null, { status: answer.status, headers: answer.headers }),
        method,
        skill,
        outcome: answer.status === 202 ? "notification" : reply ? outcomeOf(reply) : `http:${answer.status}`,
        responseBytes: new TextEncoder().encode(text).byteLength,
      };
    } catch {
      return reject(500, "Request handler failed", -32603);
    }
  }

  const validated = JSONRPCMessageSchema.safeParse(parsed);
  if (!validated.success) return reject(400, "Invalid JSON-RPC message");
  const message = validated.data;

  const store = await loadStore(env);
  const server = createSkillsServer(store, { name: env.SERVER_NAME ?? "skill-server" });
  const transport = new OneShotTransport();
  await server.connect(transport);
  try {
    transport.onmessage?.(message);
    if (!("method" in message) || !("id" in message)) {
      return { response: new Response(null, { status: 202 }), method, skill, outcome: "notification", responseBytes: 0 };
    }
    const reply = await withTimeout(transport.response);
    const { response, bytes } = json(reply);
    return { response, method, skill, outcome: outcomeOf(reply), responseBytes: bytes };
  } catch {
    return reject(500, "Request handler failed", -32603);
  } finally {
    await server.close();
  }
}


export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (new URL(request.url).pathname !== "/mcp") return serveHttp(request, env.ASSETS, async () => (await loadStore(env)).skills());
  return (await serve(request, env)).response;
}
