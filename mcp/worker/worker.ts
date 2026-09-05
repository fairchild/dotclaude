import { handleRequest, serve, type Env as BaseEnv, type Served } from "./handler.ts";

interface Env extends BaseEnv {
  METRICS?: { writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void };
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }

/**
 * Product-level event: one `skill_used` per skill-scoped request, alongside
 * the Analytics Engine firehose. Fire-and-forget via waitUntil so ingestion
 * latency never touches the response.
 */
function emitPosthog(env: Env, ctx: ExecutionContext | undefined, request: Request, served: Served, latencyMs: number): void {
  if (!env.POSTHOG_API_KEY || !served.skill) return;
  const cf = (request as { cf?: { country?: string; colo?: string } }).cf;
  const label = (request.headers.get("x-skills-client") ?? "").slice(0, 32);
  const send = fetch(`${env.POSTHOG_HOST ?? "https://us.i.posthog.com"}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.POSTHOG_API_KEY,
      event: "skill_used",
      distinct_id: label || "public",
      properties: {
        skill: served.skill,
        method: served.method,
        outcome: served.outcome,
        client_label: label,
        user_agent: (request.headers.get("user-agent") ?? "").slice(0, 96),
        country: cf?.country ?? "",
        colo: cf?.colo ?? "",
        latency_ms: latencyMs,
        response_bytes: served.responseBytes,
        transport: "hosted-worker",
      },
    }),
  }).catch(() => {});
  ctx ? ctx.waitUntil(send) : void send;
}

function record(env: Env, request: Request, served: Served, latencyMs: number): void {
  try {
    const cf = (request as { cf?: { country?: string; colo?: string } }).cf;
    env.METRICS?.writeDataPoint({
      blobs: [
        served.method.slice(0, 64),
        served.skill.slice(0, 64),
        served.outcome.slice(0, 32),
        (request.headers.get("x-skills-client") ?? "").slice(0, 32),
        (request.headers.get("user-agent") ?? "").slice(0, 96),
        cf?.country ?? "",
        cf?.colo ?? "",
      ],
      doubles: [latencyMs, served.responseBytes],
      indexes: [served.method.slice(0, 64)],
    });
  } catch {
    // metrics must never take a request down with them
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") {
      return handleRequest(request, env);
    }
    const started = Date.now();
    const served = await serve(request, env);
    const latencyMs = Date.now() - started;
    record(env, request, served, latencyMs);
    emitPosthog(env, ctx, request, served, latencyMs);
    return served.response;
  },
};
