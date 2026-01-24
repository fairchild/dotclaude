#!/bin/bash
# Run all Chronicle dashboard tests
# Usage: ./skills/chronicle/tests/run_tests.sh

set -e

cd "$(dirname "$0")/../../.."

# Kill any existing process on port 3456 to avoid stale server issues
lsof -ti:3456 | xargs kill -9 2>/dev/null || true
sleep 1

echo "Starting Chronicle dashboard tests..."
echo ""

python3 ~/.claude/skills/webapp-testing/scripts/with_server.py \
  --server "bun skills/chronicle/scripts/dashboard.ts" \
  --port 3456 \
  -- bash -c "./skills/chronicle/tests/flows.py && ./skills/chronicle/tests/edge_cases.py"
