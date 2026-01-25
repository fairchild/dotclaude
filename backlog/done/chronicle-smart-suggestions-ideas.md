---
status: done
category: ideas
pr: 63
branch: chronicle-phase3-exploration
score: 4
retro_summary: Clean implementation; shared context module improves code reuse across Chronicle scripts.
completed: 2026-01-24
---

# Chronicle Smart Suggestions

## Problem Statement

Users must explicitly ask Chronicle for context with `/catchup`. Ideally, relevant context would surface automatically when returning to a project or working on something related to past sessions.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger mechanism | Session-start hook | Natural integration point, user is already in context |
| Default behavior | Opt-in initially | Avoid surprising users with new behavior |
| Matching approach | Start with keyword, evolve to semantic | Ship simple first |

## Implementation (Completed)

### SessionStart Hook

Created `skills/chronicle/scripts/session-start.ts`:
- Reads hook input from stdin (session_id, cwd)
- Uses shared `context.ts` for project detection
- Queries Chronicle blocks and pending items
- Outputs `{}` if no data, or formatted context via `additionalContext`

Output format:
```
📋 Chronicle: {project}
Last session ({N} days ago): {summary}
Pending: {item1}; {item2}; {item3}
⚠️ {N} stale items (>14 days)
```

### Shared Context Module

Extracted `context.ts` from catchup.ts for reuse:
- `detectContext(cwd)` - detects project, worktree, branch
- Handles worktree spaces (Conductor, ~/.worktrees)
- Falls back to git remote or directory name

### Hook Registration

Added to `settings.json`:
```json
"SessionStart": [{
  "hooks": [{
    "type": "command",
    "command": "bun ~/.claude/skills/chronicle/scripts/session-start.ts"
  }]
}]
```

## Future Ideas (Not Implemented)

### 2. "You Worked On This" Detection

When user opens or edits a file that was touched in a recent session:

```
💡 You worked on dashboard.ts 3 days ago:
   • Added repo-level views
   • Left pending: Add E2E tests
```

Implementation: Hook into file read/edit tools, query Chronicle for matching files.

### 3. Error Context Recall

When user encounters an error similar to past debugging:

```
💡 Similar error in session 2 weeks ago:
   "TypeError: Cannot read property 'map' of undefined"
   Solution: Added null check in data fetching
```

Implementation: Pattern match error messages against past accomplished/summary text.

### 4. Semantic Similarity (Future)

Use embeddings to find semantically related sessions:

- "Working on auth" matches "Implementing OAuth flow"
- "Fix tests" matches "Test coverage improvements"

Requires embedding model integration (OpenAI text-embedding-3-small or similar).

## References

- `skills/chronicle/ROADMAP.md` - Phase 3 description
- `hooks/` directory for hook patterns
- `scripts/catchup.ts` - Existing context aggregation
