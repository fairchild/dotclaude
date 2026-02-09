---
status: done
category: followup
pr: 83
branch: null
score: null
retro_summary: Merged alongside status-line consolidation in PR #83
completed: 2026-02-08
---

# Consolidate Chronicle Sync Scripts into Chronicle Skill

## Problem Statement

Three chronicle sync scripts live in `scripts/` while the chronicle skill lives at `skills/chronicle/`. This is the same scattered-code pattern we just fixed for session-titles in PR #81. The sync scripts are tightly coupled to chronicle data (blocks, pending threads, sync state) and share types with the skill.

## Files to Move

| Source | Destination |
|--------|-------------|
| `scripts/chronicle-sync-lib.ts` | `skills/chronicle/scripts/sync-lib.ts` |
| `scripts/chronicle-sync-popup.ts` | `skills/chronicle/scripts/sync-popup.ts` |
| `scripts/chronicle-sync-popup.test.ts` | `skills/chronicle/scripts/sync-popup.test.ts` |
| `scripts/chronicle-sync-reminder.sh` | `skills/chronicle/scripts/sync-reminder.sh` |

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Naming | Drop `chronicle-` prefix (redundant inside skill) | Same pattern as session-titles: `generate-session-title.ts` became `generate.ts` |
| Dependencies | Chronicle skill already has `package.json` | No new package.json needed unlike session-titles |
| Import updates | `./chronicle-sync-lib` becomes `./sync-lib` | All imports are between moved files (self-contained) |
| Runtime data | `~/.claude/.chronicle-last-sync` stays | Same principle as title-feedback: don't move runtime state |

## Implementation

### Phase 1: Move and Rename

```bash
git mv scripts/chronicle-sync-lib.ts skills/chronicle/scripts/sync-lib.ts
git mv scripts/chronicle-sync-popup.ts skills/chronicle/scripts/sync-popup.ts
git mv scripts/chronicle-sync-popup.test.ts skills/chronicle/scripts/sync-popup.test.ts
git mv scripts/chronicle-sync-reminder.sh skills/chronicle/scripts/sync-reminder.sh
```

**Import updates in moved files:**
- `sync-popup.ts` line 27: `./chronicle-sync-lib` -> `./sync-lib`
- `sync-popup.test.ts` (~8 occurrences): `./chronicle-sync-lib` -> `./sync-lib`

**Usage comments to update:**
- `sync-popup.ts` lines 10-13: `bun scripts/chronicle-sync-popup.ts` -> `bun skills/chronicle/scripts/sync-popup.ts`

### Phase 2: Update Cross-References

- `skills/chronicle/SKILL.md:457` references `~/.claude/scripts/chronicle-sync-reminder.sh`
- `backlog/native-sync-popup.md:51` references `bun scripts/chronicle-sync-popup.ts`
- `webui/data.json` will regenerate via `bun webui/scan.ts`

### Phase 3: Type Consolidation (Optional)

`sync-lib.ts` defines `ChronicleBlock` and `PendingThread` types. `skills/chronicle/scripts/types.ts` likely has similar types. Consider:
- If types overlap, import from `types.ts` instead of redefining
- If they diverge, keep separate (sync-lib types are sync-specific views)

## Verification Commands

```bash
# Tests pass at new location
bun test skills/chronicle/scripts/sync-popup.test.ts

# No stale references
git grep 'chronicle-sync-lib\|chronicle-sync-popup\|chronicle-sync-reminder' -- ':!backlog/'

# Popup still works
bun skills/chronicle/scripts/sync-popup.ts --json --force
```

## Complexity Notes

Lower complexity than session-titles consolidation:
- No hook path changes (sync scripts aren't called by hooks)
- No `.gitignore` changes needed
- No package.json changes (chronicle skill already has deps)
- Imports are self-contained (lib -> popup, no external consumers)
- 4 files vs 12 files

## References

- PR #81: Session titles consolidation (identical pattern)
- `skills/chronicle/SKILL.md` lines 455-458: sync section
- `backlog/native-sync-popup.md`: related future work on native sync UI
- `scripts/package.json`: verify no chronicle deps to remove after move
