#!/usr/bin/env bash
# One-shot bootstrap: confirm wrangler login, then create KV namespaces.
# Secrets and deploy are separate steps - see README.md.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler not found. Install with: bun add -d wrangler" >&2
  exit 1
fi

echo "==> Checking wrangler auth"
wrangler whoami || {
  echo "Not logged in. Run: wrangler login" >&2
  exit 1
}

echo
echo "==> Creating KV namespaces"
node scripts/ensure-kv.mjs

echo
echo "Next steps:"
echo "  1. Paste the kv_namespaces ids into wrangler.jsonc"
echo "  2. Create a self-hosted environment in the Anthropic console; generate an environment key"
echo "  3. wrangler secret put ANTHROPIC_ENVIRONMENT_ID"
echo "  4. wrangler secret put ANTHROPIC_ENVIRONMENT_KEY"
echo "  5. wrangler secret put ANTHROPIC_WEBHOOK_SIGNING_KEY"
echo "  6. wrangler deploy"
echo "  7. In the Anthropic console, add https://<your-worker>.workers.dev/webhooks to webhook subscriptions"
