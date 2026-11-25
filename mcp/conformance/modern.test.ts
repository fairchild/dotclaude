/**
 * Protocol revision 2026-07-28 next to 2025-era traffic: the hosted handler
 * routes each request by its `_meta` envelope claim, and stdio pins one era
 * per connection. Raw HTTP bytes for the hosted leg; the SDK client, pinned
 * to the new revision, for stdio.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import worker from "../worker/worker.ts";
import {
  DirectoryReadResultSchema,
  EXTENSION_ID,
  PORTABILITY_META_KEY,
  SkillsGetResultSchema,
  SkillsListResultSchema,
} from "../core/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const TMP_PARENT = mkdtempSync(join(tmpdir(), "skill-server-modern-"));
const PUBLIC = join(TMP_PARENT, "dist", "public");
const MODERN = "2026-07-28";

const datapoints: Array<{ blobs?: string[] }> = [];
const env = {
  SERVER_NAME: "dotclaude-skills-hosted",
  ASSETS: {
    async fetch(request: Request): Promise<Response> {
      const file = join(PUBLIC, decodeURIComponent(new URL(request.url).pathname));
      return existsSync(file) ? new Response(readFileSync(file)) : new Response("not found", { status: 404 });
    },
  },
  METRICS: { writeDataPoint: (point: { blobs?: string[] }) => void datapoints.push(point) },
};

const envelope = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "modern-test", version: "0.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

let nextId = 100;
async function send(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}, meta: object | null = envelope) {
  const id = ++nextId;
  const response = await worker.fetch(new Request("https://skills.example/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "MCP-Protocol-Version": MODERN,
      "Mcp-Method": method,
      ...(typeof params.uri === "string" && method === "resources/read" ? { "Mcp-Name": params.uri } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: meta ? { ...params, _meta: meta } : params }),
  }), env);
  return { id, status: response.status, body: await response.json() as any };
}

const legacy = async (method: string, params: Record<string, unknown> = {}) =>
  (await worker.fetch(new Request("https://skills.example/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), env)).json() as Promise<any>;

beforeAll(() => {
  const build = spawnSync("bun", [join(import.meta.dir, "..", "worker", "build.ts"), "--root", FIXTURES, "--out", join(TMP_PARENT, "dist")], { encoding: "utf-8" });
  if (build.status !== 0) throw new Error(`build failed: ${build.stderr}`);
});

afterAll(() => rmSync(TMP_PARENT, { recursive: true, force: true }));

describe("hosted HTTP, 2026-07-28", () => {
  test("server/discover names the revision, the extension and the deployment", async () => {
    const { status, body } = await send("server/discover");
    expect(status).toBe(200);
    expect(body.result.supportedVersions).toContain(MODERN);
    expect(body.result.capabilities.extensions[EXTENSION_ID]).toEqual({ directoryRead: true });
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("dotclaude-skills-hosted");
    expect(body.result).toMatchObject({ resultType: "complete", ttlMs: 300_000, cacheScope: "public" });
  });

  test("every cacheable result carries the snapshot's cache fields", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["skills/list", {}],
      ["skills/get", { uri: "skill://git-workflow/SKILL.md" }],
      ["resources/directory/read", { uri: "skill://pdf-processing" }],
      ["resources/list", {}],
      ["resources/read", { uri: "skill://git-workflow/SKILL.md" }],
    ];
    for (const [method, params] of calls) {
      const { id, status, body } = await send(method, params);
      expect({ method, status, id: body.id }).toEqual({ method, status: 200, id });
      expect(body.result).toMatchObject({ resultType: "complete", ttlMs: 300_000, cacheScope: "public" });
    }
  });

  test("the catalog matches what a 2025-era client sees, minus the cache fields", async () => {
    const modern = (await send("skills/list")).body.result;
    const old = (await legacy("skills/list")).result;
    expect(modern.skills).toEqual(old.skills);
    expect(modern.skills.map((s: any) => s.frontmatter.name).sort()).toEqual(["git-workflow", "pdf-processing"]);
    expect(modern.skills.map((s: any) => s._meta)).toEqual([
      { [PORTABILITY_META_KEY]: "portable" }, { [PORTABILITY_META_KEY]: "portable" },
    ]);
    expect(old).not.toHaveProperty("ttlMs");
    expect(old).not.toHaveProperty("cacheScope");
  });

  test("envelope, header and method errors answer with the request id", async () => {
    const missingHeader = await send("skills/list", {}, { "MCP-Protocol-Version": "" });
    expect([missingHeader.status, missingHeader.body.error.code, missingHeader.body.id]).toEqual([400, -32020, missingHeader.id]);

    const noCapabilities = await send("skills/list", {}, {}, { "io.modelcontextprotocol/protocolVersion": MODERN });
    expect([noCapabilities.status, noCapabilities.body.error.code, noCapabilities.body.id]).toEqual([400, -32602, noCapabilities.id]);

    const future = await send("skills/list", {}, { "MCP-Protocol-Version": "2099-01-01" }, { ...envelope, "io.modelcontextprotocol/protocolVersion": "2099-01-01" });
    expect([future.status, future.body.error.code]).toEqual([400, -32022]);
    expect(future.body.error.data.supported).toContain(MODERN);

    const unknown = await send("skills/nope");
    expect([unknown.status, unknown.body.error.code, unknown.body.id]).toEqual([404, -32601, unknown.id]);

    const missing = await send("resources/read", { uri: "skill://nope/SKILL.md" });
    expect([missing.status, missing.body.error.code, missing.body.id]).toEqual([200, -32602, missing.id]);
  });

  test("rejections before dispatch echo a parseable id", async () => {
    const { status, body } = await send("skills/list", {}, { "Content-Type": "text/plain" });
    expect(status).toBe(415);
    expect(body.id).toBe(nextId);
  });

  test("metrics record the method, skill and outcome of a modern request", async () => {
    datapoints.length = 0;
    await send("skills/get", { uri: "skill://git-workflow/SKILL.md" });
    expect(datapoints.at(-1)?.blobs?.slice(0, 3)).toEqual(["skills/get", "git-workflow", "ok"]);
  });
});

describe("stdio, 2026-07-28", () => {
  test("a pinned client gets the stdio cache fields; a default client still speaks 2025", async () => {
    const spawn = () => new StdioClientTransport({ command: "bun", args: [join(import.meta.dir, "..", "stdio.ts"), "--root", FIXTURES] });
    const modern = new Client({ name: "stdio-modern", version: "0.0.0" }, { versionNegotiation: { mode: { pin: MODERN } } });
    await modern.connect(spawn());
    try {
      expect(modern.getNegotiatedProtocolVersion()).toBe(MODERN);
      const list = await modern.request({ method: "skills/list", params: {} }, SkillsListResultSchema);
      expect(list).toMatchObject({ ttlMs: 0, cacheScope: "private" });
      const get = await modern.request({ method: "skills/get", params: { uri: "skill://git-workflow/SKILL.md" } }, SkillsGetResultSchema);
      expect(get.skill.frontmatter.name).toBe("git-workflow");
      const dir = await modern.request({ method: "resources/directory/read", params: { uri: "skill://pdf-processing" } }, DirectoryReadResultSchema);
      expect(dir.ttlMs).toBe(0);
    } finally {
      await modern.close();
    }

    const old = new Client({ name: "stdio-2025", version: "0.0.0" });
    await old.connect(spawn());
    try {
      expect(old.getNegotiatedProtocolVersion()).not.toBe(MODERN);
      const list = await old.request({ method: "skills/list", params: {} }, SkillsListResultSchema);
      expect(list.ttlMs).toBeUndefined();
    } finally {
      await old.close();
    }
  }, 20000);
});

describe("SDK client over HTTP", () => {
  test("auto negotiation against a live listener lands on 2026-07-28", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => worker.fetch(request, env) });
    const client = new Client({ name: "http-auto", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)));
      expect(client.getNegotiatedProtocolVersion()).toBe(MODERN);
      const list = await client.request({ method: "skills/list", params: {} }, SkillsListResultSchema);
      expect(list).toMatchObject({ ttlMs: 300_000, cacheScope: "public" });
      const read = await client.readResource({ uri: "skill://git-workflow/SKILL.md" });
      expect((read.contents[0] as { text: string }).text).toContain("Git workflow");
    } finally {
      await client.close();
      server.stop(true);
    }
  }, 15000);
});
