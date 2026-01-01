---
name: chronicle
description: Capture the current session as a memory block. Use when you want to save what you're working on, note pending tasks, or create a record of the session for future reference.
---

# Chronicle

A persistent journalist tracking your coding sessions.

## Usage

```
/chronicle                    # Write a memory block for current session
/chronicle pending            # Show pending threads (TODO)
/chronicle <note>             # Add a note to current session's block
```

## What This Does

When invoked, Chronicle captures the current session state as a memory block:
- What you're working on
- Key actions taken
- Any pending threads (unfinished work)

Blocks are stored in `~/.claude/chronicle/blocks/` and persist across sessions.

## Instructions

When the user runs /chronicle:

1. **Gather context** from the current conversation:
   - Project name (from working directory)
   - Git branch (if in a repo)
   - What the user asked for (primary request)
   - What's been accomplished so far
   - Any unfinished work or open questions

2. **Write a memory block** to `~/.claude/chronicle/blocks/{date}-{session-id}.json`:

```json
{
  "timestamp": "ISO date",
  "sessionId": "from context or generate",
  "project": "project name",
  "branch": "git branch",
  "summary": "1-2 sentence summary of session",
  "accomplished": ["list", "of", "key", "actions"],
  "pending": ["unfinished", "work"],
  "notes": "any user-provided notes"
}
```

3. **Report back** with a brief confirmation showing what was captured.

If the user provides a note (e.g., `/chronicle need to add tests`), include it in the block.

## Future Evolution

This is a minimal MVP. Future versions will add:
- `/chronicle pending` - show all pending threads across sessions
- `/chronicle catch-up` - summarize recent sessions
- `/chronicle find <query>` - search past sessions
- Automatic capture via Stop hook
- Vector search for semantic queries
