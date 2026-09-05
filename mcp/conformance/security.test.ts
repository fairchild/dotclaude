import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { FsStore } from "../core/fs-store.ts";
import { scanCatalog } from "../core/manifest.ts";
import worker from "../worker/worker.ts";

function fixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "skill-security-"));
  try {
    mkdirSync(join(root, "skills", "example"), { recursive: true });
    writeFileSync(join(root, "skills", "example", "SKILL.md"), "---\nname: example\ndescription: Example\n---\n# Example\n");
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const build = (root: string, out: string, extra: string[] = []) => spawnSync("bun", [join(import.meta.dir, "../worker/build.ts"), "--root", root, "--out", out, ...extra], { encoding: "utf8" });

describe("filesystem and build boundaries", () => {
  test("external links and cycles are rejected without exposing external bytes", () => fixture(root => {
    const skills = join(root, "skills");
    writeFileSync(join(root, "private.txt"), "private");
    symlinkSync(join(root, "private.txt"), join(skills, "example", "leak.txt"));
    expect(scanCatalog(skills).skills).toHaveLength(0);
    rmSync(join(skills, "example", "leak.txt"));
    symlinkSync(join(skills, "example"), join(skills, "example", "loop"));
    expect(scanCatalog(skills).skills).toHaveLength(0);
  }));
  test("a listed file replaced by a symlink cannot be read", () => fixture(root => {
    const skills = join(root, "skills");
    const file = join(skills, "example", "readme.txt");
    writeFileSync(file, "safe");
    const store = new FsStore(skills);
    writeFileSync(join(root, "private.txt"), "private");
    rmSync(file);
    symlinkSync(join(root, "private.txt"), file);
    expect(store.read("example", "readme.txt")).toBeNull();
    expect(store.read("example", "../../private.txt")).toBeNull();
  }));
  test("explicit top-level skill symlinks still work", () => fixture(root => {
    mkdirSync(join(root, "linked"));
    symlinkSync(join(root, "skills", "example"), join(root, "linked", "example"));
    const store = new FsStore(join(root, "linked"));
    expect(store.skills()).toHaveLength(1);
    expect(store.read("example", "SKILL.md")).not.toBeNull();
    expect(store.refresh("example")).toHaveProperty("uri", "skill://example/SKILL.md");
  }));
  test("oversized resources are rejected before reading their contents", () => fixture(root => {
    writeFileSync(join(root, "skills", "example", "big.txt"), Buffer.alloc(16 * 1024 * 1024 + 1));
    const catalog = scanCatalog(join(root, "skills"));
    expect(catalog.skills).toHaveLength(0);
    expect(catalog.diagnostics[0]?.reason).toContain("byte limit");
  }));
  test("build refuses overlapping and unmanaged output without deleting files", () => fixture(root => {
    const skills = join(root, "skills");
    for (const out of [root, skills, join(skills, "generated")]) expect(build(skills, out).status).not.toBe(0);
    expect(existsSync(join(skills, "example", "SKILL.md"))).toBe(true);
    mkdirSync(join(root, "unmanaged"));
    writeFileSync(join(root, "unmanaged", "keep.txt"), "keep");
    expect(build(skills, join(root, "unmanaged")).status).not.toBe(0);
    expect(readFileSync(join(root, "unmanaged", "keep.txt"), "utf8")).toBe("keep");
  }));
  test("output cannot overlap an externally linked skill source", () => fixture(root => {
    const catalog = join(root, "catalog");
    const source = join(root, "skills", "example");
    mkdirSync(catalog);
    symlinkSync(source, join(catalog, "example"));
    const original = readFileSync(join(source, "SKILL.md"));
    for (const out of [source, join(source, "generated"), join(root, "skills")]) {
      const result = build(catalog, out);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("output overlaps");
    }
    expect(readFileSync(join(source, "SKILL.md"))).toEqual(original);
    expect(existsSync(join(source, "generated"))).toBe(false);
    expect(build(catalog, join(root, "safe-output")).status).toBe(0);
  }));
  test("a failed staged build preserves the previous snapshot", () => fixture(root => {
    const skills = join(root, "skills");
    const out = join(root, "output");
    expect(build(skills, out).status).toBe(0);
    const before = readFileSync(join(out, "public", "manifest.json"));
    // Force the existing archive dependency to fail after staging has started.
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin", "tar"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const failed = spawnSync(process.execPath, [join(import.meta.dir, "../worker/build.ts"), "--root", skills, "--out", out], {
      encoding: "utf8", env: { ...process.env, PATH: join(root, "bin") },
    });
    expect(failed.status).not.toBe(0);
    expect(readFileSync(join(out, "public", "manifest.json"))).toEqual(before);
  }));
  test("managed rebuilds succeed and generated links use the selected origin", () => fixture(root => {
    const out = join(root, "output");
    for (let i = 0; i < 2; i++) expect(build(join(root, "skills"), out, ["--base-url", "https://example.org"]).status).toBe(0);
    for (const path of ["index.html", "llms.txt", "skill/example.html", "skill/example.md"]) {
      const text = readFileSync(join(out, "public", path), "utf8");
      expect(text).not.toContain("skills.cloudcompute.com");
      expect(text).toContain("https://example.org");
    }
  }));
});

const env = { ASSETS: { fetch: async () => new Response('{"skills":[]}') } };
const post = (body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) => worker.fetch(new Request("https://example.org/mcp", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
}), env);

describe("untrusted HTTP input", () => {
  test("invalid envelopes return errors instead of throwing or waiting", async () => {
    for (const value of [null, 1, true, "text", {}, [], { id: 1, method: "ping" }, { jsonrpc: "1.0", id: 1, method: "ping" }]) {
      expect((await post(JSON.stringify(value))).status).toBe(400);
    }
    expect((await post("{")).status).toBe(400);
  });
  test("UTF-8 bytes are bounded and an oversized stream is cancelled", async () => {
    expect((await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { text: "界".repeat(23000) } }))).status).toBe(413);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(65537)); }, cancel() { cancelled = true; } });
    expect((await post(stream)).status).toBe(413);
    expect(cancelled).toBe(true);
  });
  test("origin, version and media constraints are checked before dispatch", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect((await post(body, { Origin: "https://attacker.example" })).status).toBe(403);
    expect((await post(body, { Origin: "null" })).status).toBe(403);
    expect((await post(body, { "MCP-Protocol-Version": "bogus" })).status).toBe(400);
    expect((await post(body, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post(body, { Accept: "text/plain" })).status).toBe(406);
    expect((await post(body, { Origin: "https://example.org", "MCP-Protocol-Version": "2025-03-26" })).status).toBe(200);
    expect((await post('{"jsonrpc":"2.0","method":"notifications/initialized"}')).status).toBe(202);
    expect((await post('{"jsonrpc":"2.0","id":1,"result":{}}')).status).toBe(202);
  });
});
