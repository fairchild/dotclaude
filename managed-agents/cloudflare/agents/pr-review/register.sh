#!/usr/bin/env bash
# Thin wrapper around scripts/ops.ts so the historical README invocation
# (`./register.sh` from agents/pr-review/) keeps working. Equivalent to
# running `bun scripts/ops.ts agent register --dir agents/pr-review` from
# the cloudflare/ directory.
#
# Requires ANTHROPIC_API_KEY in ~/.env (or any path under OPS_ENV_FILE).
set -euo pipefail
cd "$(dirname "$0")/../.."
exec bun scripts/ops.ts agent register --dir agents/pr-review
