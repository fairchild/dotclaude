/**
 * Per-session work claim loop.
 *
 * On `session.status_run_started`, the webhook handler kicks this off. We
 * try to find our session's work item, hand it to the isolate runner, and
 * release on completion.
 *
 * V1 STATUS: the runner is a scaffold (see isolate/runner.ts), so this
 * effectively claims and immediately stops. The keepalive timer is wired
 * but doesn't have meaningful work to keep alive yet.
 *
 * Two structural issues to resolve when wiring the real loop:
 *
 *   1. A poll-after-webhook design can return work for a different session
 *      than the one whose webhook just fired. We have no way to release a
 *      mis-claimed item back to the queue without holding it. The fix is
 *      likely a session-targeted claim endpoint exposed by the SDK; until
 *      that lands the workaround drops mis-claims and retries.
 *
 *   2. setInterval inside a Worker invocation only runs while the request
 *      context is alive. Long sessions need either Durable Objects or a
 *      different keepalive trigger (e.g. cron + KV).
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
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const work = await client.pollWork({ blockMs: POLL_BLOCK_MS });
    if (work?.data.id === sessionId) return work;
    if (work) {
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
