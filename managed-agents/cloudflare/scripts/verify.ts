#!/usr/bin/env bun
/**
 * End-to-end verification of the deployed worker against the live Anthropic
 * beta API. Run after a merge or any time you want a clean "yes it still
 * works" signal.
 *
 * Five checks:
 *   1. /healthz on the deployed worker URL  →  200 {ok: true}
 *   2. Anthropic env exists and is active   →  /v1/environments/{id}
 *   3. A "v1.1-verify" test agent exists    →  list or create one
 *   4. Create a session + post a user message that prompts a tool call
 *   5. Poll until session idle, assert the events list contains:
 *        - an agent.custom_tool_use for our echo tool
 *        - a user.custom_tool_result whose custom_tool_use_id matches
 *
 * Reads ANTHROPIC_API_KEY, ANTHROPIC_ENVIRONMENT_ID, and (optionally) a
 * WORKER_URL override from ~/.env (or wherever $OPS_ENV_FILE points).
 * Defaults WORKER_URL to the dotclaude-deployed URL.
 *
 * Exit 0 on all pass, 1 on any failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const ENV_CANDIDATES = [
  process.env.OPS_ENV_FILE,
  `${homedir()}/code/dotclaude/.env`,
  `${homedir()}/.env`,
].filter((p): p is string => Boolean(p));

function loadKey(name: string): string | null {
  for (const path of ENV_CANDIDATES) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && m[1] === name) return m[2]!;
    }
  }
  return null;
}

const API_KEY = loadKey("ANTHROPIC_API_KEY");
const ENV_ID = loadKey("ANTHROPIC_ENVIRONMENT_ID");
const WORKER_URL = process.env.WORKER_URL
  ?? loadKey("MANAGED_AGENTS_WORKER_URL")
  ?? "https://managed-agents-cloudflare.irons-in-the-fire8698.workers.dev";
const BASE = "https://api.anthropic.com";
const BETA = "managed-agents-2026-04-01";
const VERIFY_AGENT_NAME = "v1.1-verify";

let pass = 0;
let fail = 0;

function ok(msg: string): void {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  pass++;
}
function bad(msg: string, err?: unknown): void {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}${err ? `: ${String(err)}` : ""}`);
  fail++;
}

if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY not found in any .env candidate");
  process.exit(2);
}
if (!ENV_ID) {
  console.error("ANTHROPIC_ENVIRONMENT_ID not found in any .env candidate");
  process.exit(2);
}

async function api(method: string, path: string, body?: unknown, opts: { auth?: "x-api-key" | "bearer"; token?: string } = {}): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "anthropic-beta": BETA,
    "content-type": "application/json",
  };
  if ((opts.auth ?? "x-api-key") === "x-api-key") headers["x-api-key"] = API_KEY!;
  else headers["authorization"] = `Bearer ${opts.token ?? API_KEY}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function findOrCreateAgent(): Promise<string> {
  const listed = await api("GET", "/v1/agents?limit=100");
  if (listed.status === 200) {
    const data = (listed.data as { data?: Array<{ id: string; name: string }> }).data ?? [];
    const existing = data.find((a) => a.name === VERIFY_AGENT_NAME);
    if (existing) return existing.id;
  }

  const created = await api("POST", "/v1/agents", {
    name: VERIFY_AGENT_NAME,
    description: "Round-trip verification agent for managed-agents/cloudflare. Uses the echo custom tool only.",
    model: "claude-sonnet-4-6",
    system: "You verify a self-hosted environment worker is responding. When asked, call the echo tool once with the provided message, then reply 'verified'. Keep responses to a single sentence.",
    tools: [{
      type: "custom",
      name: "echo",
      description: "Return the input verbatim. Smoke-tests the worker tool dispatch.",
      input_schema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    }],
  });
  if (created.status !== 200) throw new Error(`agent create failed: ${created.status} ${JSON.stringify(created.data)}`);
  return (created.data as { id: string }).id;
}

async function main(): Promise<void> {
  console.log(`verify ${WORKER_URL}`);
  console.log(`       env=${ENV_ID}`);
  console.log();

  // 1. /healthz
  console.log("[1/5] worker /healthz");
  try {
    const res = await fetch(`${WORKER_URL}/healthz`);
    const body = await res.json().catch(() => null);
    if (res.status === 200 && (body as { ok?: boolean })?.ok === true) ok("worker is alive (200, {ok: true})");
    else bad(`unexpected response: ${res.status} ${JSON.stringify(body)}`);
  } catch (e) { bad("fetch failed", e); }

  // 2. Anthropic env
  console.log("\n[2/5] anthropic environment");
  try {
    const res = await api("GET", `/v1/environments/${ENV_ID}`);
    const e = res.data as { state?: string; name?: string; config?: { type?: string } };
    if (res.status === 200 && e?.state === "active" && e?.config?.type === "self_hosted") {
      ok(`env "${e.name}" is active (self_hosted)`);
    } else {
      bad(`env not active or wrong type: ${JSON.stringify(e)}`);
    }
  } catch (e) { bad("env check failed", e); }

  // 3. Test agent
  console.log("\n[3/5] verify agent");
  let agentId: string;
  try {
    agentId = await findOrCreateAgent();
    ok(`agent "${VERIFY_AGENT_NAME}" available (${agentId})`);
  } catch (e) { bad("agent setup failed", e); process.exit(1); }

  // 4. Create session + trigger
  console.log("\n[4/5] session round-trip");
  const created = await api("POST", "/v1/sessions", {
    agent: agentId,
    environment_id: ENV_ID,
    metadata: { test: "verify", at: new Date().toISOString() },
  });
  if (created.status !== 200) { bad(`session create: ${created.status} ${JSON.stringify(created.data)}`); process.exit(1); }
  const sessionId = (created.data as { id: string }).id;
  ok(`session created (${sessionId})`);

  const send = await api("POST", `/v1/sessions/${sessionId}/events`, {
    events: [{
      type: "user.message",
      content: [{ type: "text", text: 'Call the echo tool with message="verify ping" and then reply "verified".' }],
    }],
  });
  if (send.status !== 200) bad(`user.message post: ${send.status}`);
  else ok("user.message posted (triggers webhook to worker)");

  // 5. Poll until idle, then inspect events
  console.log("\n[5/5] waiting for tool dispatch + result");
  let final = "running";
  let elapsed = 0;
  const deadline = 60;
  while (elapsed < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    elapsed += 2;
    const res = await api("GET", `/v1/sessions/${sessionId}`);
    final = (res.data as { status?: string }).status ?? "?";
    process.stdout.write(`  t+${String(elapsed).padStart(2, "0")}s status=${final}\r`);
    if (final === "idle" || final === "completed" || final === "failed") break;
  }
  console.log();

  const evRes = await api("GET", `/v1/sessions/${sessionId}/events?beta=true&limit=100`);
  const events = ((evRes.data as { data?: Array<Record<string, unknown>> }).data ?? []);
  const toolUse = events.find((e) => e.type === "agent.custom_tool_use");
  const toolResult = events.find((e) =>
    e.type === "user.custom_tool_result"
    && (e as { custom_tool_use_id?: string }).custom_tool_use_id === (toolUse?.id as string | undefined),
  );

  if (toolUse) ok(`agent emitted custom_tool_use (${toolUse.id} → ${toolUse.name})`);
  else bad("agent never called the tool — model may have refused or worker never got the webhook");
  if (toolResult) ok(`worker posted matching custom_tool_result (${toolResult.id})`);
  else bad("no matching user.custom_tool_result — worker didn't dispatch or post failed");

  if (final === "idle") ok(`session reached idle in ${elapsed}s`);
  else bad(`session ended in status=${final} (expected idle)`);

  console.log();
  console.log(`${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify aborted:", err);
  process.exit(2);
});
