/** Opt-in integration check against `wrangler dev`, using the real asset binding. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StoredSkill } from "../core/store.ts";

const origin = process.env.SKILLS_HTTP_ORIGIN;
const publicDir = process.env.SKILLS_SNAPSHOT_DIR ?? join(import.meta.dir, "../worker/dist/public");
const get = (path: string, accept = "*/*", method = "GET", headers: Record<string, string> = {}) =>
  fetch(`${origin}${path}`, { method, headers: { Accept: accept, ...headers }, redirect: "manual" });

describe.skipIf(!origin)("local Worker HTTP integration", () => {
  test("an agent can discover, read, follow files, and verify an installation from only the homepage", async () => {
    const home = await get("/", "text/markdown");
    expect(home.status).toBe(200);
    expect(home.headers.get("Link")).toContain("/llms.txt");
    const catalog = await home.text();
    const directoryUrl = catalog.match(/\]\((\/skill\/[^)]+\.md)\)/)?.[1];
    expect(directoryUrl).toBeTruthy();
    const directory = await (await get(directoryUrl!)).text();
    const fileLinks = [...directory.matchAll(/\]\((\/skills\/[^)]+)\)/g)].map(match => match[1]!);
    const skillUrl = fileLinks.find(path => path.endsWith("/SKILL.md"));
    expect(skillUrl).toBeTruthy();
    const skill = await (await get(skillUrl!)).text();
    expect(skill).toStartWith("---");
    const supporting = fileLinks.find(path => !path.endsWith("/SKILL.md"));
    expect(supporting).toBeTruthy();
    expect((await get(supporting!)).status).toBe(200);
    const archiveUrl = new URL(directory.match(/^Download: (.+)$/m)![1]!);
    const manifestUrl = new URL(directory.match(/^Manifest: (.+)$/m)![1]!);
    const digest = directory.match(/^SHA-256: ([a-f0-9]{64})$/m)![1]!;
    const archive = await get(archiveUrl.pathname);
    expect(archive.status).toBe(200);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
    const pinned = await (await get(manifestUrl.pathname)).json() as any;
    const members = await new Bun.Archive(bytes).files();
    expect([...members.keys()].sort()).toEqual(pinned.entry.resources.map((r: any) => r.uri.slice("skill://".length)).sort());
    for (const resource of pinned.entry.resources) {
      const file = members.get(resource.uri.slice("skill://".length))!;
      const body = new Uint8Array(await file.arrayBuffer());
      expect(body.length).toBe(resource.size);
      expect(`sha256:${createHash("sha256").update(body).digest("hex")}`).toBe(resource.digest);
    }
    const missing = archiveUrl.pathname.replace(digest, "0".repeat(64));
    expect((await get(missing)).status).toBe(404);
  });

  test("real assets honor negotiation, explicit paths, HEAD, validators, and MCP", async () => {
    const { skills } = await (await get("/manifest.json")).json() as { skills: StoredSkill[] };
    const name = String(skills[0]!.entry.frontmatter.name);
    for (const [accept, expected] of [["text/plain", "text/plain"], ["text/markdown", "text/markdown"], ["text/html", "text/html"], ["application/gzip", "application/gzip"], ["text/html;q=0,text/*;q=0.8", "text/markdown"]]) {
      const response = await get(`/skill/${name}`, accept);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toStartWith(expected!);
      expect(response.headers.get("Vary")).toContain("Accept");
      if (expected === "text/html") expect(await response.text()).toContain("Copy install prompt");
      else await response.arrayBuffer();
    }
    const raw = await get(`/txt/${name}/SKILL.md`);
    expect(raw.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const etag = raw.headers.get("ETag");
    expect(etag).toBeTruthy();
    await raw.arrayBuffer();
    const head = await get(`/skills/${name}`, "text/plain", "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const directoryTag = head.headers.get("ETag");
    expect(directoryTag).toBeTruthy();
    const cached = await get(`/skills/${name}`, "text/plain", "GET", { "If-None-Match": directoryTag! });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("Vary")).toContain("Accept");
    expect((await get(`/skills/${name}`, "text/html", "GET", { "If-None-Match": etag! })).status).toBe(200);
    for (const path of [`/skill/${name}`, `/skill/${name}.html`, `/skills/${name}/SKILL.md`, `/downloads/${name}/skill.tgz`]) {
      expect((await get(path, "image/unavailable")).status).toBe(406);
    }
    expect((await get("/skills/no-such-skill")).status).toBe(404);
    expect((await get(`/txt/${name}/missing`)).status).toBe(404);
    expect((await get(`/txt/${name}/%252e%252e/manifest.json`)).status).toBe(400);
    expect((await get(`/txt/${name}/a%2fb`)).status).toBe(400);
    expect((await get("/", "text/html")).status).toBe(200);
    expect((await get("/mcp")).status).toBe(405);
    const rpc = await fetch(`${origin}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "skills/list", params: {} }) });
    expect(rpc.status).toBe(200);
    expect((await rpc.json() as any).result.skills.length).toBeGreaterThan(0);
  });

  test("initialize announces the deployment identity from the real wrangler.toml binding", async () => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "http-live-conformance", version: "0.0.0" } },
      }),
    });
    expect(response.status).toBe(200);
    const { result } = await response.json() as any;
    expect(result.serverInfo.name).toBe("dotclaude-skills-hosted");
    expect(typeof result.serverInfo.version).toBe("string");
    expect(result.serverInfo.version.length).toBeGreaterThan(0);
  });

  test("every raw and txt file matches the manifest; every archive matches its built bytes", async () => {
    const { skills } = JSON.parse(readFileSync(join(publicDir, "manifest.json"), "utf8")) as { skills: StoredSkill[] };
    let count = 0;
    for (const { entry } of skills) {
      if (entry.resources === "dynamic") throw new Error("Expected static snapshot");
      const name = String(entry.frontmatter.name);
      for (const resource of entry.resources) {
        const path = resource.uri.slice("skill://".length).split("/").map(encodeURIComponent).join("/");
        for (const prefix of ["skills", "txt"]) {
          const response = await get(`/${prefix}/${path}`);
          expect(response.status).toBe(200);
          const bytes = new Uint8Array(await response.arrayBuffer());
          expect(bytes.length).toBe(resource.size);
          expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(resource.digest);
        }
        count++;
      }
      const path = `downloads/${name}/skill.tgz`;
      const archive = await get(`/${path}`);
      expect(archive.headers.get("Content-Disposition")).toBe(`attachment; filename="${name}.tgz"`);
      expect(Buffer.from(await archive.arrayBuffer())).toEqual(readFileSync(join(publicDir, path)));
    }
    console.info(`Verified ${count} files through both raw and txt routes, plus ${skills.length} archives`);
  }, 60_000);
});
