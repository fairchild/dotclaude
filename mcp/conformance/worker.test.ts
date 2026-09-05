/**
 * Worker binding, in-process: build the snapshot from the fixtures, stub the
 * assets binding over the built output, and drive the fetch handler with raw
 * Streamable HTTP requests — the same bytes a remote MCP client would send.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import worker from "../worker/worker.ts";
import { EXTENSION_ID } from "../core/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
// A fresh mkdtemp parent, with DIST itself left uncreated, avoids a fixed
// conformance/.worker-dist: a leftover from a prior run (or one predating
// #272's output marker) makes buildSnapshot refuse to replace unmanaged
// output instead of rebuilding cleanly. buildSnapshot creates DIST itself.
const TMP_PARENT = mkdtempSync(join(tmpdir(), "skill-server-worker-dist-"));
const DIST = join(TMP_PARENT, "dist");
const PUBLIC = join(DIST, "public");

/** Serve the built dist/public the way the Workers assets binding would. */
const datapoints: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }> = [];
const env = {
  SERVER_NAME: "dotclaude-skills-hosted",
  ASSETS: {
    async fetch(request: Request): Promise<Response> {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const file = join(PUBLIC, path);
      if (!existsSync(file)) return new Response("not found", { status: 404 });
      return new Response(readFileSync(file));
    },
  },
  METRICS: {
    writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }) {
      datapoints.push(point);
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

afterAll(() => {
  rmSync(TMP_PARENT, { recursive: true, force: true });
});

describe("worker binding", () => {
  test("JSON discovery returns a compact homepage with usable links", async () => {
    const get = (path: string, accept = "application/json", method = "GET") => worker.fetch(
      new Request(`https://skills.example${path}`, { method, headers: { Accept: accept } }), env,
    );
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Vary")).toContain("Accept");
    const body = await response.json() as { description: string; mcp: string; manifest: string; instructions: string; specification: string };
    expect(body).toEqual({
      description: "dotclaude skills over MCP and HTTP",
      mcp: "/mcp", manifest: "/manifest.json", instructions: "/llms.txt",
      specification: "https://github.com/modelcontextprotocol/ext-skills",
    });
    expect((await get(body.manifest)).status).toBe(200);
    expect((await get(body.instructions, "text/markdown")).status).toBe(200);
    expect(await (await get("/index.json")).json()).toEqual(body);
    expect(await (await get("/index.html")).json()).toEqual(body);
    const head = await get("/", "application/json", "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await get("/", "application/json;q=1, text/html;q=0.5")).headers.get("Content-Type")).toContain("application/json");
    expect((await get("/", "application/json;q=0, */*;q=1")).headers.get("Content-Type")).toContain("text/html");
    expect((await get("/", "application/json;q=0")).status).toBe(406);
    expect((await get("/missing", "application/json")).status).toBe(404);
  });

  test("initialize declares the extension; initialized notification gets 202", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "worker-conformance", version: "0.0.0" },
    });
    expect(init.result.capabilities.extensions[EXTENSION_ID]).toEqual({ directoryRead: true });
    expect(init.result.serverInfo.name).toBe("dotclaude-skills-hosted");
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
  });

  test("the deployment name is a binding; without it the package names itself", async () => {
    const response = await worker.fetch(
      new Request("https://skills.example/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: ++nextId, method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "unbound", version: "0.0.0" } },
        }),
      }),
      { ASSETS: env.ASSETS },
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).result.serverInfo.name).toBe("skill-server");
  });

  test("catalog links to generated reading pages while raw resources stay intact", () => {
    const index = readFileSync(join(PUBLIC, "index.html"), "utf8");
    for (const name of ["git-workflow", "pdf-processing"]) {
      expect(index).toContain(`href="/skills/${name}/"`);
      const page = readFileSync(join(PUBLIC, "skill", `${name}.html`), "utf8");
      expect(page).toContain(`href="/skills/${name}/SKILL.md"`);
      expect(page).toContain("Copy install prompt");
      expect(page).toContain("manifest.json");
      expect(readFileSync(join(PUBLIC, "skills", name, "SKILL.md"))).toEqual(
        readFileSync(join(FIXTURES, name, "SKILL.md")),
      );
    }
    expect(existsSync(join(PUBLIC, "skill", "bound-skill.html"))).toBe(false);
  });

  test("download archives contain exactly the manifest files with original bytes and modes", async () => {
    const { skills } = JSON.parse(readFileSync(join(PUBLIC, "manifest.json"), "utf8"));
    for (const { entry } of skills) {
      const name = entry.frontmatter.name;
      const archivePath = join(PUBLIC, "downloads", name, "skill.tgz");
      const archive = new Bun.Archive(readFileSync(archivePath));
      const files = await archive.files();
      const paths = entry.resources.map((r: { uri: string }) => r.uri.slice("skill://".length));
      expect([...files.keys()].sort()).toEqual(paths.sort());
      const extracted = mkdtempSync(join(tmpdir(), "skill-archive-"));
      try {
        const result = spawnSync("tar", ["-xzf", archivePath, "-C", extracted]);
        expect(result.status).toBe(0);
        for (const path of paths) {
          expect(readFileSync(join(extracted, path))).toEqual(readFileSync(join(FIXTURES, path)));
          expect(statSync(join(extracted, path)).mode & 0o777).toBe(statSync(join(FIXTURES, path)).mode & 0o777);
        }
      } finally { rmSync(extracted, { recursive: true, force: true }); }
      const page = readFileSync(join(PUBLIC, "skill", `${name}.html`), "utf8");
      const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
      expect(page).toContain(`href="/downloads/${name}/${digest}.tgz"`);
      expect(readFileSync(join(PUBLIC, "downloads", name, `${digest}.tgz`))).toEqual(readFileSync(archivePath));
      const pinned = JSON.parse(readFileSync(join(PUBLIC, "downloads", name, `${digest}.json`), "utf8"));
      expect(pinned.entry).toEqual(entry);
      expect(pinned.archive.digest).toBe(digest);
    }
    expect(existsSync(join(PUBLIC, "downloads", "bound-skill", "skill.tgz"))).toBe(false);
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

describe("usage metrics", () => {
  test("every request emits one datapoint with method, skill, and outcome", async () => {
    datapoints.length = 0;
    await rpc("skills/get", { uri: "skill://git-workflow/SKILL.md" });
    const ok = datapoints.at(-1)!;
    expect(ok.blobs!.slice(0, 3)).toEqual(["skills/get", "git-workflow", "ok"]);
    expect(ok.doubles![0]).toBeGreaterThanOrEqual(0); // latency
    expect(ok.doubles![1]).toBeGreaterThan(0); // response bytes
    expect(ok.indexes).toEqual(["skills/get"]);

    await rpc("skills/get", { uri: "skill://bound-skill/SKILL.md" });
    expect(datapoints.at(-1)!.blobs![2]).toBe("error:-32602");

    await worker.fetch(new Request("https://skills.example/mcp"), env);
    expect(datapoints.at(-1)!.blobs!.slice(0, 3)).toEqual(["http:GET", "", "http:405"]);

    const labeled = await worker.fetch(
      new Request("https://skills.example/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-skills-client": "michael" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "skills/list", params: {} }),
      }),
      env,
    );
    expect(labeled.status).toBe(200);
    expect(datapoints.at(-1)!.blobs![3]).toBe("michael");
  });

  test("a missing METRICS binding is harmless", async () => {
    const bare = { ASSETS: env.ASSETS };
    const response = await worker.fetch(
      new Request("https://skills.example/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "skills/list", params: {} }),
      }),
      bare,
    );
    expect(response.status).toBe(200);
  });
});

describe("posthog emission", () => {
  test("skill-scoped requests emit skill_used; no key means no call", async () => {
    const captured: any[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("posthog.test")) {
        captured.push(JSON.parse(init.body));
        return new Response("{}", { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const waited: Promise<unknown>[] = [];
      const ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p) };
      const phEnv = { ...env, POSTHOG_API_KEY: "phc_test", POSTHOG_HOST: "https://posthog.test" };
      const request = (headers: Record<string, string> = {}) =>
        new Request("https://skills.example/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "skills/get", params: { uri: "skill://git-workflow/SKILL.md" } }),
        });

      await worker.fetch(request({ "x-skills-client": "michael" }), phEnv, ctx);
      await Promise.all(waited);
      expect(captured.length).toBe(1);
      expect(captured[0].event).toBe("skill_used");
      expect(captured[0].distinct_id).toBe("michael");
      expect(captured[0].properties.skill).toBe("git-workflow");
      expect(captured[0].properties.transport).toBe("hosted-worker");

      await worker.fetch(request(), phEnv, ctx); // unlabeled -> distinct_id public
      await Promise.all(waited);
      expect(captured.at(-1)!.distinct_id).toBe("public");

      captured.length = 0;
      await worker.fetch(request(), env, ctx); // no POSTHOG_API_KEY -> no emission
      await Promise.all(waited);
      expect(captured.length).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
