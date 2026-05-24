---
status: pending
category: followup
thread: null
pr: null
branch: null
score: null
retro_summary: null
completed: null
---

# Token JSONL Parsing Memory Pressure for Long Sessions

## Problem

`get-session-tokens.sh` uses `jq -s` (slurp mode) to parse session JSONL files. This reads the entire file into memory as a single JSON array before processing.

For long sessions, JSONL files can grow to tens of megabytes. `jq -s` on a 50MB file allocates significantly more memory than the file size due to JSON object overhead. This runs on every cache refresh (every 1 minute during active sessions).

## Impact

- Potential lag spike on status line render for very long sessions
- Memory pressure on machines with constrained RAM
- Background job may take noticeably long, meaning stale cache data persists longer

## Proposed Fix

Replace `jq -s 'map(...) | add'` with a streaming `jq` reduce or `awk`-based approach that processes line by line:

```bash
# Streaming approach — O(1) memory regardless of file size
jq -r 'select(.message.usage != null) | .message.usage |
  [.input_tokens // 0, .output_tokens // 0,
   .cache_creation_input_tokens // 0, .cache_read_input_tokens // 0]
  | @tsv' "$session_file" \
| awk -F'\t' '{i+=$1; o+=$2; cw+=$3; cr+=$4}
  END {printf "{\"input_tokens\":%d,\"output_tokens\":%d,\"cache_creation_input_tokens\":%d,\"cache_read_input_tokens\":%d,\"total_tokens\":%d,\"total_input\":%d}\n", i, o, cw, cr, i+o, i+cw+cr}'
```

## When to Address

Not urgent — only matters for very long sessions (hundreds of turns). Worth doing if users report status line lag or if session JSONL files regularly exceed ~20MB.

## References

- `~/.claude/skills/status-line-live/scripts/get-session-tokens.sh` — file to modify
- Discovered during review of PR adding token cache enrichment
