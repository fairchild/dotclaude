# Roadmap

## Direction

**Current focus**: Chronicle continuity and intelligence features

### Active
- Chronicle Phase 3: Smart suggestions (session-start context injection)
- Chronicle dashboard enhancements (stale indicators, resolution display)

### Planned
- Chronicle Phase 4: Cross-project intelligence
- Thread identity across sessions
- Native sync popup (see backlog/native-sync-popup.md)

### Deferred
- Hooks validation system
- Video generation skill

## Learnings

### 2026-01-24 — Release skill overhaul (analyze-release-skill)
- Worktree-aware releases: ephemeral worktree strategy works cleanly from any branch
- Shell escaping in scripts is treacherous - use temp files for multi-line content passed to CLI tools
- Outcome tracking (JSONL) pattern from update-dependencies skill is worth replicating
- /reflect caught a real shell injection bug before merge
- Skill structure: scripts/ for automation, references/ for troubleshooting, data/ for learning

### 2026-01-24 — Chronicle Sync UX Simplification (#59)
- macOS osascript dialogs are plain text only—rich UI needs native app
- Structured output (JSON) is UI-agnostic—design for any consumer
- Terminal preview + dashboard covers 90% of use cases without native UI
- Feedback loops require click tracking—defer until native UI exists

### 2026-01-24 — Chronicle stale detection (#58)
- Cross-project deduplication was a subtle bug - same text in different projects should be separate items
- Archive script resilience: error suppression is pragmatic for cleanup workflows
- STALE_THRESHOLD_DAYS should be a single exported constant, not duplicated
- /reflect workflow continues to catch bugs before merge

### 2026-01-24 — Chronicle catchup bugfix (#56)
- Worktree filtering is essential for relevant context in multi-worktree workflows
- Design tradeoff: worktree-specific last session, project-wide pending items
- /reflect caught a real bug before merge - validates the workflow
- Centralized storage + worktree metadata is the right architecture

### 2026-01-24 — Chronicle resolution detection (#61)
- Overlay file vs block mutation: blocks are session snapshots, resolutions are cross-session metadata
- Brainstorming skill invaluable for design decisions (storage model, matching strategy)
- Circular imports: extract shared types.ts to break the cycle cleanly
- LLM always decides on match (with matchScore as context) - no magic thresholds
- Lazy evaluation: run resolution check on /catchup, not at session end

### 2026-01-22 — Chronicle catchup command (#56)
- Brainstorm-to-brief workflow effective for going wide then narrowning
- Conductor workspace sandbox requires using Bash for writes outside workspace
- SKILL.md serves as both documentation AND command dispatcher
- Worktree detection reuses patterns from extract-lib.ts
- Pending deduplication by normalizing text (lowercase, trim)
