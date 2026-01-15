---
name: chronicle
description: Capture and curate session memory blocks. Use /chronicle to save current work, /chronicle curate to organize memory, /chronicle publish for digests, /chronicle ui for dashboard.
license: Apache 2.0
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
/chronicle publish            # Generate weekly digest (markdown)
/chronicle publish daily      # Generate daily digest
/chronicle publish month      # Generate monthly digest
/chronicle ui                 # Launch interactive web dashboard
/chronicle ui watch           # Run with auto-restart on file changes
/chronicle ui hot             # Run with hot module reloading
/chronicle ui install         # Install dashboard as macOS service
/chronicle ui start           # Start the dashboard service
/chronicle ui stop            # Stop the dashboard service
/chronicle ui status          # Check if dashboard service is running
/chronicle ui logs            # View dashboard service logs
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

When user runs `/chronicle curate`:

1. **Analyze the conversation** to infer goal, challenges, and next steps
2. **Propose** your observations for confirmation:

```
Based on this session, here's what I observed:

• Goal: [inferred from conversation]
• Challenges: [any blockers mentioned or encountered]
• Next Steps: [logical next actions]

Adjust any of these, or confirm to curate?
```

3. User can confirm, adjust specific items, or provide different context
4. Then invoke the curator with the confirmed context

### Then Invoke the Curator Agent

The curator can be **resumed** within a session to maintain memory continuity.

**Flow:**

1. **Check** if `$CHRONICLE_CURATOR_ID` is set (run `echo $CHRONICLE_CURATOR_ID`)

2. **If set** - Resume the existing curator:
```
Task(
  resume: "{CHRONICLE_CURATOR_ID}",
  prompt: "Continue curating with new context:
    Project: {project}
    Branch: {branch}
    Goal: {user's goal}
    Challenges: {user's challenges}
    Next Steps: {user's next steps}

    Review and update blocks as needed.
    Report what you changed."
)
```

3. **If not set** - Spawn fresh curator:
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

4. **After Task returns** - Capture the agentId and set for future use:
```bash
export CHRONICLE_CURATOR_ID={returned agentId}
```

This allows the curator to accumulate context across multiple `/chronicle curate` calls within the same session.

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

## Publish (/chronicle publish)

Generate markdown digests of your Chronicle data.

### How to Use

Run the digest generator:

```bash
bun ~/.claude/skills/chronicle/scripts/publish.ts [period]
```

Periods:
- `weekly` (default) - Last 7 days
- `daily` - Last 24 hours
- `month` - Last 30 days

Output goes to `~/.claude/chronicle/digests/`:
- Weekly: `2026-W01.md` (ISO week)
- Daily: `2026-01-04-daily.md`
- Monthly: `2026-01.md`

### Digest Contents

- At a glance metrics
- Project summaries with highlights
- Pending work queue
- Files most modified
- Observations and patterns

---

## Dashboard (/chronicle ui)

Launch an interactive web dashboard for exploring Chronicle data.

```bash
bun ~/.claude/skills/chronicle/scripts/dashboard.ts
```

Opens browser to `http://localhost:3456`.

### Features

- **Newspaper-style view** - Sessions as stories, grouped by time period
- **Worktree sidebar** - Active worktrees with status indicators
- **Create worktrees** - Click + next to repo name
- **Archive worktrees** - Click 📦 to archive

### Run as Service

For persistent background operation, see **[docs/dashboard-service.md](docs/dashboard-service.md)**.

Quick start:
```bash
/chronicle ui install   # One-time setup
/chronicle ui start     # Start service
/chronicle ui status    # Check if running
```

---

## Philosophy

Chronicle is about **learning as we go**:
- Start simple, evolve the structure
- Manual curation builds intuition for automation
- Memory blocks are living documents, not archives
- The curator is an editor, not a stenographer
