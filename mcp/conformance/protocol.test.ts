/**
 * Protocol revision 2026-07-28 on every binding: raw HTTP bytes for the
 * hosted handler, the SDK client for stdio and a live HTTP listener. Each
 * binding refuses 2025-era traffic with the revision it does speak.
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
import { envelope, MODERN, modernBody, modernHeaders } from "./wire.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const TMP_PARENT = mkdtempSync(join(tmpdir(), "skill-server-modern-"));
const PUBLIC = join(TMP_PARENT, "dist", "public");

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

let nextId = 100;
async function send(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}, meta: object | null = envelope("protocol-test")) {
  const id = ++nextId;
  const response = await worker.fetch(new Request("https://skills.example/mcp", {
    method: "POST",
    headers: { ...modernHeaders(method, params), ...headers },
    body: modernBody(id, method, params, meta),
  }), env);
  return { id, status: response.status, body: await response.json() as any };
}

beforeAll(() => {
  const build = spawnSync("bun", [join(import.meta.dir, "..", "worker", "build.ts"), "--root", FIXTURES, "--out", join(TMP_PARENT, "dist")], { encoding: "utf-8" });
  if (build.status !== 0) throw new Error(`build failed: ${build.stderr}`);
});

afterAll(() => rmSync(TMP_PARENT, { recursive: true, force: true }));

describe("hosted HTTP, 2026-07-28", () => {
  test("server/discover names the revision, the extension and the deployment", async () => {
    const { status, body } = await send("server/discover");
    expect(status).toBe(200);
    expect(body.result.supportedVersions).toEqual([MODERN]);
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

  test("the catalog is the portable tier, each entry marked portable", async () => {
    const { skills } = (await send("skills/list")).body.result;
    expect(skills.map((s: any) => s.frontmatter.name).sort()).toEqual(["git-workflow", "pdf-processing"]);
    expect(skills.map((s: any) => s._meta)).toEqual([
      { [PORTABILITY_META_KEY]: "portable" }, { [PORTABILITY_META_KEY]: "portable" },
    ]);
  });

  test("envelope, header and method errors answer with the request id", async () => {
    const missingHeader = await send("skills/list", {}, { "MCP-Protocol-Version": "" });
    expect([missingHeader.status, missingHeader.body.error.code, missingHeader.body.id]).toEqual([400, -32020, missingHeader.id]);

    const noCapabilities = await send("skills/list", {}, {}, { "io.modelcontextprotocol/protocolVersion": MODERN });
    expect([noCapabilities.status, noCapabilities.body.error.code, noCapabilities.body.id]).toEqual([400, -32602, noCapabilities.id]);

    const future = await send("skills/list", {}, { "MCP-Protocol-Version": "2099-01-01" }, { ...envelope(), "io.modelcontextprotocol/protocolVersion": "2099-01-01" });
    expect([future.status, future.body.error.code]).toEqual([400, -32022]);
    expect(future.body.error.data.supported).toEqual([MODERN]);

    const unknown = await send("skills/nope");
    expect([unknown.status, unknown.body.error.code, unknown.body.id]).toEqual([404, -32601, unknown.id]);

    const missing = await send("resources/read", { uri: "skill://nope/SKILL.md" });
    expect([missing.status, missing.body.error.code, missing.body.id]).toEqual([200, -32602, missing.id]);
  });

  test("a 2026-07-28 header over a body without its envelope is invalid params", async () => {
    const { id, status, body } = await send("skills/list", {}, {}, null);
    expect([status, body.error.code, body.id]).toEqual([400, -32602, id]);
  });

  test("rejections before dispatch echo a parseable id", async () => {
    const { status, body } = await send("skills/list", {}, { "Content-Type": "text/plain" });
    expect(status).toBe(415);
    expect(body.id).toBe(nextId);
  });

  test("metrics record the method, skill and outcome of a request", async () => {
    datapoints.length = 0;
    await send("skills/get", { uri: "skill://git-workflow/SKILL.md" });
    expect(datapoints.at(-1)?.blobs?.slice(0, 3)).toEqual(["skills/get", "git-workflow", "ok"]);
    await send("skills/list", {}, {}, null);
    expect(datapoints.at(-1)?.blobs?.slice(0, 3)).toEqual(["skills/list", "", "error:-32602"]);
  });
});

describe("stdio, 2026-07-28", () => {
  const spawn = () => new StdioClientTransport({ command: "bun", args: [join(import.meta.dir, "..", "stdio.ts"), "--root", FIXTURES], stderr: "ignore" });

  test("a pinned client gets the stdio cache fields", async () => {
    const client = new Client({ name: "stdio-modern", version: "0.0.0" }, { versionNegotiation: { mode: { pin: MODERN } } });
    await client.connect(spawn());
    try {
      expect(client.getNegotiatedProtocolVersion()).toBe(MODERN);
      const list = await client.request({ method: "skills/list", params: {} }, SkillsListResultSchema);
      expect(list).toMatchObject({ ttlMs: 0, cacheScope: "private" });
      const get = await client.request({ method: "skills/get", params: { uri: "skill://git-workflow/SKILL.md" } }, SkillsGetResultSchema);
      expect(get.skill.frontmatter.name).toBe("git-workflow");
      const dir = await client.request({ method: "resources/directory/read", params: { uri: "skill://pdf-processing" } }, DirectoryReadResultSchema);
      expect(dir.ttlMs).toBe(0);
    } finally {
      await client.close();
    }
  }, 20000);

  test("a 2025-era client cannot connect", async () => {
    const client = new Client({ name: "stdio-2025", version: "0.0.0" });
    try {
      expect(await client.connect(spawn()).then(() => "connected", (error: Error) => error.message)).toContain("Unsupported protocol version");
    } finally {
      await client.close();
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

  test("a 2025-era client cannot connect over HTTP either", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => worker.fetch(request, env) });
    const client = new Client({ name: "http-2025", version: "0.0.0" });
    try {
      const outcome = await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)))
        .then(() => "connected", (error: Error) => error.message);
      expect(outcome).not.toBe("connected");
    } finally {
      await client.close();
      server.stop(true);
    }
  }, 15000);
});
