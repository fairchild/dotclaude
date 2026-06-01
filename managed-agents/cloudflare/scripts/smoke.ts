#!/usr/bin/env bun
/**
 * Local smoke test. Run `wrangler dev` in another terminal, then `bun scripts/smoke.ts`.
 *
 * Exercises:
 *   - GET  /healthz                              -> 200 {ok: true}
 *   - POST /webhooks  (signed)                   -> 200 {status: accepted, session_id}
 *   - POST /webhooks  (unsigned)                 -> 401
 *   - POST /webhooks  (signed, unrelated event)  -> 200 {status: ignored, type}
 *
 * Reads ANTHROPIC_WEBHOOK_SIGNING_KEY from .dev.vars (same source wrangler dev uses)
 * so signatures match what the running worker verifies against.
 */
import { readFileSync } from "node:fs";
import { Webhook } from "standardwebhooks";

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:8787";

function readDevVar(name: string): string {
  const raw = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && m[1] === name) return m[2]!;
  }
  throw new Error(`missing ${name} in .dev.vars`);
}

const SIGNING_KEY = readDevVar("ANTHROPIC_WEBHOOK_SIGNING_KEY");

function signHeaders(payload: string): Record<string, string> {
  const wh = new Webhook(SIGNING_KEY);
  const msgId = `msg_${crypto.randomUUID()}`;
  const ts = new Date();
  const sig = wh.sign(msgId, ts, payload);
  return {
    "webhook-id": msgId,
    "webhook-timestamp": String(Math.floor(ts.getTime() / 1000)),
    "webhook-signature": sig,
    "content-type": "application/json",
  };
}

interface Check {
  name: string;
  expect: { status: number; body?: unknown };
  actual: { status: number; body: unknown };
}

const checks: Check[] = [];

function record(name: string, expect: Check["expect"], actual: Check["actual"]): void {
  checks.push({ name, expect, actual });
}

async function request(path: string, init?: RequestInit): Promise<Check["actual"]> {
  const res = await fetch(`${BASE}${path}`, init);
  let body: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    body = await res.json().catch(() => null);
  } else {
    body = await res.text().catch(() => "");
  }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  console.log(`smoke against ${BASE}`);

  record("GET /healthz", { status: 200, body: { ok: true } }, await request("/healthz"));

  const startedPayload = JSON.stringify({
    type: "session.status_run_started",
    data: { session_id: "session_smoke" },
  });
  record(
    "POST /webhooks  (signed, run_started)",
    { status: 200, body: { status: "accepted", session_id: "session_smoke" } },
    await request("/webhooks", {
      method: "POST",
      headers: signHeaders(startedPayload),
      body: startedPayload,
    }),
  );

  record(
    "POST /webhooks  (unsigned)",
    { status: 401 },
    await request("/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: startedPayload,
    }),
  );

  const ignoredPayload = JSON.stringify({ type: "session.status_run_ended", data: {} });
  record(
    "POST /webhooks  (signed, ignored event)",
    { status: 200, body: { status: "ignored", type: "session.status_run_ended" } },
    await request("/webhooks", {
      method: "POST",
      headers: signHeaders(ignoredPayload),
      body: ignoredPayload,
    }),
  );

  let failed = 0;
  for (const c of checks) {
    const okStatus = c.actual.status === c.expect.status;
    const okBody = c.expect.body === undefined
      ? true
      : JSON.stringify(c.actual.body) === JSON.stringify(c.expect.body);
    const ok = okStatus && okBody;
    if (!ok) failed++;
    const mark = ok ? "✓" : "✗";
    console.log(`  ${mark} ${c.name} — ${c.actual.status}${c.expect.body !== undefined ? ` ${JSON.stringify(c.actual.body)}` : ""}`);
    if (!ok) {
      console.log(`     expected: ${c.expect.status}${c.expect.body !== undefined ? ` ${JSON.stringify(c.expect.body)}` : ""}`);
    }
  }

  console.log();
  console.log(`${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("smoke failed:", err);
  process.exit(1);
});
