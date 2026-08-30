#!/usr/bin/env bun
/**
 * Host-side consumption example: materialize skills from a SEP-2640 server
 * into a local directory, the way a consuming host would.
 *
 * The flow is the one the SEP prescribes: take the skill's entry (its
 * complete manifest), fetch each file with `resources/read`, verify byte
 * length and SHA-256 digest against the entry before writing anything, and
 * refuse the whole skill on any mismatch — unverified content is never
 * used. Nothing is fetched that the manifest does not list.
 *
 * Usage:
 *   bun materialize.ts --out <dir> [--root <skills-dir>] [skill ...]
 *
 * With no skill names, materializes every skill the server lists. --root
 * selects the corpus the spawned stdio server serves (default: the live
 * ~/.claude/skills).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { EXTENSION_ID, SkillsListResultSchema, type SkillEntry } from "./core/types.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    root: { type: "string" },
  },
});
if (!values.out) {
  console.error("materialize.ts: --out <dir> is required");
  process.exit(2);
}

const serverArgs = [join(import.meta.dir, "stdio.ts")];
if (values.root) serverArgs.push("--root", values.root);

const client = new Client({ name: "materialize", version: "0.1.0" }, { capabilities: {} });
await client.connect(new StdioClientTransport({ command: "bun", args: serverArgs }));

if (!client.getServerCapabilities()?.extensions?.[EXTENSION_ID]) {
  console.error("server does not declare the skills extension");
  process.exit(1);
}

const entries: SkillEntry[] = [];
let cursor: string | undefined;
do {
  const page = await client.request(
    { method: "skills/list", params: cursor ? { cursor } : {} },
    SkillsListResultSchema,
  );
  entries.push(...page.skills);
  cursor = page.nextCursor;
} while (cursor);

const wanted = positionals.length
  ? entries.filter((e) => positionals.includes(String(e.frontmatter.name)))
  : entries;
const missing = positionals.filter((n) => !wanted.some((e) => e.frontmatter.name === n));
if (missing.length) {
  console.error(`not served: ${missing.join(", ")}`);
  process.exit(1);
}

let failures = 0;
for (const entry of wanted) {
  const name = String(entry.frontmatter.name);
  if (entry.resources === "dynamic") {
    console.error(`skip ${name}: dynamic skills offer no content integrity`);
    continue;
  }
  const staged: Array<{ path: string; bytes: Buffer }> = [];
  let ok = true;
  for (const resource of entry.resources) {
    const rel = resource.uri.slice(`skill://${name}/`.length);
    const read = await client.readResource({ uri: resource.uri });
    const content = read.contents[0]!;
    const bytes = "text" in content
      ? Buffer.from(content.text as string, "utf-8")
      : Buffer.from(content.blob as string, "base64");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (bytes.length !== resource.size || digest !== resource.digest) {
      console.error(`FAIL ${name}: ${rel} does not match its manifest entry (stale or tampered); skill refused`);
      ok = false;
      break;
    }
    staged.push({ path: join(values.out!, name, rel), bytes });
  }
  if (!ok) {
    failures++;
    continue; // nothing of a failed skill is written
  }
  for (const file of staged) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.bytes);
  }
  console.error(`ok ${name}: ${staged.length} files verified and written`);
}

await client.close();
process.exit(failures ? 1 : 0);
