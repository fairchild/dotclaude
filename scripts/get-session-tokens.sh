#!/bin/bash
# Extract token usage from session JSONL file

session_id="$1"

# Find the session file
session_file=$(find ~/.claude/projects -name "$session_id.jsonl" 2>/dev/null | head -n 1)

if [[ -z "$session_file" ]]; then
    echo "{}"
    exit 0
fi

# Parse the JSONL file to sum up token usage (CUMULATIVE across all API calls)
# Each line is a JSON object with .message.usage containing token info
# Per Anthropic docs: total_input = input_tokens + cache_creation + cache_read
# See: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
jq -s '
  map(select(.message.usage != null) | .message.usage) |
  {
    input_tokens: map(.input_tokens // 0) | add,
    output_tokens: map(.output_tokens // 0) | add,
    cache_creation_input_tokens: map(.cache_creation_input_tokens // 0) | add,
    cache_read_input_tokens: map(.cache_read_input_tokens // 0) | add
  } |
  .total_tokens = ((.input_tokens // 0) + (.output_tokens // 0)) |
  .total_input = ((.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0))
' "$session_file" 2>/dev/null || echo "{}"
