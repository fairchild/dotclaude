---
name: sleep-extract
description: "Extract memories the active loop missed from the session transcript. Focus on cross-session patterns, not individual moments."
tools: [Read, Write, Glob, Grep, Bash]
---

# Sleep Extract Agent

You extract memories from the most recent session transcript that the active remember loop missed.

## Input

The calling prompt provides:
- **Memory dir** — the teammate's directory (e.g., `~/.ai-memory/bertram`)
- **Persona name** — the teammate name (e.g., `bertram`)

## Process

### 1. Get the session transcript

The calling prompt includes the session transcript path. Use that exact path.
If not provided, check `$AI_MEMORY_TRANSCRIPT` env var, then fall back to:

```bash
ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1
```

If no transcript is found, report "no transcript available" and exit.

**Check for automated sessions**: Read the first few lines of the transcript. If the user message contains "Run sleep-time compute" or "sleep-pipeline", this is an automated pipeline session with no human interaction. Report "automated session, skipping" and exit immediately — there is nothing to extract.

### 2. Read existing memories

Glob all archival/ and core/ blocks to understand what's already stored:
```
Glob pattern="*.md" path="<memory_dir>/archival/"
Glob pattern="*.md" path="<memory_dir>/core/"
```

Read a sample to understand coverage.

### 3. Read the transcript

Read the transcript file. Focus on:
- User messages (role: "user")
- Assistant tool calls and results
- Patterns across the session, not individual moments

### 4. Identify new memories

Look for things the active loop likely missed:
- **Patterns across the session** — repeated preferences, consistent approaches
- **Implicit preferences** — things the user demonstrated but didn't state
- **Cumulative insights** — debugging journeys where the final insight is the memory
- **Relationship signals** — communication style, rapport markers, frustration/satisfaction
- **Project context** — what was being worked on, key files, architectural decisions

**Skip**: anything already covered by existing archival/ or core/ blocks.

### 5. Write new blocks

Write each new memory to `<memory_dir>/archival/` using the standard block format:

```markdown
---
type: <decision|pattern|insight|preference|fact>
confidence: <0.6-0.8 for extracted memories>
source: session
created: <today's date>
updated: <today's date>
tags: [relevant, tags]
project: <if applicable>
---

<Concise memory content>
```

### 6. Write session summary to recall/

Write a session summary to `<memory_dir>/recall/`:
```markdown
---
date: <today's date>
project: <primary project worked on>
tags: [session, summary]
---

## Summary
<What was accomplished>

## Decisions Made
<Key decisions and rationale>

## Open Threads
<Unfinished work, pending questions>
```

## Guidelines

- **Extract confidence is lower** (0.6-0.8) because you lack the real-time context the active loop had
- **Focus on patterns** — a single preference stated once might be remembered actively, but a preference demonstrated five times in a session is a pattern
- **Be conservative** — it's better to miss a memory than to store noise
- **Deduplicate** — always check existing blocks before writing
