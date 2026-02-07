---
status: done
category: plan
thread: ai-coding-usage
pr: 76
branch: feat/ai-coding-usage-incremental
score: 4
retro_summary: Clean implementation; /reflect caught upgrade path bug and excessive backup before merge
completed: 2026-02-07
---

# ai-coding-usage: Incremental Loading + New Record Types

## Problem Statement

The ai-coding-usage script (v1.1.0) can only skip loading entirely or do a full reload of all ~2,652 JSONL files. There's no way to pick up new sessions without rebuilding everything. Additionally, several useful record types (`system`, `queue-operation`, `pr-link`) and `sessions-index.json` metadata are not imported at all.

## Detailed Plan

**Full plan file:** `~/.claude/plans/foamy-wondering-hamster.md`

The plan was developed with thorough exploration of Claude Code's session data structure:

- `~/.claude/projects/{project-hash}/{session-uuid}.jsonl` — main sessions (1,108 files)
- `~/.claude/projects/{project-hash}/agent-{hash}.jsonl` — subagent transcripts (1,544 files)
- `~/.claude/projects/{project-hash}/sessions-index.json` — session metadata (40 project dirs, 158 entries)
- Data range: 2025-12-29 to 2026-02-07

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Change detection | File stat mtime | `sessions-index.json` only covers 40/253 projects; stat works for all files including agents |
| Incremental delete strategy | `source_file` column + DELETE by file | Agent files share parent `session_id`, so file-level tracking avoids cross-contamination |
| DB backup | Always before load/reload | Timestamped `.bak` copy, no silent data loss |
| Skip `progress` records | Yes (20,818 records) | Streaming events, low analytical value |
| Skip `file-history-snapshot` | Yes (1,878 records) | File backup tracking, low analytical value |

## Implementation Summary

### New tables
- `system_events` — system records (turn_duration, api_error, stop_hook_summary, etc.)
- `queue_operations` — queued user inputs typed during assistant responses
- `pr_links` — session-to-PR mappings
- `_sessions_index` — session metadata from sessions-index.json (firstPrompt, summary, messageCount)
- `_loaded_files` — file mtime tracking for incremental loading

### New columns
- `source_file` on `claude_tools` and `messages` — enables file-level delete/reinsert

### New functions
- `backup_db()` — timestamped backup before any load
- `find_changed_files()` — compare file mtimes against `_loaded_files`
- `incremental_load()` — delete stale rows by source_file, insert from changed files only
- `load_system_events()`, `load_queue_operations()`, `load_pr_links()`, `load_sessions_index()`

### New views
- `turn_durations` — response timing from system events
- `api_errors` — API error events
- `session_overview` — sessions joined with index metadata (summary, first_prompt)

### Updated behavior
- Default command: auto-detects new files and runs incremental load
- `update` command: explicit incremental load
- `reload` command: unchanged (full drop + rebuild)
- Version bump to 1.2.0

## Files to Modify

- `skills/ai-coding-usage/scripts/ai-coding-usage` — main script (all loading functions, views, commands)
- `skills/ai-coding-usage/README.md` — new tables, views, commands
- `skills/ai-coding-usage/SKILL.md` — same

## Verification Commands

```bash
# Fresh full load with new schema
ai-coding-usage reload

# Verify all tables populated
ai-coding-usage query "SELECT 'claude_tools' as t, COUNT(*) FROM claude_tools
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'system_events', COUNT(*) FROM system_events
UNION ALL SELECT 'queue_operations', COUNT(*) FROM queue_operations
UNION ALL SELECT 'pr_links', COUNT(*) FROM pr_links
UNION ALL SELECT '_sessions_index', COUNT(*) FROM _sessions_index
UNION ALL SELECT '_loaded_files', COUNT(*) FROM _loaded_files"

# Default should auto-detect and incrementally update
ai-coding-usage

# Query new data
ai-coding-usage query "SELECT * FROM turn_durations ORDER BY duration_ms DESC LIMIT 5"
ai-coding-usage query "SELECT session_id, summary FROM _sessions_index LIMIT 5"
```

## References

- Plan file: `~/.claude/plans/foamy-wondering-hamster.md`
- Current script: `skills/ai-coding-usage/scripts/ai-coding-usage` (v1.1.0)
- PR #74 merged the v1.1.0 search feature this session
- Claude Code JSONL structure explored in detail (record types, agent files, sessions-index)
