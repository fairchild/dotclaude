/**
 * Shared utilities. Stay small - large helpers belong in their own module.
 */

export const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });

export const text = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, {
    ...init,
    headers: { "content-type": "text/plain", ...(init.headers ?? {}) },
  });

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Log helper - emits structured JSON so Cloudflare Logs ingest it cleanly.
 */
export const log = (level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields }));
};
