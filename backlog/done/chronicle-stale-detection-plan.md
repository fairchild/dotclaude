---
status: done
category: plan
pr: 61
branch: chronicle-phase2-resolution
score: 4
retro_summary: "Full Phase 2 complete - overlay-based resolution with LLM matching and explicit CLI. Design evolved during brainstorming session."
completed: 2026-01-24
---

# Chronicle Stale Detection

## Problem Statement

Pending work items accumulate across sessions and become invisible. Users forget about items that were important weeks ago. There's no mechanism to surface stale work or detect when items have been resolved.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Staleness threshold | 14 days | Long enough for legitimate multi-week work, short enough to catch forgotten items |
| Resolution detection | Multi-signal | Accomplished items matching, explicit commands (git commits deferred) |
| Storage | Separate overlay file | Keeps blocks immutable - resolutions are metadata about relationships between sessions |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   STALE DETECTION                    │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Pending Item     Age Tracking     Resolution        │
│  ───────────     ────────────     ──────────        │
│  • First seen    • Days since     • LLM matching    │
│  • Project key   • Staleness %    • Explicit mark   │
│  • Session IDs   • Alert flag     • Overlay file    │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Age Tracking ✅ (PR #58)

**Files modified:**
- `scripts/queries.ts` - Added `getPendingWithAge()` function
- `scripts/catchup.ts` - Enhanced with staleness alerts

**Files created:**
- `scripts/stale.ts` - Dedicated stale item report

**Acceptance criteria:**
- [x] `/chronicle stale` shows all pending items >14 days
- [x] Items sorted by age (oldest first)
- [x] Grouped by project

### Phase 2: Resolution Detection ✅ (PR #61)

**Files created:**
- `scripts/resolve-lib.ts` - Core resolution logic (tokenization, LLM matching)
- `scripts/resolve.ts` - CLI for explicit resolution
- `scripts/types.ts` - Shared types to break circular imports

**Files modified:**
- `scripts/queries.ts` - Filter resolved items from pending
- `scripts/catchup.ts` - Run auto-resolution, display resolved items
- `SKILL.md` - Document `/chronicle resolve` command

**Signals detected:**
1. **Accomplished match**: LLM compares accomplished items against pending with keyword overlap context
2. **Explicit command**: `/chronicle resolve "text"` marks item as done

**Acceptance criteria:**
- [x] Auto-detect resolution from accomplished items on catchup
- [x] `/chronicle resolve "text"` marks item as done
- [x] Resolved items stored in separate `resolved.json` overlay

### Phase 3: Alerts ✅ (PR #58)

**Acceptance criteria:**
- [x] Catchup shows warning for items >14 days
- [ ] Dashboard shows stale items in red/warning color (deferred to Phase 3 of Chronicle)
- [ ] Optional: Daily digest includes stale item summary (future)

## Verification Commands

```bash
# Test stale detection
bun ~/.claude/skills/chronicle/scripts/stale.ts

# Test resolution
bun ~/.claude/skills/chronicle/scripts/resolve.ts "item text"
bun ~/.claude/skills/chronicle/scripts/resolve.ts --list
bun ~/.claude/skills/chronicle/scripts/resolve.ts --undo "text"

# Verify in catchup output
bun ~/.claude/skills/chronicle/scripts/catchup.ts --days=30
```

## Rollback Plan

Changes are additive. Delete `resolved.json` to clear all resolutions. No block schema changes.

## References

- `skills/chronicle/ROADMAP.md` - Phase 2 description
- `skills/chronicle/scripts/types.ts` - Shared type definitions
- `skills/chronicle/scripts/resolve-lib.ts` - Resolution matching engine
