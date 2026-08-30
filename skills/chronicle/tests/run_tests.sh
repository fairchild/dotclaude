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

# Start the dashboard, wait for the port, run the suites, then clean up.
bun skills/chronicle/scripts/dashboard.ts &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

for _ in $(seq 60); do
  nc -z localhost 3456 2>/dev/null && break
  sleep 0.5
done

if ! nc -z localhost 3456 2>/dev/null; then
  echo "Dashboard failed to start on port 3456 within 30s" >&2
  exit 1
fi

./skills/chronicle/tests/flows.py && ./skills/chronicle/tests/edge_cases.py
