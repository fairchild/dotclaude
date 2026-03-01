---
name: persona-memory
audience: humans
status: experimental
summary: "Overview of the persona-memory skill, its current maturity, and how the runtime flow works."
updated: 2026-03-01
---

# Persona Memory

Persona Memory is a local-first framework for giving Claude Code a stable persona and durable memory across sessions.

This README is for people new to the skill.

## Experimental Status

This skill is currently **experimental**.

What that means right now:
- Data formats and script behavior may still change.
- There are tests and a dashboard, but this is not a hard-stability release.
- You should treat this as a fast-moving system for iteration, not a locked contract.

Source of truth for status is also in:
- `/Users/fairchild/code/dotclaude/skills/persona-memory/SKILL.md`

## What It Does

- Maintains memory data in `~/.ai-memory`.
- Loads a persona profile from `~/.ai-memory/profiles/<profile>/personality.md`.
- Injects persona + recalled context at launch via `launch-claude.sh`.
- Captures and consolidates memory through scripts and optional hooks.

## How It Works

Runtime loop:
1. `bootstrap.ts` initializes the memory home and optional launcher.
2. `launch-claude.sh` starts Claude and appends persona/recall context.
3. During and after work, scripts manage memory:
   - `remember.ts` writes candidate events.
   - `recall.ts` fetches relevant memory.
   - `consolidate.ts` promotes/prunes memory.
4. Optional hooks:
   - `session-start.ts` on SessionStart
   - `session-end.ts` on SessionEnd

## Key Files

- `/Users/fairchild/code/dotclaude/skills/persona-memory/SKILL.md`
- `/Users/fairchild/code/dotclaude/skills/persona-memory/scripts/bootstrap.ts`
- `/Users/fairchild/code/dotclaude/skills/persona-memory/scripts/launch-claude.sh`
- `/Users/fairchild/code/dotclaude/skills/persona-memory/references/hook-setup.md`
- `/Users/fairchild/code/dotclaude/skills/persona-memory/references/memory-schema.md`
- `/Users/fairchild/code/dotclaude/skills/persona-memory/references/TESTING.md`

## Quick Start

1. Bootstrap:
```bash
cd /Users/fairchild/code/dotclaude/skills/persona-memory
bun scripts/bootstrap.ts --install-launcher
```

2. Edit personality:
```bash
$EDITOR ~/.ai-memory/profiles/default/personality.md
```

3. Launch:
```bash
claude-persona
```

4. Optional: wire hooks (recommended for lifecycle automation):
- follow `/Users/fairchild/code/dotclaude/skills/persona-memory/references/hook-setup.md`

## Testing and Evaluation

- Deterministic suite:
```bash
cd /Users/fairchild/code/dotclaude/skills/persona-memory
bun tests/harness.ts --suite deterministic --report text
```

- Eval dashboard:
```bash
cd /Users/fairchild/code/dotclaude/skills/persona-memory
bun scripts/serve-eval-dashboard.ts
```
Then open: `http://127.0.0.1:8787/assets/eval-dashboard/`

## Current Limits

- No guarantee of backward compatibility yet.
- Not all end-to-end interactive paths are CI-gated.
- Continuous autonomous memory loops are intentionally limited at this stage.

