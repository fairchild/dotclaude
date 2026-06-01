/**
 * Webhook entry. Anthropic delivers session-status events as Standard Webhooks
 * payloads, signed with ANTHROPIC_WEBHOOK_SIGNING_KEY. We verify, then
 * dispatch `session.status_run_started` into the work-claim loop.
 *
 * Response semantics (Standard Webhooks: 2xx prevents retry, non-2xx retries):
 *   - 401 if signature verification fails (don't retry - the secret is wrong)
 *   - 200 if signature verifies and the work is accepted; downstream errors
 *     in the ctx.waitUntil chain log but don't cause a retry, since the
 *     work item itself has independent reclaim semantics in Anthropic's queue
 *   - 200 for ignored event types
 */
import { Webhook } from "standardwebhooks";
import type { Env } from "./env.d.ts";
import { runSession } from "./heartbeat.ts";
import { json, log, text } from "./helpers.ts";

interface SessionStartedEvent {
  type: "session.status_run_started";
  data: { session_id: string };
}

type AnyWebhookEvent = SessionStartedEvent | { type: string; data: unknown };

export async function handleWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await req.text();
  const headers = Object.fromEntries(req.headers);

  let event: AnyWebhookEvent;
  try {
    const wh = new Webhook(env.ANTHROPIC_WEBHOOK_SIGNING_KEY);
    event = wh.verify(body, headers) as AnyWebhookEvent;
  } catch (err) {
    log("warn", "webhook.signature_failed", { error: String(err) });
    return text("signature verification failed", { status: 401 });
  }

  // Anthropic delivers webhooks in a Standard Webhooks envelope:
  //   { type: "event", id, created_at, data: { type, id, organization_id, workspace_id } }
  // The session-specific event type lives at event.data.type, and the
  // session id is event.data.id (not data.session_id).
  const ev = event as { type: string; data: { type: string; id: string } };
  const sessionType = ev.data?.type;
  const sessionId = ev.data?.id;

  if (sessionType !== "session.status_run_started") {
    log("info", "webhook.ignored", { type: sessionType });
    return json({ status: "ignored", type: sessionType });
  }

  if (!sessionId) {
    log("warn", "webhook.no_session_id");
    return json({ status: "missing_session_id" });
  }
  ctx.waitUntil(runSession(env, sessionId).catch((err) => {
    log("error", "session.runtime_error", { sessionId, error: String(err) });
  }));

  return json({ status: "accepted", session_id: sessionId });
}
