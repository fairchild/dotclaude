# Persona Memory: Implementation Options

## Goal

Ship `persona-memory` as a distributable Claude skill while keeping the framework general:
- persona is provided by `personality.md`
- memory lives in `~/.ai-memory`
- assertiveness policy comes from personality (including high initiative)

## Decision Drivers

1. Must be installable/distributable as a Claude skill.
2. Must support "always load personality" behavior for Claude sessions.
3. Must be reliable under normal coding workflows (no brittle infra).
4. Must keep memory local, inspectable, and portable.
5. Must allow persona profiles (Bertram as one profile, not the framework).

## Option A: Skill + Custom Launcher + Hooks (File-backed memory)

### Summary

Package a skill that installs:
- a Claude launcher wrapper that appends `personality.md`
- SessionStart/SessionEnd hooks for recall + consolidation
- file-backed memory scripts in `~/.ai-memory`

### Mechanics

1. Launch path
- `claude-persona` wrapper runs:
  - `claude --append-system-prompt "$(cat ~/.ai-memory/profiles/<profile>/personality.md)" --add-dir ~/.ai-memory ...`

2. Session lifecycle
- `SessionStart`: recall relevant memory and produce compact working-memory context.
- `SessionEnd`: run sleep-time compute to dedupe/promote memories.

3. Storage
- Markdown blocks + JSONL event log under `~/.ai-memory`.

### Pros

- Best match to "always loaded personality" requirement.
- Fully local, simple to inspect and debug.
- Easy to distribute as skill folder.
- No external services required.

### Cons

- "Always loaded" is guaranteed only when sessions are launched through wrapper.
- Memory quality depends on heuristics unless enhanced later.

## Option B: Hook-only Integration (No custom launcher)

### Summary

Rely only on hooks to inject memory/persona behavior, without a launcher.

### Pros

- Low setup friction for users who already run `claude` directly.
- Cleaner operational model.

### Cons

- Cannot strongly guarantee persona is appended to system prompt every session.
- Weaker fit for your "always loaded personality.md" requirement.

## Option C: Skill + Local Memory Service (SQLite/FTS/Vector)

### Summary

Add a local daemon or service for richer retrieval, while still shipping as a skill.

### Pros

- Better recall quality and ranking.
- Stronger long-term scalability.

### Cons

- Higher complexity and operational burden.
- More moving pieces reduce portability/reliability for v1.

## Option D: MCP-first Memory Backend

### Summary

Use MCP server as primary memory backend; skill orchestrates prompts and workflows.

### Pros

- Clean API boundary, future-ready for richer tooling.
- Potentially shared across Claude/Codex/other agents.

### Cons

- Violates "prefer simple scripts" direction unless justified.
- Adds setup friction and failure modes.
- Slower path to distributable v1.

## Distribution Patterns

## Pattern 1: Repo skill install (recommended baseline)

- Publish `skills/persona-memory/` in repo.
- Install via:
  - `npx skills add <owner>/<repo> --skill persona-memory`

## Pattern 2: Packaged `.skill` artifact

- Produce zip-style `.skill` from the folder.
- Good for direct sharing/manual distribution.

## Pattern 3: Dual channel

- Support both repo install and packaged artifact.
- Best for adoption across different user preferences.

## Recommended Path

Choose **Option A** for v1, with a clean upgrade path toward Option C.

Reasoning:
1. It satisfies the "always load personality" requirement in a concrete way for Claude.
2. It stays highly distributable as a normal skill.
3. It keeps complexity low while preserving future extensibility.

## Proposed v1 Layout

```text
skills/persona-memory/
├── SKILL.md
├── scripts/
│   ├── bootstrap.ts                # create ~/.ai-memory, install defaults, print next steps
│   ├── launch-claude.sh            # wrapper with --append-system-prompt + --add-dir
│   ├── session-start.ts            # recall + working-memory summary
│   ├── session-end.ts              # sleep-time consolidation
│   ├── remember.ts                 # capture candidate memories
│   ├── recall.ts                   # retrieve relevant memory slices
│   ├── consolidate.ts              # dedupe/promote/update blocks
│   └── memory-lib.ts               # shared file/schema helpers
└── references/
    ├── personality-contract.md
    ├── memory-schema.md
    ├── scoring-and-promotion.md
    └── hook-setup.md
```

Runtime data (outside skill folder):

```text
~/.ai-memory/
├── profiles/
│   ├── default/personality.md
│   └── bertram/personality.md
├── blocks/
│   ├── user-profile.md
│   ├── preferences.md
│   ├── decisions.md
│   ├── active-threads.md
│   ├── relationships.md
│   └── projects/<project-key>.md
├── events/memory-events.jsonl
├── index/memory-index.json
└── snapshots/
```

## Claude-first / Codex-second Compatibility

1. Claude v1: first-class support via wrapper + hooks.
2. Codex v1: read/write same `~/.ai-memory` store via scripts, but personality injection parity may be partial.
3. Codex v2: add dedicated launcher/profile strategy once prompt-injection parity requirements are finalized.

## Risks and Mitigations

1. Risk: users bypass wrapper and lose persona injection.
- Mitigation: bootstrap warns clearly; provide shell alias/function install snippet.

2. Risk: memory bloat/noise.
- Mitigation: salience scoring, confidence tags, consolidation limits.

3. Risk: hook failures disrupt workflow.
- Mitigation: fail-open hooks and strict timeout budgets.

## Decision

Proceed with **Option A** as the implementation baseline for `persona-memory` v1.

## Next Spec Task

Write technical spec for Option A:
1. exact script CLI contracts and JSON I/O
2. hook payload handling rules
3. personality contract schema (including assertiveness)
4. bootstrap/install flow for distributable skill packaging
