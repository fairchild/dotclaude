/**
 * The Node `serve` binding over a real socket: the identity a third party's
 * client sees, and what a rebuild underneath a running server does to the
 * agreement between advertised digests and served bytes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../node-server.ts";
import { version } from "../version.ts";

const scratch = mkdtempSync(join(tmpdir(), "skill-node-serve-"));
const source = join(scratch, "skills");
const out = join(scratch, "snapshot");
const supporting = join(source, "pdf-processing", "templates", "invoice.md");
const uri = "skill://pdf-processing/templates/invoice.md";

function build(): void {
  const result = spawnSync("bun", [join(import.meta.dir, "..", "worker", "build.ts"), "--root", source, "--out", out], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`build failed: ${result.stderr}`);
}

let origin = "";
let server: Server | undefined;

beforeAll(async () => {
  cpSync(join(import.meta.dir, "fixtures"), source, { recursive: true });
  build();
  server = await startServer(out, "127.0.0.1", 0);
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server?.closeAllConnections();
  server?.close();
  rmSync(scratch, { recursive: true, force: true });
});

let nextId = 0;
async function rpc(method: string, params: unknown = {}): Promise<any> {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

/** What the manifest claims for one resource, beside the hash of the bytes served for it. */
async function digests(): Promise<{ advertised: string; served: string }> {
  const { result } = await rpc("skills/get", { uri: "skill://pdf-processing/SKILL.md" });
  const advertised = result.skill.resources.find((r: any) => r.uri === uri).digest as string;
  const read = await rpc("resources/read", { uri });
  const content = read.result.contents[0];
  const bytes = "text" in content ? Buffer.from(content.text, "utf-8") : Buffer.from(content.blob, "base64");
  return { advertised, served: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

describe("node serve binding", () => {
  test("announces the package's own identity, not a deployment's", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "node-serve-conformance", version: "0.0.0" },
    });
    expect(init.result.serverInfo).toEqual({ name: "skill-server", version });
  });

  test("a rebuild under a running server moves digests and bytes together", async () => {
    const before = await digests();
    expect(before.served).toBe(before.advertised);

    writeFileSync(supporting, `${readFileSync(supporting, "utf-8")}\n<!-- rebuilt under a live server -->\n`);
    build();

    const after = await digests();
    expect(after.served).toBe(after.advertised);
    expect(after.advertised).not.toBe(before.advertised);
    expect(after.served).toBe(`sha256:${createHash("sha256").update(readFileSync(supporting)).digest("hex")}`);
  });
});
