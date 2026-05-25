/**
 * Cloudflare Worker Env shape. Mirrors wrangler.jsonc bindings and secrets.
 *
 * Bindings populate at runtime from wrangler.jsonc. Secrets populate from
 * `wrangler secret put <NAME>` (production) or .dev.vars (local dev).
 */
export interface Env {
  // Secrets
  ANTHROPIC_ENVIRONMENT_ID: string;
  ANTHROPIC_ENVIRONMENT_KEY: string;
  ANTHROPIC_WEBHOOK_SIGNING_KEY: string;

  // Vars (defaults in wrangler.jsonc)
  ANTHROPIC_API_BASE: string;
  ANTHROPIC_BETA_HEADER: string;
  EMAIL_DOMAIN: string;

  // KV namespaces
  SECRETS: KVNamespace;
  EGRESS_POLICIES: KVNamespace;
  AGENT_INBOX: KVNamespace;

  // ISOLATE_LOADER: WorkerLoader — added in V1.1 alongside the runner body.
}
