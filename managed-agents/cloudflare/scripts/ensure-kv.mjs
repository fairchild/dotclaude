#!/usr/bin/env node
// Idempotent KV namespace creation. Calls `wrangler kv namespace create <name>`
// for each binding we declare in wrangler.jsonc, then prints the id mapping so
// you can paste them into wrangler.jsonc. Re-running is safe; existing
// namespaces print their id without recreating.

import { execSync } from "node:child_process";

const BINDINGS = ["SECRETS", "EGRESS_POLICIES", "AGENT_INBOX"];

function listExisting() {
  const raw = execSync("wrangler kv namespace list", { encoding: "utf8" });
  return JSON.parse(raw);
}

function create(name) {
  try {
    const out = execSync(`wrangler kv namespace create ${name}`, { encoding: "utf8" });
    // wrangler prints a wrangler.toml-style snippet; extract the id.
    const match = out.match(/id\s*=\s*"([^"]+)"/);
    return match?.[1] ?? null;
  } catch (e) {
    if (String(e.stderr).includes("already exists")) return null;
    throw e;
  }
}

const existing = listExisting();
const result = {};
for (const binding of BINDINGS) {
  const found = existing.find((n) => n.title.endsWith(`-${binding}`) || n.title === binding);
  if (found) {
    result[binding] = found.id;
    console.log(`[exists] ${binding} = ${found.id}`);
  } else {
    const id = create(binding);
    if (id) {
      result[binding] = id;
      console.log(`[created] ${binding} = ${id}`);
    } else {
      console.log(`[skipped] ${binding} (already exists per error)`);
    }
  }
}

console.log("\nPaste these into wrangler.jsonc kv_namespaces:");
console.log(JSON.stringify(
  Object.entries(result).map(([binding, id]) => ({ binding, id })),
  null,
  2,
));
