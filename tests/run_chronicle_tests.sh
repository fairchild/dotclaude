#!/bin/bash
# Run all Chronicle dashboard tests
# Usage: ./tests/run_chronicle_tests.sh

set -e

cd "$(dirname "$0")/.."

echo "Starting Chronicle dashboard tests..."
echo ""

python3 ~/.claude/skills/webapp-testing/scripts/with_server.py \
  --server "bun skills/chronicle/scripts/dashboard.ts" \
  --port 3456 \
  -- bash -c "uv run python tests/chronicle_flows.py && uv run python tests/chronicle_edge_cases.py"
