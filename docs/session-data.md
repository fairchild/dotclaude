# Session Data

> Personal session data is gitignored for privacy and aggregated separately from git-tracked config.

## Overview

The `~/.claude/` directory separates git-tracked configuration from personal session data:

| Type | Examples | Git-tracked | Reason |
|------|----------|-------------|--------|
| Configuration | skills/, commands/, settings.json | Yes | Shared via git |
| Session data | chronicle/, plans/, todos/, history.jsonl | No | Personal, ephemeral |
| Knowledge | knowledge/ | No | Personal accumulation |
| Analytics | telemetry/, statsig/, title-feedback/ | No | Machine-specific |
| Cache | plugins/, projects/, debug/, cache/ | No | Generated, large |
| Secrets | .env, credentials | No | Security |

## Gitignored Directories

### chronicle/

Persistent memory system capturing session context for continuity across sessions.

```
chronicle/
├── blocks/      # Memory snapshots (developer profile, preferences, patterns)
├── summaries/   # Per-repo session summaries
├── insights/    # Generated insights (daily, weekly patterns)
├── digests/     # Weekly/monthly aggregated digests
└── threads/     # Continuity threads (pending work tracking)
```

**Why gitignored**: Contains personal session details, project names, work patterns, and pending tasks. See [chronicle design](../skills/chronicle/docs/chronicle-design.md).

### plans/

Session work plans created during Claude Code planning mode.

```
plans/
└── <adjective>-<verb>-<noun>.md  # Session plan files (e.g., curious-hugging-emerson.md)
```

**Why gitignored**: Ephemeral planning artifacts tied to specific sessions. May contain project-specific implementation details.

### todos/

Task tracking files tied to individual sessions.

```
todos/
└── <session-uuid>-agent-<uuid>.json  # Per-session task state
```

**Why gitignored**: Session-scoped task state, not meaningful outside the originating session.

### history.jsonl

Command history across all Claude Code sessions.

```json
{"display":"user prompt text","timestamp":1759093773385,"project":"/path/to/project"}
```

**Why gitignored**: Contains all user prompts - highly personal. Useful for analytics, session title generation, and chronicle backfill.

### session-titles/

Generated session titles and metadata.

```
session-titles/
└── <project-name>/
    └── <date>/
        └── <session-id>.json  # Title, cost, model, timestamp
```

**Why gitignored**: Personal session naming tied to specific work contexts.

### session-env/

Per-session environment snapshots captured at session start.

**Why gitignored**: Ephemeral session state for debugging and context.

### file-history/

File modification tracking per session - what files were read/written.

**Why gitignored**: Session-scoped edit tracking for audit trails.

### plugins/

Downloaded plugin cache from the Claude Code marketplace.

```
plugins/
├── cache/              # Downloaded skill packages
├── temp_git_*/         # Transient clones during install
└── superpowers/        # Superpowers marketplace cache
```

**Why gitignored**: Generated cache, ~50MB+. Each machine regenerates as needed.

### projects/

Local project clones for reference and testing.

**Why gitignored**: Large (~500MB), ephemeral test environments.

### debug/

Debug output, shell snapshots, and diagnostic data.

**Why gitignored**: Ephemeral debugging artifacts (~200MB).

### knowledge/

Growing knowledge base populated by skills that extract and analyze external content.

```
knowledge/
└── youtube/           # YouTube video analyses from youtube-content skill
    ├── index.md       # Index of analyzed videos
    └── analyses/      # Per-video transcripts and insights
```

**Why gitignored**: Personal knowledge accumulation. Contains extracted content from videos, articles, etc. May grow large over time.

### title-feedback/

Feedback data for session title quality evaluation and DSPy optimization.

```
title-feedback/
├── pending.jsonl      # Feedback entries awaiting processing
├── schema.ts          # (tracked) Type definitions
└── store.ts           # (tracked) Storage utilities
```

**Why gitignored**: Personal ratings and feedback data. The `.jsonl` files contain training data for improving title generation.

### shell-snapshots/

Zsh shell state snapshots - captures of functions, aliases, and environment variables at specific points.

```
shell-snapshots/
└── snapshot-zsh-<timestamp>-<id>.sh  # Full shell state dump
```

**Why gitignored**: Machine-specific debugging artifacts for shell environment issues. Each snapshot is ~10KB, 287+ files = ~3.8MB.

### telemetry/

Claude Code's internal analytics and failed event logs.

```
telemetry/
└── 1p_failed_events.*.json  # Failed telemetry events
```

**Why gitignored**: Anthropic's internal analytics. May contain session identifiers.

### statsig/

Feature flag evaluation cache from Statsig (used by Claude Code for A/B testing).

```
statsig/
├── statsig.cached.evaluations.*  # Cached feature flag values
├── statsig.stable_id.*           # Persistent user identifier
└── statsig.session_id.*          # Session identifier
```

**Why gitignored**: Machine-specific feature flag state.

### cache/

Generic cache directory for various generated content.

```
cache/
└── changelog.md       # Cached release changelog
```

**Why gitignored**: Regenerated as needed.

### paste-cache/

Clipboard and paste history cache.

**Why gitignored**: May contain sensitive copied content.

### scratch/

Temporary work area for ad-hoc files.

**Why gitignored**: Ephemeral scratch space.

### ide/

IDE integration state (VS Code, Cursor, etc.).

**Why gitignored**: Machine-specific IDE configuration.

### image-cache/

Generated images from AI image generation skills.

**Why gitignored**: Large binary files, regenerated as needed.

### config/notification_states.json

Notification state tracking (which notifications have been seen/dismissed).

**Why gitignored**: Machine-specific UI state.

### stats-cache.json

Cached statistics for performance optimization.

**Why gitignored**: Regenerated as needed.

### webui/data.json

Build output for the Config Visualizer dashboard - aggregated data about skills, commands, and agents.

**Why gitignored**: Generated build artifact. Rebuild with `bun webui/scan.ts`.

## Multi-Machine Sync

For users with multiple development machines, session data can be aggregated to a central host.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SESSION DATA AGGREGATION                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Mac (laptop)           Linux Server           Remote Workstation          │
│   ────────────           ────────────           ──────────────────          │
│                                                                             │
│   chronicle/ ─────┐                        ┌─────── chronicle/              │
│   plans/    ─────┼────────────────────────▶│        plans/                  │
│   history.jsonl ─┘     AGGREGATION         └─────── history.jsonl           │
│                        HOST                                                 │
│                                                                             │
│                   ┌──────────────────────┐                                  │
│                   │  ~/.claude/          │                                  │
│                   │  ├── chronicle/      │ ◀── unified view across machines │
│                   │  ├── plans/          │                                  │
│                   │  └── history.jsonl   │                                  │
│                   └──────────────────────┘                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key concept**: Each machine generates its own session data, then pushes to a central aggregation host. This creates a unified view of all work across machines.

### Data Flow

| Data Type | Direction | Sync Mode |
|-----------|-----------|-----------|
| Git-tracked files (skills, commands) | Mac → remotes | `git archive` (deploy) |
| chronicle/ | All machines → hub | rsync merge |
| plans/ | All machines → hub | rsync merge |
| knowledge/ | All machines → hub | rsync merge |
| title-feedback/*.jsonl | All machines → hub | rsync merge |
| history.jsonl | All machines → hub | append (per-host files) |

### Implementation Options

| Option | Pros | Cons |
|--------|------|------|
| **rsync + cron** | Simple, reliable, proven | Manual setup per machine |
| **Git repo** | History, branching | Complex merge conflicts |
| **Syncthing** | Real-time, bidirectional | Another service to run |

### Example Setup

**1. Create sync script**

```bash
#!/bin/bash
# ~/.claude/scripts/sync-session-data.sh

set -euo pipefail

DEST_HOST="${SESSION_DATA_HOST:-orin}"
HOSTNAME=$(hostname -s)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Chronicle - merge into host-specific subdirectory
log "Syncing chronicle..."
rsync -av ~/.claude/chronicle/ "$DEST_HOST:~/.claude/chronicle/incoming/$HOSTNAME/"

# Plans - merge into host-specific subdirectory
log "Syncing plans..."
rsync -av ~/.claude/plans/ "$DEST_HOST:~/.claude/plans/incoming/$HOSTNAME/"

# Knowledge - merge into host-specific subdirectory
log "Syncing knowledge..."
rsync -av ~/.claude/knowledge/ "$DEST_HOST:~/.claude/knowledge/incoming/$HOSTNAME/"

# Title feedback - only .jsonl files
log "Syncing title-feedback..."
rsync -av --include='*.jsonl' --exclude='*' \
    ~/.claude/title-feedback/ "$DEST_HOST:~/.claude/title-feedback/incoming/$HOSTNAME/"

# History - append to host-specific file
log "Syncing history..."
rsync -av ~/.claude/history.jsonl "$DEST_HOST:~/.claude/history-incoming/$HOSTNAME.jsonl"

log "Sync complete"
```

**2. Schedule with cron (Linux)**

```bash
crontab -e
# Add:
*/15 * * * * ~/.claude/scripts/sync-session-data.sh 2>&1 | logger -t session-data-sync
```

**3. Schedule with launchd (macOS)**

```xml
<!-- ~/Library/LaunchAgents/com.claude.session-sync.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.session-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/you/.claude/scripts/sync-session-data.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>900</integer>
    <key>StandardOutPath</key>
    <string>/tmp/session-sync.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/session-sync.log</string>
</dict>
</plist>
```

Load with: `launchctl load ~/Library/LaunchAgents/com.claude.session-sync.plist`

## Privacy Considerations

Session data contains:
- Project paths and repository names
- User prompts and commands (full conversation history)
- Work patterns and timing information
- Pending tasks and implementation plans
- File paths and code snippets

**Recommendations:**
- Only sync to machines you control
- Use SSH keys for authentication (never passwords)
- Consider encrypting at rest on the aggregation host
- Exclude session data from backups to cloud services
- Review what's being synced before enabling

## Related

- [Chronicle Design](../skills/chronicle/docs/chronicle-design.md) - Memory system architecture
- [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) - Session lifecycle
