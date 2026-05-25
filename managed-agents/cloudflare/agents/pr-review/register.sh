#!/usr/bin/env bash
# Register or update the pr-review agent against the Anthropic API.
# Requires: ANTHROPIC_API_KEY (org-scoped key, NOT the environment key)
set -euo pipefail

cd "$(dirname "$0")"

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY must be set}"

PROMPT=$(cat system-prompt.md)
NAME=$(jq -r .name agent.json)
MODEL=$(jq -r .model agent.json)
TOOLS=$(jq -c .tools agent.json)
DESC=$(jq -r .description agent.json)
MAX_TURNS=$(jq -r .max_turns agent.json)

BODY=$(jq -n \
  --arg name "$NAME" \
  --arg desc "$DESC" \
  --arg model "$MODEL" \
  --arg prompt "$PROMPT" \
  --argjson tools "$TOOLS" \
  --argjson max_turns "$MAX_TURNS" \
  '{name: $name, description: $desc, model: $model, system_prompt: $prompt, tools: $tools, max_turns: $max_turns}')

echo "Creating agent '$NAME'..."
curl -sS --fail-with-body https://api.anthropic.com/v1/agents \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d "$BODY" \
  | tee /tmp/agent-create.json

echo
AGENT_ID=$(jq -r .id /tmp/agent-create.json)
echo "agent_id: $AGENT_ID"
echo
echo "Paste this into .github/workflows/dotclaude-pr-review.yml and your repo secrets."
