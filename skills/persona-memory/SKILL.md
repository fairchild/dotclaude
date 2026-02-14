---
name: persona-memory
description: Build and operate a persistent persona and memory framework for Claude Code. Use when setting up personality.md injection, durable memory blocks in ~/.ai-memory, session start/end memory workflows, recall/remember/consolidate scripts, or packaging a distributable memory skill profile.
metadata:
  status: experimental
---

# Persona Memory

General memory framework for teammate-style agents.

This skill is framework-first: any specific persona (for example Bertram) should be implemented as a profile by providing `personality.md` and using the shared memory store.

## Current Scope (Experimental)

- Local-first memory store in `~/.ai-memory`.
- Personality/profile loading via launcher and appended prompt context.
- Scripted remember/recall/consolidate/session lifecycle hooks.
- Deterministic + live-smoke test harness and curation dashboard.

## Not Yet Implemented

- Continuous background memory agents (always-on consolidation/recall loops).
- Autonomous cross-project relationship learning and long-horizon planning.
- Production-stability guarantees or backward-compatibility promises.
- Full interactive Claude session integration testing in CI.

## Quick Start

1. Initialize memory store and defaults:
```bash
bun ~/.claude/skills/persona-memory/scripts/bootstrap.ts --install-launcher
```

2. Launch Claude with persona-memory:
```bash
claude-persona
```

3. Optional: set profile per shell/session:
```bash
export AI_MEMORY_PROFILE=default
```

## What This Skill Provides

- `scripts/launch-claude.sh`: Claude launcher wrapper that appends `personality.md` and recall context.
- `scripts/bootstrap.ts`: Creates `~/.ai-memory` structure and starter files.
- `scripts/remember.ts`: Writes candidate memory events.
- `scripts/recall.ts`: Reads memory blocks and returns relevant context.
- `scripts/consolidate.ts`: Promotes events into stable memory blocks.
- `scripts/session-start.ts`: Hook-friendly startup memory snapshot.
- `scripts/session-end.ts`: Hook-friendly sleep-time consolidation.

## Runtime Data

Persistent memory root:
- `~/.ai-memory`

Profile-based personalities:
- `~/.ai-memory/profiles/<profile>/personality.md`

## Dev Search Standard

- Prefer `rg`/`rg --files` for codebase search and file discovery.
- Use `grep` only when strict POSIX portability is required.

## Hook Setup

Read:
- `references/hook-setup.md`

Add hooks to your `~/.claude/settings.json` for session lifecycle automation.

## References

- `references/personality-contract.md`
- `references/memory-schema.md`
- `references/scoring-and-promotion.md`
- `references/hook-setup.md`
- `references/TESTING.md`
