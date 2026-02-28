# team-memory Implementation Handoff

## Context

You are implementing the **team-memory** skill — a persistent AI teammate memory framework for Claude Code. The full design has been brainstormed, approved, and documented.

> Historical handoff note: team-memory is now implemented. Use this file as architecture context, not as current task status.

**Read the design first:**
```
Read ~/.claude/skills/team-memory/references/design.md
```

## What Exists

- `~/.claude/skills/team-memory/references/design.md` — the complete approved design
- The skill directory has been created at `~/.claude/skills/team-memory/`
- Implementation now exists in `scripts/`, `templates/`, `references/agents/`, and `agents/team-memory-sleep.md` (synced into `~/.claude/agents/team-memory-sleep.md`)

## What You're Building

A Claude Code skill with these components (in implementation order):

### Phase 1: Foundation (get a teammate running)

1. **Templates** — Create `templates/` directory with starter files:
   - `CLAUDE.md.tmpl` — entry point with @imports and memory instructions
   - `personality.md.tmpl` — scaffold with immutable/mutable sections
   - `relationship.md.tmpl` — empty relationship scaffold
   - `human.md.tmpl` — starter human profile

2. **init.sh** — Script that bootstraps `~/.ai-memory/<name>/` from templates:
   - Creates directory structure (core/, archival/, journal/)
   - Copies and interpolates templates
   - Creates `~/.ai-memory/shared/` if it doesn't exist
   - Sets up `active` symlink if this is the first teammate
   - Wires SessionEnd hook into `~/.claude/settings.json`

3. **launch.sh** — Thin launcher that resolves persona and invokes claude:
   - Reads `--persona` flag or follows `active` symlink
   - Sets `AI_MEMORY_PERSONA` and `AI_MEMORY_DIR` env vars
   - Invokes `claude --add-dir <persona_dir>` with `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`
   - Passes through all other claude args

4. **SKILL.md** — Skill definition with commands and triggers

### Phase 2: Active Memory (frontal cortex agents)

5. **references/agents/remember.md** — Background agent that writes memory blocks to archival/:
   - Receives content + context from the main agent
   - Infers type, confidence, tags from content
   - Writes properly formatted markdown with YAML frontmatter
   - Checks for duplicates before writing (grep existing blocks)

6. **references/agents/recall.md** — Background agent that searches memories:
   - Searches archival/ and journal/ using Grep
   - Reads matching blocks
   - Returns relevant memories to the main agent
   - Searches core/ too for completeness

### Phase 3: Sleep-Time Compute (subconscious pipeline)

7. **agents/team-memory-sleep.md** — Orchestrator source dispatched by SessionEnd hook (synced to `~/.claude/agents/team-memory-sleep.md`):
   - Dispatches sleep-extract, sleep-consolidate, sleep-reflect in sequence
   - Each runs as a sub-task

8. **references/agents/sleep-extract.md** — Extract memories the active loop missed:
   - Read session transcript (find latest .jsonl in ~/.claude/projects/)
   - Read existing archival/ blocks
   - Identify genuinely new memories not already captured
   - Focus on patterns across the session, not individual moments
   - Write new blocks to archival/

9. **references/agents/sleep-consolidate.md** — Consolidate the memory store:
   - Read all archival/ blocks
   - Identify overlapping/duplicate entries, merge them
   - Resolve contradictions (newer wins unless lower confidence)
   - Apply confidence decay based on type and age
   - Promote high-confidence, frequently-relevant blocks to core/
   - Demote stale core/ blocks back to archival/
   - Prune blocks below 0.3 confidence threshold

10. **references/agents/sleep-reflect.md** — Evolve personality and relationship:
    - Read recent session context + relationship.md + personality.md
    - Update relationship.md (communication style, rapport, shared history)
    - Update mutable personality sections if warranted
    - Respect IMMUTABLE markers — never modify those sections
    - Increment personality version number

### Phase 4: Polish

11. Wire up SKILL.md commands (`/team-memory init`, `list`, `switch`, `status`, `consolidate`, `forget`)
12. Test the full lifecycle: init → launch → active memory → session end → sleep compute
13. Create a sample Bertram personality for Michael to customize

## Key Technical Decisions

- **AI-only pipeline**: All memory operations are handled by background subagents, not TypeScript scripts. The agents read/write markdown files using Read, Write, Edit, Glob, Grep tools.
- **Markdown with frontmatter**: All memory blocks use YAML frontmatter for metadata (type, confidence, tags, timestamps). Git-friendly, Claude-native.
- **CLAUDE.md @imports**: The per-teammate CLAUDE.md uses @import syntax to load personality, shared knowledge, and core memories.
- **`--add-dir` loading**: The launcher sets `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` so the persona's CLAUDE.md is loaded as system prompt.
- **Env var gating**: `AI_MEMORY_PERSONA` env var is set by launcher. `scripts/session-end.sh` exits immediately when it is missing and prevents recursion by clearing it before spawning sleep compute.
- **Transcript strictness**: `scripts/session-end.sh` requires hook-provided `transcript_path` by default. Optional fallback to latest transcript is controlled by `AI_MEMORY_ALLOW_TRANSCRIPT_FALLBACK=1`.
- **No external dependencies**: Pure markdown files + shell scripts + agent markdown files. No bun, no API keys, no databases.

## Important References

- Claude Code sub-agents: https://code.claude.com/docs/en/sub-agents.md
- Claude Code memory: https://code.claude.com/docs/en/memory
- Existing agents to learn from: `~/.claude/agents/remember.md`, `~/.claude/agents/recall.md`
- Existing hook patterns: `~/.claude/settings.json` (SessionStart, Stop, SessionEnd hooks)
- Existing skill examples: `~/.claude/skills/chronicle/SKILL.md`, `~/.claude/skills/skill-builder/SKILL.md`

## Style Notes

- This is Michael's `~/.claude` — a public repo. No secrets, no personal data in committed files.
- Apache 2.0 license on all skills
- Prefer concise, well-typed code. "Code can be poetry."
- Shell scripts should be POSIX-compatible where possible, bash where necessary
- Agent markdown files should have clear YAML frontmatter (name, description, tools, model)
- Use the `skill-builder` skill when creating SKILL.md to ensure it follows conventions
