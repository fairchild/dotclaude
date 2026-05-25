/**
 * Per-session work claim loop.
 *
 * On `session.status_run_started`, the webhook handler kicks this off. We
 * poll the queue (briefly) to find OUR session's work item, then drive the
 * isolate to completion, sending tool results back via the Anthropic client.
 *
 * Keepalives run on a 15s timer; the actual session can run much longer.
 * When the isolate signals completion we stop the work item.
 *
 * If we lose the work item (eviction, network error), we leave it for another
 * worker to reclaim - the queue has reclaim semantics built in.
 */
import { AnthropicClient, type WorkItem } from "./anthropic.ts";
import type { Env } from "./env.d.ts";
import { runIsolate } from "./isolate/runner.ts";
import { log, sleep } from "./helpers.ts";

const KEEPALIVE_INTERVAL_MS = 15_000;
const POLL_ATTEMPTS = 3;
const POLL_BLOCK_MS = 500;

export async function runSession(env: Env, sessionId: string): Promise<void> {
  const client = new AnthropicClient(env);

  const work = await claimWorkForSession(client, sessionId);
  if (!work) {
    log("warn", "session.no_work_found", { sessionId });
    return;
  }

  log("info", "session.claimed", { sessionId, workId: work.id });
  const keepalive = startKeepalive(client, work.id);

  try {
    await runIsolate({ env, work, client });
    log("info", "session.completed", { sessionId, workId: work.id });
  } catch (err) {
    log("error", "session.failed", { sessionId, workId: work.id, error: String(err) });
    throw err;
  } finally {
    clearInterval(keepalive);
    await client.stop(work.id).catch((err) => {
      log("warn", "session.stop_failed", { workId: work.id, error: String(err) });
    });
  }
}

async function claimWorkForSession(client: AnthropicClient, sessionId: string): Promise<WorkItem | null> {
  // The webhook fires when a session starts; a work item is enqueued at the
  // same moment. Poll briefly - if it's not there yet (queue races), back off
  // and retry a couple of times.
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const work = await client.pollWork({ blockMs: POLL_BLOCK_MS });
    if (work?.data.id === sessionId) return work;
    if (work) {
      // Claimed work for a different session - leave it for another worker.
      // We don't have an explicit "release" call; the lease will expire and
      // get reclaimed. In a high-volume deployment this approach needs work.
      log("info", "session.skip_other", { wantSession: sessionId, gotSession: work.data.id });
    }
    await sleep(200 * (attempt + 1));
  }
  return null;
}

function startKeepalive(client: AnthropicClient, workId: string): ReturnType<typeof setInterval> {
  return setInterval(() => {
    client.keepalive(workId).catch((err) => {
      log("warn", "keepalive.failed", { workId, error: String(err) });
    });
  }, KEEPALIVE_INTERVAL_MS);
}
