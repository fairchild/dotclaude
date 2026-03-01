# Memory Schema

Runtime root:
- `~/.ai-memory`

## Block Files

Core blocks in `~/.ai-memory/blocks/`:
- `user-profile.md`
- `preferences.md`
- `decisions.md`
- `active-threads.md`
- `relationships.md`
- `projects/<project-key>.md`

Block format:
- markdown
- append-only bullet entries preferred
- timestamp prefix recommended

Example entry:
```markdown
- [2026-02-13] Prefer Bun for TS scripts (confidence: confirmed)
```

## Event Log

File:
- `~/.ai-memory/events/memory-events.jsonl`

Each line is one JSON object:
```json
{
  "id": "evt_20260213_abc123",
  "timestamp": "2026-02-13T01:23:45.678Z",
  "type": "decision",
  "content": "Use Option A (launcher + hooks) for persona-memory v1",
  "confidence": "confirmed",
  "source": "session",
  "project_key": "dotclaude",
  "status": "candidate",
  "processed_at": null
}
```

## Index File

File:
- `~/.ai-memory/index/memory-index.json`

Purpose:
- lightweight metadata
- bootstrap/versioning info
- future compatibility checks

Suggested shape:
```json
{
  "version": 1,
  "created_at": "2026-02-13T01:00:00.000Z",
  "updated_at": "2026-02-13T01:23:45.678Z"
}
```

## Runtime Session Snapshots

Path:
- `~/.ai-memory/runtime/session-start/`

Purpose:
- store generated startup context summaries for debugging/auditing
