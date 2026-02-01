---
status: done
category: ideas
pr: null
branch: main
score: 4
retro_summary: Simple slug-based threads proved sufficient - no separate threads.jsonl needed
completed: 2026-01-31
---

# Chronicle Thread Identity

## Problem Statement

Currently, pending items are flat strings that repeat across sessions. There's no concept of a "thread of work" that spans multiple sessions. The same task showing up in 5 sessions looks like 5 separate items, not one persistent thread.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Thread identity | Simple slug strings | Simpler than hash, human-readable |
| Storage | pendingThreads map in blocks | No separate file, backward compatible |
| Detection | Haiku detects task decomposition | Auto-groups sub-tasks from larger goals |

## Implementation (Completed)

### Added to ChronicleBlock
```typescript
pendingThreads?: Record<string, string>;  // pending text → thread slug
```

### Thread Detection
- Haiku prompt extended to detect task decomposition
- Returns `threadGroup` with slug and items when 2+ related pending items
- Slugs are kebab-case, max 30 chars (e.g., "build-auth-system")

### Display
- `/chronicle catchup` shows `[thread-slug]` prefix on grouped items
- Items with same thread sorted together

### Lifecycle
- Threads created during extraction when sub-tasks detected
- Thread inherited across sessions via `getThreadForPending()` lookup
- Thread preserved in Resolution when items are resolved

## Future Enhancements

- Thread timeline view (see original ideas above)
- Cross-project thread linking (Phase 4)
- Thread splitting/merging UI
