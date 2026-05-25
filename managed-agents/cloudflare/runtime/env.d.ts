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

  // Worker Loader for per-session isolates. The exact type ships with newer
  // workers-types; cast to `unknown` callers as needed if the type is missing.
  ISOLATE_LOADER: WorkerLoader;
}

/**
 * Minimal Worker Loader shape we depend on. The real binding exposes more,
 * but typing only what we use keeps this file readable.
 */
export interface WorkerLoader {
  get(id: string, options: WorkerLoaderGetOptions): Fetcher;
}

export interface WorkerLoaderGetOptions {
  /** Source modules for the loaded worker. */
  modules: Record<string, string>;
  /** Optional bindings to pass to the loaded worker. */
  env?: Record<string, unknown>;
}
