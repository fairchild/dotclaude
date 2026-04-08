---
name: chronicle
description: Capture and curate session memory blocks. Use /chronicle to save current work, /chronicle catchup to restore context, /chronicle recap for multi-session narrative across last N sessions, /chronicle wrapup to deliberately close a session (curator + conditional backlog update), /chronicle curate to organize memory, /chronicle summarize for AI summaries, /chronicle search to find sessions, /chronicle publish for digests, /chronicle ui for dashboard.
license: Apache-2.0
metadata:
  status: experimental
---

# Chronicle

A persistent journalist tracking your coding sessions.

## Usage

```
/chronicle                    # Quick capture of current session
/chronicle <note>             # Capture with a specific note
/chronicle curate             # Invoke curator to organize memory (interactive)
/chronicle insights           # Deep analysis with Explore subagents
/chronicle insights <project> # Analyze specific project
/chronicle pending            # Show pending threads across sessions
/chronicle blocks             # List recent memory blocks
/chronicle catchup            # Restore context for current project
/chronicle catchup --days=30  # Extend lookback to 30 days
/chronicle recap              # Multi-session narrative for current project (7 days)
/chronicle recap <project>    # Recap for a specific project
/chronicle recap --days=14    # Extend window
/chronicle recap --sessions=5 # Window by session count instead of days
/chronicle wrapup             # Deliberate session close-out (curator + conditional backlog)
/chronicle stale              # Show stale pending items (>14 days)
/chronicle consolidate        # Consolidate old blocks (dry run)
/chronicle consolidate apply  # Consolidate and drop stale pending
/chronicle resolve "text"     # Mark pending item as resolved
/chronicle resolve --list     # Show all resolved items
/chronicle resolve --undo "text"  # Undo a resolution
/chronicle search <query>     # Search sessions by text
/chronicle publish            # Generate weekly digest (markdown)
/chronicle publish daily      # Generate daily digest
/chronicle publish month      # Generate monthly digest
/chronicle summarize          # Generate AI summaries (daily + repos)
/chronicle summarize weekly   # Generate weekly AI summaries (Opus)
/chronicle ui                 # Launch interactive web dashboard
/chronicle ui watch           # Run with auto-restart on file changes
/chronicle ui hot             # Run with hot module reloading
/chronicle ui install         # Install dashboard as macOS service
/chronicle ui start           # Start the dashboard service
/chronicle ui stop            # Stop the dashboard service
/chronicle ui status          # Check if dashboard service is running
/chronicle ui logs            # View dashboard service logs
/chronicle ui uninstall       # Remove dashboard service
/chronicle dev                # Start development session for Chronicle itself
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


## Catchup (/chronicle catchup)

Restore context when returning to a project:

```bash
bun ~/.claude/skills/chronicle/scripts/catchup.ts [--days=N]
```

Options:
- `--days=N` - Look back N days (default: 7)

Shows:
1. Current project/branch/worktree context
2. Last session's summary and pending items
3. Aggregated pending work (deduplicated, with age)
4. Patterns: session frequency, focus areas

If no data found, suggests `/chronicle` to capture current session.

### Auto-Resolution via Claude Code

The script can output resolution candidates for semantic matching:

```bash
bun ~/.claude/skills/chronicle/scripts/catchup.ts --candidates
```

This outputs JSON with pending/accomplished pairs scored by keyword overlap.
When running `/chronicle catchup` with resolution checking:

1. Run `catchup.ts --candidates` to get JSON candidates
2. Spawn a haiku agent to evaluate each candidate semantically:

```
Task(
  subagent_type: "general-purpose",
  model: "haiku",
  prompt: "For each candidate, determine if the accomplished item resolves the pending item.
    Return JSON array of resolved items: [{pendingText, accomplishedText, resolved: boolean}]

    Candidates: {candidates JSON}"
)
```

3. Save confirmed resolutions:

```bash
bun ~/.claude/skills/chronicle/scripts/resolve.ts "pending text"
```

---

## Recap (/chronicle recap)

Generate a multi-session narrative recap for a project — the shape "returning to a repo after a few days and wanting to scan what happened," not "what was I doing in my last session."

```bash
bun ~/.claude/skills/chronicle/scripts/recap.ts [project] [--days=N] [--sessions=N] [--stdout-only]
```

Options:
- `project` — positional, defaults to current project from `detectContext()`
- `--days=N` — time window (default: 7)
- `--sessions=N` — window by session count instead (mutually exclusive with `--days`)
- `--stdout-only` — skip writing to `~/.claude/chronicle/recaps/`

### What it produces

A Markdown recap with exactly four sections:

1. **Themes** — what the user has been pushing on (clustered into arcs, not listed day-by-day)
2. **Wins** — what shipped, cross-referenced with `git log` for PR numbers and feature names
3. **Open threads** — unfinished or deferred work, pulled from pending items + curated project memory
4. **Friction** — recurring gripes and preferences, pulled from curated feedback memory

### Data sources

- Chronicle blocks for `project` within the window (from `queries.ts`)
- `git log --oneline --since=<window>` from the local project path (best-effort — skipped if the repo isn't found under `~/code/<project>` or cwd)
- Curated memory at `~/.claude/projects/<slug>/memory/feedback_*.md` and `project_*.md`

### Behavior

- Output goes to stdout **and** to `~/.claude/chronicle/recaps/{project}-{YYYY-MM-DD}.md` (unless `--stdout-only`)
- If fewer than 2 blocks in window: prints a "not enough data" message with pointers to raw session JSONLs under `~/.claude/projects/<slug>/` and exits 0
- If the API call fails: falls back to a raw-facts dump (sessions + git log + memory file counts) so the command is still useful offline
- Model: **Opus** (`claude-opus-4-5-20251101`) — recap is lower-frequency than summarize, quality matters more than cost

### When to use it

- Returning to a project after a few days
- Producing a handoff for a teammate
- Before `/chronicle wrapup` on a long-running branch, to see the full arc

`/chronicle catchup` remains the right tool for "what was I doing yesterday" — recap is for the longer view.

### Quality note

Recap fidelity is bounded by block fidelity. The SessionEnd hook auto-extracts blocks with thin, file-list summaries like `"Worked on X: modified a.ts, b.ts and 14 more"`. Opus synthesizes what it can from those, but the Themes section is only as good as the inputs. **Running `/chronicle wrapup` at the end of focused sessions writes richer blocks via the curator, which makes future recaps materially better.** Over time the block pool gets denser and recap quality improves.

---

## Wrapup (/chronicle wrapup)

Deliberate end-of-session close-out. Writes a high-fidelity chronicle block via the curator, then conditionally updates `backlog/` and `backlog/ROADMAP.md` only if the session actually touched them. This is the intentional version of what the SessionEnd hook does automatically.

Use at the end of a focused work session when you know the themes, wins, and open threads and want them captured crisply — especially before merging a PR.

### Flow

**1. Invoke the curator via `/chronicle curate`**

Follow the Curate Mode section above: propose observations for the session, get user confirmation, then spawn or resume the `chronicle-curator` agent with goal / challenges / nextSteps. The curator writes or updates today's block.

**2. Detect backlog / roadmap involvement**

Before touching `backlog/` or `backlog/ROADMAP.md`, confirm the session actually worked on them. Check:

- Were any files under `backlog/` created, edited, moved, or deleted this session? (check git status + session edits)
- Was `backlog/ROADMAP.md` edited, or did the user explicitly reference it in the conversation?

If **neither** is true → **skip step 3 entirely**. Do not touch backlog files, do not append to ROADMAP, do not commit. The curator block is the only artifact.

**3. Conditional backlog / roadmap update** (only if step 2 detected involvement)

For each completed backlog item:
- Set `status: done`
- Set `completed: YYYY-MM-DD`
- Add a one-sentence `retro_summary`
- Set `pr:` and `branch:` if not already set
- Optionally set `score:` (0-5 effectiveness rating)
- Move the file to `backlog/done/`

For scope discovered but not implemented, create pending entries:
```yaml
---
status: pending
category: followup  # or: plan, task-list, ideas
pr: null
branch: null
---
```

If ROADMAP was touched, append to `backlog/ROADMAP.md` under Learnings:
```markdown
### YYYY-MM-DD — milestone name (#PR)
- What worked well
- What caused friction
- Anything worth documenting
```

Stage and commit:
```bash
git add backlog/
git commit -m "chore: update backlog for <feature>"
```

**4. Milestone check**

If the session completed a milestone (not just a task), suggest `/release` to bump version, generate changelog, and create a GitHub Release. Milestones often span multiple PRs — suggest release when a meaningful capability is complete, not after every PR.

### What this does NOT do

- **Does not write `handoff.md`** in the repo. The chronicle block is the handoff. `/chronicle catchup` at the start of the next session restores context; `/chronicle recap` synthesizes the longer arc.
- **Does not touch `backlog/` or `backlog/ROADMAP.md`** unless the session explicitly worked on them. Most sessions will skip step 3.
- **Does not emit a copy-pastable next-session prompt.** `/chronicle catchup` replaces that pattern.

---

## Stale (/chronicle stale)

Show pending items that have been open for more than 14 days:

```bash
bun ~/.claude/skills/chronicle/scripts/stale.ts
```

Shows:
1. All pending items older than 14 days
2. Grouped by project
3. Sorted by age (oldest first)

Staleness warnings also appear in `/chronicle catchup` output with ⚠️ markers.

---

## Consolidate (/chronicle consolidate)

Reduce block bloat by merging per-project, per-week blocks into consolidated summaries.

```bash
bun ~/.claude/skills/chronicle/scripts/consolidate.ts                    # Dry run
bun ~/.claude/skills/chronicle/scripts/consolidate.ts --apply            # Execute
bun ~/.claude/skills/chronicle/scripts/consolidate.ts --apply --drop-pending  # Execute + clear stale pending
bun ~/.claude/skills/chronicle/scripts/consolidate.ts --older-than=30    # Only blocks >30 days old (default: 14)
bun ~/.claude/skills/chronicle/scripts/consolidate.ts --project=services # Single project
```

Consolidation:
- Groups blocks by project + ISO week
- Deduplicates accomplished and pending items (case-insensitive)
- Removes pending items that appear in accomplished
- Cross-week dedup: each project's pending kept only in earliest week
- Archives originals to `~/.claude/chronicle/archive/` (not deleted)

Also runs monthly via launchd (1st of each month at 2am). Install:
```bash
~/.claude/skills/chronicle/scripts/install-services.sh install consolidate
```

---

## Resolve (/chronicle resolve)

Mark pending items as resolved. Resolutions can happen two ways:

**Auto-detection**: During `/chronicle catchup`, Claude Code can spawn a haiku agent to semantically match accomplished items against pending items (see Catchup section above).

**Explicit resolution**: Manually mark items as complete:

```bash
bun ~/.claude/skills/chronicle/scripts/resolve.ts "Add unit tests"  # Mark as resolved
bun ~/.claude/skills/chronicle/scripts/resolve.ts --list            # Show resolved items
bun ~/.claude/skills/chronicle/scripts/resolve.ts --undo "text"     # Undo a resolution
```

Resolutions are stored in `~/.claude/chronicle/resolved.json` as an overlay - original blocks remain immutable.

Resolved items:
- Are excluded from pending lists in catchup and stale
- Show with ✓ in the "Recently resolved" section of catchup output
- Can be undone with `--undo` to make them pending again

---
## Search (/chronicle search <query>)

Search across all Chronicle blocks by text:

1. Read all blocks from `~/.claude/chronicle/blocks/`
2. Search in: summary, accomplished items, pending items, project name, branch
3. Return matching blocks sorted by relevance

Example queries:
- `/chronicle search oauth` - Find sessions mentioning OAuth
- `/chronicle search jrnlfish` - Find all jrnlfish sessions
- `/chronicle search "error handling"` - Find sessions with specific phrase

---

## Insights (/chronicle insights)

Generate deep insights by exploring code and memory patterns using subagents.

### How to Use

```
/chronicle insights              # All active projects (max 3)
/chronicle insights <project>    # Specific project
```

### Process

1. Spawn the **chronicle-insights** agent:

```
Task(
  subagent_type: "chronicle-insights",
  prompt: "Generate insights for {project or 'all active projects'}.

    Focus on:
    - Stalled work (pending items >7 days with no progress)
    - Tech debt patterns (TODOs, FIXMEs, complex code)
    - Cross-project themes
    - Evolution of focus over time

    For each project, spawn Explore subagents to examine actual code.
    Cross-reference findings with memory blocks.
    Save results to ~/.claude/chronicle/insights/"
)
```

2. The insights agent spawns **Explore subagents** to examine actual code in worktrees.

3. Results saved to `~/.claude/chronicle/insights/{date}-{project}.json`

### Insight Types

| Type | Meaning |
|------|---------|
| `stalled_work` | Pending items appearing repeatedly with no resolution |
| `tech_debt` | TODOs/FIXMEs found in code, complex patterns |
| `pattern` | Recurring themes across sessions |
| `opportunity` | Actionable improvements identified |

### Viewing Insights

Insights appear in the Chronicle dashboard under each repo's detail view.
You can also read them directly:

```bash
cat ~/.claude/chronicle/insights/*.json | jq .
```

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
- **Repo-level view** - Click repo name to see aggregate stats, worktree cards, and AI summaries
- **Usage stats** - Tokens used, peak productivity hours (from ai-coding-usage DB)
- **Create worktrees** - Click + next to repo name
- **Archive worktrees** - Click 📦 to archive

### Run as Service

For persistent background operation, see **[docs/dashboard-service.md](docs/dashboard-service.md)**.

Quick start:
```bash
/chronicle ui install   # One-time setup
/chronicle ui start     # Start service (port 3457)
/chronicle ui status    # Check if running
```

### Remote Dashboard Sync

Run the dashboard on a remote server with periodic data sync from your Mac.

**Setup:**
1. Deploy dashboard to remote host (requires Bun runtime + systemd)
2. Configure sync in `~/.claude/.env`:
   ```bash
   CHRONICLE_SYNC_TARGET=myserver      # Display name
   CHRONICLE_DEPLOY_DIR=/path/to/deploy # Ansible deploy directory
   ```
3. Install the reminder service:
   ```bash
   ~/.claude/skills/chronicle/scripts/install-services.sh install sync-reminder
   ```

**How it works:**
- Daily popup (9am) if Chronicle blocks changed since last sync
- Click "Sync Now" to rsync data to remote
- Silent when no changes

**Manual sync:**
```bash
~/.claude/skills/chronicle/scripts/sync-reminder.sh           # Interactive
ansible-playbook claude.yml --tags chronicle-sync -e chronicle_sync_enabled=true  # Direct
```

---

## Development (/chronicle dev)

Start a development session for working on Chronicle itself.

```bash
# Stop service to free port, start dev server with auto-reload
~/.claude/skills/chronicle/scripts/install-services.sh uninstall dashboard 2>/dev/null
bun --watch ~/.claude/skills/chronicle/scripts/dashboard.ts
```

Opens browser to http://localhost:3456

### Port Strategy

| Mode | Port | Purpose |
|------|------|---------|
| Development | 3456 | Local dev, tests |
| Service | 3457 | Background service |

### Running Tests

```bash
./skills/chronicle/tests/run_tests.sh
```

For detailed development workflow, see **[docs/development.md](docs/development.md)**.

---

## Summarize (/chronicle summarize)

Generate high-quality AI summaries using Claude.

### Manual Generation

```bash
bun ~/.claude/skills/chronicle/scripts/summarize.ts              # Daily global + repo summaries
bun ~/.claude/skills/chronicle/scripts/summarize.ts --weekly     # Weekly summaries (Opus)
bun ~/.claude/skills/chronicle/scripts/summarize.ts --repo=name  # Single repo summary
```

Summaries stored in `~/.claude/chronicle/summaries/{global,repos}/`.

### Automated Generation (Launchd)

Daily summaries run at midnight, weekly on Sunday 00:05.

**Install services:**
```bash
~/.claude/skills/chronicle/scripts/install-services.sh install summarize summarize-weekly
```

**Check logs:**
```bash
tail -f /tmp/chronicle-summarize.log
tail -f /tmp/chronicle-summarize-weekly.log
```

### Model Strategy

| Period | Model | Rationale |
|--------|-------|-----------|
| Daily | Sonnet | Cost-effective, sufficient quality |
| Weekly | Opus | Higher quality synthesis for weekly review |

---

## Philosophy

Chronicle is about **learning as we go**:
- Start simple, evolve the structure
- Manual curation builds intuition for automation
- Memory blocks are living documents, not archives
- The curator is an editor, not a stenographer
