#!/usr/bin/env bash
# Prompt silently for the three env-scoped values and push each as a wrangler
# secret. The values are read with `read -s` (no terminal echo) and piped to
# `wrangler secret put` over stdin - they never appear on a command line, in
# shell history, or in any logged output. Run this in your own terminal; the
# values stay local to your shell and Cloudflare's secret store.
#
# Usage:
#   ./scripts/secrets-put.sh                    # uses wrangler.local.jsonc
#   WRANGLER_CONFIG=other.jsonc ./scripts/secrets-put.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG="${WRANGLER_CONFIG:-wrangler.local.jsonc}"
if [[ ! -f "$CONFIG" ]]; then
  echo "config file not found: $CONFIG" >&2
  echo "expected wrangler.local.jsonc with account_id + KV ids (gitignored)" >&2
  exit 1
fi

put_secret() {
  local name="$1"
  local prompt="$2"
  local hidden="${3:-1}"

  local value
  if [[ "$hidden" == "1" ]]; then
    read -r -s -p "  $prompt " value
    echo
  else
    read -r -p "  $prompt " value
  fi
  if [[ -z "${value:-}" ]]; then
    echo "  (empty) skipping $name"
    return
  fi
  printf '%s' "$value" | bunx wrangler secret put "$name" --config "$CONFIG"
  unset value
}

echo "Setting wrangler secrets via $CONFIG"
echo "Values are read silently and piped over stdin. Nothing logs."
echo

# env id is not secret, but using the same pipe keeps the flow uniform
put_secret ANTHROPIC_ENVIRONMENT_ID         "environment id (env_…): " 0
put_secret ANTHROPIC_ENVIRONMENT_KEY        "environment key (sk-ant-oat01-…): " 1
put_secret ANTHROPIC_WEBHOOK_SIGNING_KEY    "webhook signing key (whsec_…): " 1

echo
echo "Done. Verify:"
echo "  bunx wrangler secret list --config $CONFIG"
