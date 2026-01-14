#!/bin/bash
# Run all Chronicle dashboard tests
# Usage: ./skills/chronicle/tests/run.sh

set -e

cd "$(dirname "$0")/../../.."

echo "Starting Chronicle dashboard tests..."
echo ""

python3 ~/.claude/skills/webapp-testing/scripts/with_server.py \
  --server "bun skills/chronicle/scripts/dashboard.ts" \
  --port 3456 \
  -- bash -c "uv run python skills/chronicle/tests/flows.py && uv run python skills/chronicle/tests/edge_cases.py"
