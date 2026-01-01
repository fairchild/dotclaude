---
name: chronicle
description: Capture and curate session memory blocks. Use /chronicle to save current work, /chronicle curate to have an intelligent curator organize your memory across sessions.
---

# Chronicle

A persistent journalist tracking your coding sessions.

## Usage

```
/chronicle                    # Quick capture of current session
/chronicle <note>             # Capture with a specific note
/chronicle curate             # Invoke curator to organize memory (interactive)
/chronicle pending            # Show pending threads across sessions
/chronicle blocks             # List recent memory blocks
```

## Quick Capture (/chronicle or /chronicle <note>)

Captures current session state as a memory block:
- Project and branch context
- What you're working on
- Key actions taken
- Pending work

Blocks stored in `~/.claude/chronicle/blocks/`.

### Instructions for Quick Capture

1. **Gather context**:
   - Project name (from working directory)
   - Git branch (if in a repo)
   - Primary request from conversation
   - Accomplishments so far
   - Unfinished work

2. **Write block** to `~/.claude/chronicle/blocks/{date}-{descriptive-name}.json`:

```json
{
  "timestamp": "ISO date",
  "project": "project name",
  "branch": "git branch",
  "summary": "1-2 sentence summary",
  "accomplished": ["list", "of", "completions"],
  "pending": ["unfinished", "work"],
  "notes": "user-provided notes"
}
```

3. **Confirm** with brief summary of what was captured.

---

## Curate Mode (/chronicle curate)

Invokes the **Chronicle Curator** agent for intelligent memory management.

### How to Use

When user runs `/chronicle curate`, prompt them for:

```
To curate this session, tell me:
• Goal: What are you trying to accomplish?
• Challenges: Any blockers or difficulties?
• Next Steps: What comes next?

(Or just describe the current situation in your own words)
```

### Then Invoke the Curator Agent

Use the Task tool to spawn the chronicle-curator agent:

```
Task(
  subagent_type: "chronicle-curator",
  prompt: "Curate session with context:
    Project: {project}
    Branch: {branch}
    Goal: {user's goal}
    Challenges: {user's challenges}
    Next Steps: {user's next steps}

    Review existing blocks in ~/.claude/chronicle/blocks/
    Update or create blocks as needed.
    Report what you changed."
)
```

The curator will:
1. Read all existing memory blocks
2. Find the most recent block
3. Analyze: continuation, new work, or resolution?
4. Update recent block with new context
5. Check if older blocks need updates (resolved threads, connections)
6. Report changes made

---

## Pending (/chronicle pending)

Show all pending work across sessions:

1. Read all blocks from `~/.claude/chronicle/blocks/`
2. Extract `pending` arrays from each
3. Group by project
4. Display with recency info

---

## Blocks (/chronicle blocks)

List recent memory blocks:

```bash
ls -lt ~/.claude/chronicle/blocks/ | head -10
```

Show filename, date, and first line of summary for each.

---

## Block Schema

```json
{
  "timestamp": "2026-01-01T00:30:00Z",
  "project": "dotclaude",
  "branch": "feat/chronicle",
  "summary": "Brief description of session focus",
  "goal": "What user is trying to accomplish",
  "accomplished": ["Completed item 1", "Completed item 2"],
  "pending": ["Still need to do X", "Blocked on Y"],
  "challenges": ["Current difficulty"],
  "nextSteps": ["Planned action 1", "Planned action 2"],
  "relatedSessions": ["2025-12-31-oauth-work.json"],
  "notes": "Additional context or observations"
}
```

Not all fields required - use what's relevant.

---

## Philosophy

Chronicle is about **learning as we go**:
- Start simple, evolve the structure
- Manual curation builds intuition for automation
- Memory blocks are living documents, not archives
- The curator is an editor, not a stenographer
