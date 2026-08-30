/**
 * Worker binding, in-process: build the snapshot from the fixtures, stub the
 * assets binding over the built output, and drive the fetch handler with raw
 * Streamable HTTP requests — the same bytes a remote MCP client would send.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import worker from "../worker/worker.ts";
import { EXTENSION_ID } from "../core/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const DIST = join(import.meta.dir, ".worker-dist");
const PUBLIC = join(DIST, "public");

/** Serve the built dist/public the way the Workers assets binding would. */
const env = {
  ASSETS: {
    async fetch(request: Request): Promise<Response> {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const file = join(PUBLIC, path);
      if (!existsSync(file)) return new Response("not found", { status: 404 });
      return new Response(readFileSync(file));
    },
  },
};

const post = (body: unknown) =>
  worker.fetch(
    new Request("https://skills.example/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

let nextId = 0;
async function rpc(method: string, params: unknown = {}): Promise<any> {
  const response = await post({ jsonrpc: "2.0", id: ++nextId, method, params });
  expect(response.status).toBe(200);
  return response.json();
}

beforeAll(() => {
  const build = spawnSync(
    "bun",
    [join(import.meta.dir, "..", "worker", "build.ts"), "--root", FIXTURES, "--out", DIST],
    { encoding: "utf-8" },
  );
  if (build.status !== 0) throw new Error(`build failed: ${build.stderr}`);
});

describe("worker binding", () => {
  test("initialize declares the extension; initialized notification gets 202", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "worker-conformance", version: "0.0.0" },
    });
    expect(init.result.capabilities.extensions[EXTENSION_ID]).toEqual({ directoryRead: true });
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
  });

  test("serves the portable tier only — the build excluded machine-bound", async () => {
    const { result } = await rpc("skills/list");
    expect(result.skills.map((s: any) => s.frontmatter.name).sort()).toEqual([
      "git-workflow", "pdf-processing",
    ]);
  });

  test("resources/read bytes match the manifest digest", async () => {
    const { result } = await rpc("skills/list");
    const pdf = result.skills.find((s: any) => s.frontmatter.name === "pdf-processing");
    for (const resource of pdf.resources) {
      const read = await rpc("resources/read", { uri: resource.uri });
      const content = read.result.contents[0];
      const bytes = "text" in content
        ? Buffer.from(content.text, "utf-8")
        : Buffer.from(content.blob, "base64");
      expect(bytes.length).toBe(resource.size);
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(resource.digest);
    }
  });

  test("skills/get answers as built; unknown skill errors -32602", async () => {
    const get = await rpc("skills/get", { uri: "skill://git-workflow/SKILL.md" });
    expect(get.result.skill.frontmatter.name).toBe("git-workflow");
    const missing = await rpc("skills/get", { uri: "skill://bound-skill/SKILL.md" });
    expect(missing.error.code).toBe(-32602);
  });

  test("resources/directory/read walks the snapshot's manifest view", async () => {
    const { result } = await rpc("resources/directory/read", { uri: "skill://pdf-processing/templates" });
    expect(result.resources.map((r: any) => r.name)).toEqual(["invoice.md", "regional"]);
  });

  test("GET is 405 and batches are rejected", async () => {
    const get = await worker.fetch(new Request("https://skills.example/mcp"), env);
    expect(get.status).toBe(405);
    const batch = await post([{ jsonrpc: "2.0", id: 1, method: "skills/list", params: {} }]);
    expect(batch.status).toBe(400);
  });
});

describe("hardening (exercise-workflow findings)", () => {
  test("oversized request body answers 413, not a megabyte reflection", async () => {
    const big = await post({ jsonrpc: "2.0", id: 99, method: "skills/get", params: { uri: "x".repeat(1024 * 1024) } });
    expect(big.status).toBe(413);
    const body: any = await big.json();
    expect(body.error.code).toBe(-32600);
  });
});
