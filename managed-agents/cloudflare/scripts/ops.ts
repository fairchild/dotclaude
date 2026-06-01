#!/usr/bin/env bun
/**
 * Platform operations against the Anthropic API using the org-scoped
 * ANTHROPIC_API_KEY. Reads the key from a .env file at invocation time;
 * never writes it anywhere. Distinct from the worker's runtime credentials
 * (which are env-scoped and live in .dev.vars).
 *
 * The org key has org-wide reach. Keep it off the worker host - the egress
 * layer exists precisely because anything readable by the agent can be
 * exfiltrated. This script runs developer-side.
 *
 * Usage:
 *   bun scripts/ops.ts env list
 *   bun scripts/ops.ts env create [name]
 *   bun scripts/ops.ts env show <id>
 *   bun scripts/ops.ts agent register [--dir agents/pr-review]
 *   bun scripts/ops.ts session create --agent <id> --env-id <id> [--metadata <json|@file>]
 *   bun scripts/ops.ts work stats --env-id <id>
 *
 * Env var overrides (used when not passed as flags):
 *   OPS_ENV_FILE         path to the .env file holding ANTHROPIC_API_KEY
 *   ANTHROPIC_ENVIRONMENT_ID, AGENT_ID
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const ENV_CANDIDATES = [
  process.env.OPS_ENV_FILE,
  `${homedir()}/code/dotclaude/.env`,
  `${homedir()}/.env`,
].filter((p): p is string => Boolean(p));

function loadKey(name: string): string {
  for (const path of ENV_CANDIDATES) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && m[1] === name) return m[2]!;
    }
  }
  throw new Error(`missing ${name} in any of: ${ENV_CANDIDATES.join(", ")}`);
}

const API_KEY = loadKey("ANTHROPIC_API_KEY");
const BASE = process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com";
const BETA = process.env.ANTHROPIC_BETA_HEADER ?? "managed-agents-2026-04-01";

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": BETA,
      "content-type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${res.statusText}\n${text}`);
  return text ? JSON.parse(text) : null;
}

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const val = args[i + 1];
      if (val && !val.startsWith("--")) {
        out[key] = val;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function readMetadata(spec: string): Record<string, unknown> {
  if (spec.startsWith("@")) {
    return JSON.parse(readFileSync(spec.slice(1), "utf8"));
  }
  return JSON.parse(spec);
}

function requireFlag(flags: Record<string, string>, name: string, envName?: string): string {
  const v = flags[name] ?? (envName ? process.env[envName] : undefined);
  if (!v) throw new Error(`missing --${name}${envName ? ` (or env ${envName})` : ""}`);
  return v;
}

function usage(): never {
  process.stderr.write(`Usage:
  bun scripts/ops.ts env list
  bun scripts/ops.ts env create [name]
  bun scripts/ops.ts env show <id>
  bun scripts/ops.ts agent register [--dir agents/pr-review]
  bun scripts/ops.ts session create --agent <id> --env-id <id> [--metadata <json|@file>]
  bun scripts/ops.ts work stats --env-id <id>

ENV:
  OPS_ENV_FILE          path to the .env file with ANTHROPIC_API_KEY
  ANTHROPIC_ENVIRONMENT_ID, AGENT_ID    flag fallbacks
`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [sub, op, ...rest] = process.argv.slice(2);

  if (sub === "env" && op === "list") {
    console.log(JSON.stringify(await api("GET", "/v1/environments"), null, 2));
    return;
  }
  if (sub === "env" && op === "create") {
    const name = rest[0] ?? `dotclaude-${Date.now()}`;
    const out = await api("POST", "/v1/environments", {
      name,
      config: { type: "self_hosted" },
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (sub === "env" && op === "show") {
    const id = rest[0];
    if (!id) usage();
    console.log(JSON.stringify(await api("GET", `/v1/environments/${id}`), null, 2));
    return;
  }
  if (sub === "agent" && op === "register") {
    const flags = parseFlags(rest);
    const dir = flags.dir ?? "agents/pr-review";
    const def = JSON.parse(readFileSync(`${dir}/agent.json`, "utf8")) as {
      name: string;
      description: string;
      model: string;
      tools: unknown[];
    };
    // The system prompt lives in a sibling markdown file so reviewers can
    // edit it in their editor of choice; the API expects it as `system`.
    const system = readFileSync(`${dir}/system-prompt.md`, "utf8");
    const out = await api("POST", "/v1/agents", {
      name: def.name,
      description: def.description,
      model: def.model,
      system,
      tools: def.tools,
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (sub === "session" && op === "create") {
    const flags = parseFlags(rest);
    const agent = requireFlag(flags, "agent", "AGENT_ID");
    const envId = requireFlag(flags, "env-id", "ANTHROPIC_ENVIRONMENT_ID");
    const metadata = flags.metadata ? readMetadata(flags.metadata) : {};
    const out = await api("POST", "/v1/sessions", {
      agent,
      environment_id: envId,
      metadata,
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (sub === "work" && op === "stats") {
    const flags = parseFlags(rest);
    const envId = requireFlag(flags, "env-id", "ANTHROPIC_ENVIRONMENT_ID");
    const out = await api("POST", `/v1/environments/${envId}/work/stats`);
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  usage();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
