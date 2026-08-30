#!/usr/bin/env bun
/**
 * Local stdio binding: serve a live skills directory over MCP (SEP-2640).
 *
 * Default root is the invoking user's own ~/.claude/skills — first-party,
 * gitignored-local, and ecosystem-symlinked skills alike — hashed at startup.
 * A same-machine consumer has the environment those skills assume, so no tier
 * filter applies by default; --portable-only narrows to the portable tier
 * (what the hosted binding serves).
 *
 * Usage: bun stdio.ts [--root <dir>] [--portable-only]
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { createSkillsServer } from "./core/server.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: join(homedir(), ".claude", "skills") },  // portability: allow
    "portable-only": { type: "boolean", default: false },
  },
});

const server = createSkillsServer({
  root: values.root!,
  tier: values["portable-only"] ? "portable" : undefined,
  onDiagnostic: (message) => console.error(`[skills] ${message}`),
});

await server.connect(new StdioServerTransport());
console.error(`[skills] serving ${values.root} over stdio`);
