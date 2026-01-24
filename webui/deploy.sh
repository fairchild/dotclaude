#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Generating data.json..."
bun scan.ts --skip-validation

echo "Deploying to Cloudflare Workers..."
bunx wrangler deploy

echo "Done!"
