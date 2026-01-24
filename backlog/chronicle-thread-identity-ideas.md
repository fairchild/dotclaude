---
status: pending
category: ideas
pr: null
branch: null
score: null
retro_summary: null
completed: null
---

# Chronicle Thread Identity

## Problem Statement

Currently, pending items are flat strings that repeat across sessions. There's no concept of a "thread of work" that spans multiple sessions. The same task showing up in 5 sessions looks like 5 separate items, not one persistent thread.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Thread identity | Hash of normalized text | Simple, deterministic |
| Storage | Separate threads.jsonl | Don't bloat individual blocks |
| Linking | Reference in blocks | Blocks stay light, threads aggregate |

## Proposed Data Model

### Thread Schema

```typescript
interface Thread {
  id: string;              // hash of normalized text
  canonicalText: string;   // Original text (first occurrence)
  normalizedText: string;  // Lowercased, trimmed for matching
  project: string;
  firstSeen: string;       // ISO timestamp
  lastSeen: string;        // ISO timestamp
  sessions: string[];      // Session IDs where this appeared
  status: "active" | "resolved" | "stale";
  resolvedAt?: string;
  resolvedBy?: "accomplished" | "commit" | "explicit";
}
```

### Updated Block Schema

```typescript
interface ChronicleBlock {
  // ... existing fields
  
  // New field linking to threads
  threads?: {
    continued: string[];   // Thread IDs we worked on
    started: string[];     // Thread IDs we created
    resolved: string[];    // Thread IDs we completed
  };
}
```

## Benefits

1. **Continuity**: See the full history of a piece of work across sessions
2. **Deduplication**: One thread, many sessions, clear ownership
3. **Lifecycle**: Track when work started, progressed, and finished
4. **Metrics**: "Average thread lifetime", "threads per project"

## Ideas to Explore

### Thread Timeline View

```
Thread: "Add E2E tests for dashboard"
├── Jan 15 (session abc): Started - identified need for tests
├── Jan 17 (session def): Progress - wrote first 2 tests
├── Jan 19 (session ghi): Progress - added coverage for API
└── Jan 21 (session jkl): Resolved - all tests passing
```

### Thread Recommendations

```
📋 Active threads in dotclaude (3):
1. "Add E2E tests" - 4 sessions, started 6 days ago
2. "Document dashboard setup" - 2 sessions, started 3 days ago
3. "Refactor query utilities" - 1 session, started today

Pick one to continue: /chronicle continue 1
```

### Cross-Session Context

When continuing a thread, surface all prior context:
- Previous approaches tried
- Blockers encountered
- Related files modified

## Implementation Approach

1. **Phase A**: Extract threads from existing blocks (backfill)
2. **Phase B**: Link new blocks to threads on extraction
3. **Phase C**: Add thread-aware queries and UI
4. **Phase D**: Thread lifecycle commands (/resolve, /continue)

## Questions to Answer

1. How fuzzy should text matching be for thread identity?
2. Should threads be project-scoped or global?
3. How to handle thread splits (one task becomes two)?
4. Storage: JSON file vs SQLite for thread queries?

## References

- `skills/chronicle/ROADMAP.md` - Cross-project intelligence phase
- `skills/chronicle/docs/chronicle-design.md` - Original thread concept
- `scripts/queries.ts` - Current pending item queries
