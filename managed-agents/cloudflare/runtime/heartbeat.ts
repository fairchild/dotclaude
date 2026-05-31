/**
 * Per-session work claim loop. Wired against the verified Anthropic Work API
 * shape (see anthropic.ts for endpoint paths and method choices).
 *
 * Lifecycle:
 *   1. Webhook fires `session.status_run_started` (handled in webhooks.ts) -
 *      this is a wake-up signal, not a session-targeted dispatch
 *   2. GET /work/poll - returns the oldest queued work item (FIFO)
 *   3. POST /ack to claim it (transitions state: queued -> starting)
 *   4. Heartbeat every 15s to keep the lease
 *   5. Run the isolate (V1 scaffold returns immediately)
 *   6. POST /stop to release
 *
 * The webhook's session_id is informational - we may claim a different
 * session's work if multiple are queued. That matches how the SDK's
 * EnvironmentWorker behaves; the work queue itself is the source of truth
 * for what to process next.
 */
import { AnthropicClient } from "./anthropic.ts";
import type { Env } from "./env.d.ts";
import { runIsolate } from "./isolate/runner.ts";
import { log } from "./helpers.ts";

const KEEPALIVE_INTERVAL_MS = 15_000;

export async function runSession(env: Env, wakeupSessionId: string): Promise<void> {
  const client = new AnthropicClient(env);

  const work = await client.pollWork();
  if (!work) {
    log("info", "session.queue_empty", { wakeupSessionId });
    return;
  }

  if (work.id !== wakeupSessionId) {
    log("info", "session.claim_other", { wakeupSessionId, claimed: work.id });
  }
  log("info", "session.claimed", { workId: work.id, state: work.state });

  // Transition queued -> starting; the API requires ack before heartbeats land.
  await client.ack(work.id);
  log("info", "session.acked", { workId: work.id });

  const keepalive = startKeepalive(client, work.id);

  try {
    await runIsolate({ env, work, client });
    log("info", "session.completed", { workId: work.id });
  } catch (err) {
    log("error", "session.failed", { workId: work.id, error: String(err) });
    throw err;
  } finally {
    clearInterval(keepalive);
    await client.stop(work.id).catch((err) => {
      log("warn", "session.stop_failed", { workId: work.id, error: String(err) });
    });
  }
}

function startKeepalive(client: AnthropicClient, workId: string): ReturnType<typeof setInterval> {
  return setInterval(() => {
    client.heartbeat(workId).catch((err) => {
      log("warn", "keepalive.failed", { workId, error: String(err) });
    });
  }, KEEPALIVE_INTERVAL_MS);
}
