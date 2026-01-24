---
status: pending
category: plan
pr: 58
branch: stale-detection
score: null
retro_summary: "Phase 1 complete (age tracking, /stale command, catchup warnings). Phases 2-3 (resolution detection, dashboard) remain."
completed: null
---

# Chronicle Stale Detection

## Problem Statement

Pending work items accumulate across sessions and become invisible. Users forget about items that were important weeks ago. There's no mechanism to surface stale work or detect when items have been resolved.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Staleness threshold | 14 days | Long enough for legitimate multi-week work, short enough to catch forgotten items |
| Resolution detection | Multi-signal | Git commits, accomplished items, explicit commands |
| Storage | Extend block schema | Keep everything in existing JSON blocks |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   STALE DETECTION                    │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Pending Item     Age Tracking     Resolution        │
│  ───────────     ────────────     ──────────        │
│  • First seen    • Days since     • Git commit      │
│  • Last touch    • Staleness %    • Accomplished    │
│  • Session IDs   • Alert flag     • Explicit mark   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Age Tracking

**Files to modify:**
- `scripts/queries.ts` - Add `getPendingWithAge()` function
- `scripts/catchup.ts` - Already shows age, enhance with staleness alerts

**Files to create:**
- `scripts/stale.ts` - Dedicated stale item report

**Acceptance criteria:**
- [x] `/chronicle stale` shows all pending items >14 days
- [x] Items sorted by age (oldest first)
- [x] Grouped by project

### Phase 2: Resolution Detection

**Files to modify:**
- `scripts/extract-lib.ts` - Detect resolved items in accomplished array
- `SKILL.md` - Add `/chronicle resolve` command

**Signals to detect:**
1. **Accomplished match**: "Add tests for X" in accomplished matches "Add tests for X" in pending
2. **Git commit match**: Commit message contains pending item text
3. **Explicit command**: `/chronicle resolve "item text"`

**Acceptance criteria:**
- [ ] Auto-detect resolution from accomplished items
- [ ] `/chronicle resolve "text"` marks item as done
- [ ] Resolved items move to `resolved` array in blocks

### Phase 3: Alerts

**Files to modify:**
- `scripts/catchup.ts` - Add staleness warnings
- `scripts/dashboard.ts` - Visual indicators for stale items

**Acceptance criteria:**
- [x] Catchup shows warning for items >14 days
- [ ] Dashboard shows stale items in red/warning color
- [ ] Optional: Daily digest includes stale item summary

## Verification Commands

```bash
# Test stale detection
bun ~/.claude/skills/chronicle/scripts/stale.ts

# Test resolution
bun ~/.claude/skills/chronicle/scripts/resolve.ts "item text"

# Verify in catchup output
bun ~/.claude/skills/chronicle/scripts/catchup.ts --days=30
```

## Rollback Plan

Changes are additive. No schema migration required. Can remove new scripts without affecting existing functionality.

## References

- `skills/chronicle/ROADMAP.md` - Phase 2 description
- `skills/chronicle/scripts/queries.ts` - Existing pending item queries
- `skills/chronicle/scripts/catchup.ts` - Already has age calculation
