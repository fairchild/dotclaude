---
name: status-line-live
description: Customize or troubleshoot the live status line. Use when modifying statusline.sh, debugging token display, or understanding the rendering pipeline. The status line runs passively -- this skill is for working on it, not using it.
license: Apache-2.0
---

# status-line-live

Custom status line renderer adding live session data to Claude Code:
token metrics, session titles, git state, and cost tracking.

Distinguished from the built-in `/status_line` command -- this is the
renderer and its supporting scripts.

## Components

| File | Role |
|------|------|
| `scripts/statusline.sh` | Main renderer (called by Claude Code via stdin JSON) |
| `scripts/get-session-tokens.sh` | Token data extraction from session JSONL |
| `docs/architecture.md` | Data flow, caching, troubleshooting |

## Output Format

```
project branch (3) Opus 4.6 $0.66 +28 -5 (70+210K+1.6M):7K [1:267] | session title
```

## Dependencies

`jq`, `bc`, `git`

## Related

- `/status_line` command -- verbose explainer with ASCII diagrams
- `session-titles/` -- runtime data (titles + token cache)
