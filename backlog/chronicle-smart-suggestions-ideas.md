---
status: pending
category: ideas
pr: null
branch: null
score: null
retro_summary: null
completed: null
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

## Ideas to Explore

### 1. Session-Start Hook

Add a hook that runs when Claude Code starts a new session:

```bash
# ~/.claude/hooks/session-start.sh
if [ -f ~/.claude/skills/chronicle/scripts/auto-brief.ts ]; then
  bun ~/.claude/skills/chronicle/scripts/auto-brief.ts "$PWD"
fi
```

Conditions to trigger briefing:
- Time since last session in this project > 24h
- Project has pending items
- User hasn't dismissed briefings recently

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

## Questions to Answer

1. How intrusive should suggestions be? Toast notification vs inline?
2. Should suggestions be in Claude's system prompt or presented to user directly?
3. How to handle dismissals - per-session or persistent preference?
4. Performance: Can we query Chronicle fast enough for inline suggestions?

## Prototype Approach

Start minimal:
1. Session-start hook that runs catchup silently
2. If interesting context found, append to session's system prompt
3. Let Claude naturally incorporate context in responses

## References

- `skills/chronicle/ROADMAP.md` - Phase 3 description
- `hooks/` directory for hook patterns
- `scripts/catchup.ts` - Existing context aggregation
