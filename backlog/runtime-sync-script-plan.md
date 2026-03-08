---
priority: 1
description: Refactor inline auto-sync hook into a standalone script for easier iteration
---

# Runtime Auto-Sync Script

## Problem Statement

The auto-sync hook is currently an inline shell command in `settings.json`:

```json
"command": "git -C ~/.claude fetch origin main --quiet 2>/dev/null; git -C ~/.claude merge origin/main --ff-only --quiet 2>/dev/null; true"
```

This works but is hard to iterate on. We may want to:
- Abandon remote fetch if it's too slow (network latency on session start)
- Switch to local-only rebase against `~/code/dotclaude` (no network dependency)
- Add logging/timing to understand performance impact
- Add conditional logic (skip if offline, skip if already current)

A script makes all of this trivial to change without touching settings.json.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Script location | `hooks/runtime-sync.sh` | Follows existing hook convention (`hooks/stop.sh`, `hooks/session-end.sh`) |
| Remote vs local | Start with remote, add local fallback | Remote catches PR merges; local fallback if offline |
| Hook ordering | First in SessionStart list | Must run before chronicle so updated scripts are available |
| Error handling | Silent failure, always exit 0 | Never block session start |

## Architecture

```
settings.json SessionStart hook
  └── hooks/runtime-sync.sh
        ├── Try: git fetch origin main + ff-only merge (remote)
        ├── Fallback: git merge main --ff-only (local, if dev clone pulled)
        └── Always exit 0
```

### Possible Evolution: Local-Only Mode

If remote fetch proves too slow, the script could switch to:

```bash
# No network — just merge from local dev clone's main
git -C ~/.claude merge main --ff-only --quiet 2>/dev/null
```

This works because `~/code/dotclaude` and `~/.claude` share the same `.git`. When you `git pull` in the dev clone, the `main` ref updates in the shared object store. The runtime worktree can merge from it without any fetch.

Trade-off: only syncs after you pull in `~/code/dotclaude`, not automatically after PR merge. But faster (no network).

### Possible Evolution: Hybrid with Timing

```bash
# Try remote with a timeout, fall back to local
timeout 3 git -C ~/.claude fetch origin main --quiet 2>/dev/null
git -C ~/.claude merge origin/main --ff-only --quiet 2>/dev/null || \
  git -C ~/.claude merge main --ff-only --quiet 2>/dev/null
```

## Implementation

### Phase 1: Extract to Script

**Files to create:**
- `hooks/runtime-sync.sh` — the sync logic, extracted from inline

**Files to modify:**
- `settings.json` — replace inline command with `~/.claude/hooks/runtime-sync.sh`

**Script content (v1):**

```bash
#!/usr/bin/env bash
# Sync runtime worktree with latest main.
# Runs on SessionStart — must never block.

git -C ~/.claude fetch origin main --quiet 2>/dev/null
git -C ~/.claude merge origin/main --ff-only --quiet 2>/dev/null
exit 0
```

**settings.json change:**

```json
{
  "type": "command",
  "command": "~/.claude/hooks/runtime-sync.sh"
}
```

**Acceptance criteria:**
- [ ] `hooks/runtime-sync.sh` exists and is executable
- [ ] settings.json references the script, not inline command
- [ ] Session start works offline (script exits 0)
- [ ] Session start works online (runtime fast-forwards)

### Phase 2: Add Observability (Optional)

- Log sync result to `~/.claude/debug/runtime-sync.log` (last 10 entries)
- Track timing to decide if remote fetch is worth the latency

## Verification Commands

```bash
# Test the script directly
~/.claude/hooks/runtime-sync.sh && echo "OK"

# Verify it's idempotent
~/.claude/hooks/runtime-sync.sh && ~/.claude/hooks/runtime-sync.sh && echo "OK"

# Verify offline resilience (disconnect network first)
~/.claude/hooks/runtime-sync.sh && echo "OK even offline"

# Check timing
time ~/.claude/hooks/runtime-sync.sh
```

## Rollback Plan

Revert settings.json to inline command:
```json
"command": "git -C ~/.claude fetch origin main --quiet 2>/dev/null; git -C ~/.claude merge origin/main --ff-only --quiet 2>/dev/null; true"
```

## References

- `settings.json` lines 113-121 — current inline hook
- `hooks/stop.sh`, `hooks/session-end.sh` — existing hook script pattern
- `docs/development.md` — auto-sync documentation
- PR #111 — worktree migration that introduced the hook
