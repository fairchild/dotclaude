#!/usr/bin/env bun
/**
 * Host-side consumption example: materialize skills from a SEP-2640 server
 * into a local directory, the way a consuming host would.
 *
 * The flow is the one the SEP prescribes: take the skill's entry (its
 * complete manifest), fetch each file with `resources/read`, verify byte
 * length and SHA-256 digest against the entry before writing anything, and
 * refuse the entire batch on any mismatch. Only a complete verified batch
 * becomes visible at the destination. Nothing is fetched that the manifest does not list.
 *
 * Usage:
 *   bun materialize.ts --root <skills-dir> --out <dir> [skill ...]
 *
 * --out must not exist, and its parent must exist without symlink ancestors.
 * The output parent must be owned by the operator with no concurrent writers.
 * Files are private and non-executable. Digest integrity does not establish safety.
 *
 * With no skill names, materializes every skill the server lists. --root
 * explicitly selects the corpus the spawned stdio server serves.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { materializeSkills, MAX_MATERIALIZED_SKILLS } from "./core/materialize.ts";
import { parseArgs } from "node:util";

import { EXTENSION_ID, SkillsListResultSchema, type SkillEntry } from "./core/types.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    root: { type: "string" },
  },
});
if (!values.out || !values.root) {
  console.error("materialize.ts: --root <skills-dir> and --out <dir> are required");
  process.exit(2);
}

const serverArgs = [join(import.meta.dir, "stdio.ts"), "--root", values.root];

const client = new Client({ name: "materialize", version: "0.1.0" }, { capabilities: {} });
try {
  await client.connect(new StdioClientTransport({ command: "bun", args: serverArgs }));

  if (!client.getServerCapabilities()?.extensions?.[EXTENSION_ID]) {
    throw new Error("server does not declare the skills extension");
  }

  const entries: SkillEntry[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  let pages = 0;
  do {
    const page = await client.request(
      { method: "skills/list", params: cursor !== undefined ? { cursor } : {} },
      SkillsListResultSchema,
    );
    entries.push(...page.skills);
    if (++pages > 256 || entries.length > MAX_MATERIALIZED_SKILLS) throw new Error("catalog limit exceeded");
    cursor = page.nextCursor;
    if (cursor !== undefined) {
      if (cursors.has(cursor)) throw new Error("repeated catalog cursor");
      cursors.add(cursor);
    }
  } while (cursor !== undefined);

  const wanted = positionals.length
    ? entries.filter((e) => positionals.includes(String(e.frontmatter.name)))
    : entries;
  const missing = positionals.filter((n) => !wanted.some((e) => e.frontmatter.name === n));
  if (missing.length) {
    throw new Error(`not served: ${missing.join(", ")}`);
  }

  await materializeSkills(wanted, (uri) => client.readResource({ uri }), values.out);
  console.error(`ok: ${wanted.length} skills verified and written to ${values.out}`);
} catch (error) {
  console.error(`materialize: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
