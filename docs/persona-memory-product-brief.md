# Persona Memory Framework

## Product Brief

### Working Name

`persona-memory`

### One-line Vision

Create a reusable memory framework that turns coding agents into long-term teammates with a stable personality, evolving relationship context, and durable project memory.

### Product Goal

Build a general framework, not a single persona. Specific teammate identities (for example, Bertram) should be implemented by supplying:
- a `personality.md` file (loaded as appended system prompt)
- memory blocks in a shared memory store

### Primary Target

Claude Code first, Codex-compatible second.

### Base Directory

Use `~/.ai-memory` as the default persistent storage root.

## Problem

Sessions are transient, but collaboration and decisions are longitudinal. Without structured memory, agents lose context about:
- user preferences
- important decisions and rationale
- unfinished work across projects
- how to collaborate effectively with the user over time

## Outcomes

1. Persist important memory across sessions and projects.
2. Recall relevant context at session start and when needed.
3. Consolidate memories during a session-end "sleep-time compute."
4. Keep persona and collaboration style stable and evolvable.
5. Package and distribute as a Claude skill.

## Design Principles

1. Persona-first, framework-general.
2. Memory is explicit, inspectable, and editable by the user.
3. High signal only: store durable facts/decisions/preferences, not chatter.
4. Separation of concerns: personality, working memory, and long-term memory remain distinct.
5. Model-agnostic data format, Claude-optimized execution.

## Scope

### In Scope (v1)

- Personality injection via `personality.md` append path.
- Memory capture, retrieval, and consolidation workflows.
- Background memory agents for remember/recall/consolidate.
- Session lifecycle hooks for start and end.
- Distribution as installable Claude skill.

### Out of Scope (v1)

- Autonomous personality rewriting.
- Perfect semantic retrieval over all transcripts.
- Multi-user tenancy and server-side memory sync.

## Architecture Overview

### Components

1. `personality.md`
- Canonical teammate identity: name, tone, goals, collaboration contract.
- Includes assertiveness policy and escalation rules.

2. Memory store (`~/.ai-memory`)
- Structured block files for durable memory.
- Event log for append-only traceability.
- Index files for fast lookup and consolidation.

3. Runtime integration
- Custom launcher for Claude Code with:
  - `--append-system-prompt` for personality loading
  - `--add-dir ~/.ai-memory` for memory tool access
- Optional Codex wrapper with equivalent prompt hydration behavior.

4. Lifecycle jobs
- Session start hydration (recall and inject relevant context).
- Session end "sleep-time compute" (dedupe, merge, summarize, promote).

5. Background agents
- `remember`: extract candidate memories from session signals.
- `recall`: retrieve relevant memory for active task.
- `consolidate`: reconcile and compress memory blocks.

## Memory Model (v1)

Suggested baseline files under `~/.ai-memory/blocks/`:
- `user-profile.md`
- `preferences.md`
- `decisions.md`
- `active-threads.md`
- `relationships.md`
- `projects/<project-key>.md`

Suggested operational files:
- `~/.ai-memory/events/memory-events.jsonl`
- `~/.ai-memory/index/memory-index.json`
- `~/.ai-memory/snapshots/` (periodic consolidated snapshots)

## Assertiveness Model

Assertiveness should be defined by the active personality, not hardcoded in the framework.

Required behavior:
1. Personality defines default assertiveness (`low`, `medium`, or `high`).
2. Framework supports high-initiative teammate behavior when personality requests it.
3. Runtime can temporarily downshift assertiveness for high-risk actions or explicit user preference.
4. Assertiveness changes are auditable through memory events and/or personality revisions.

## Session Lifecycle

### SessionStart

1. Load `personality.md`.
2. Run recall against current project/task hints.
3. Generate compact working-memory summary.
4. Inject summary into active context.

### In-session

1. Detect memory-worthy events (preferences, decisions, commitments, blockers).
2. Queue candidate memories with confidence metadata.
3. Persist high-confidence memories or defer for consolidation.

### SessionEnd (Sleep-time Compute)

1. Aggregate candidate memories.
2. Deduplicate and resolve conflicts.
3. Promote durable items into core block files.
4. Update active threads and unresolved commitments.
5. Write a short "what changed" summary.

## Distribution Strategy

Ship as a reusable Claude skill:
- `skills/persona-memory/SKILL.md`
- `skills/persona-memory/scripts/*`
- `skills/persona-memory/references/*`

The skill should provide:
- installation instructions
- launcher bootstrap script
- hook templates for `SessionStart` and `SessionEnd`
- memory schema and consolidation rules

Bertram becomes an implementation profile on top of this framework:
- `personality.md` = Bertram-specific
- memory blocks = same framework storage and pipelines

## Success Metrics

1. Memory capture precision: >= 80% of important decisions/preferences captured.
2. Recall usefulness: >= 75% of session-start recalls judged relevant.
3. Overhead: memory jobs complete within acceptable latency budget (target < 3s start recall, < 10s end consolidation).
4. Stability: no session-blocking failures from memory hooks in normal operation.

## Phased Implementation Plan

### Phase 0: Spec

1. Finalize memory schema and event format.
2. Finalize personality contract format, including assertiveness policy.
3. Define launcher and hook interfaces.

### Phase 1: Core Runtime

1. Implement `personality.md` loader path for Claude launcher.
2. Implement memory read/write utilities for `~/.ai-memory`.
3. Implement minimal remember/recall/consolidate scripts.

### Phase 2: Lifecycle Integration

1. Wire `SessionStart` hydration hook.
2. Wire `SessionEnd` sleep-time compute hook.
3. Add failure-safe fallbacks (never block normal coding flow).

### Phase 3: Skill Packaging

1. Create distributable `persona-memory` skill folder.
2. Validate skill structure.
3. Package as `.skill` artifact.

### Phase 4: Persona Profiles

1. Add sample persona profile (for example, Bertram).
2. Document how to create additional persona profiles.
3. Add migration utility for existing memory systems.

## Immediate Next Step

Draft the implementation spec with exact file tree, script contracts, hook payload schemas, and minimal viable commands for bootstrapping `persona-memory` in a clean `~/.claude` install.
