---
name: team-memory
description: "Persistent AI teammate memory framework. Gives Claude Code agents persistent memory, evolving personality, and teammate-like behavior across sessions. Use when setting up personality.md injection, durable memory blocks in ~/.ai-memory, session start/end memory workflows, recall/remember/consolidate scripts, or packaging a distributable memory skill profile."
license: Apache-2.0
---

# Team Memory

Persistent memory and evolving personality for AI teammates.

## Usage

```
/team-memory init <name>       # Bootstrap a new teammate
/team-memory list              # Show all teammates
/team-memory switch <name>     # Set active teammate
/team-memory status            # Memory stats for active teammate
/team-memory status <name>     # Memory stats for specific teammate
/team-memory consolidate       # Run consolidation on demand
/team-memory forget <query>    # Find and remove matching memories
```

## Verification

Run regression smoke checks:

```bash
bash ~/.claude/skills/team-memory/tests/regression.sh
```

Transcript fallback behavior:
- Default: SessionEnd requires hook-provided `transcript_path` (safer under concurrency)
- Optional fallback: set `AI_MEMORY_ALLOW_TRANSCRIPT_FALLBACK=1`

## Init (`/team-memory init <name>`)

Bootstrap a new AI teammate:

```bash
bash ~/.claude/skills/team-memory/scripts/init.sh <name>
```

This creates:
- `~/.ai-memory/<name>/` with CLAUDE.md, personality.md, relationship.md
- `~/.ai-memory/<name>/core/` — always-loaded memory blocks
- `~/.ai-memory/<name>/archival/` — searchable deep storage
- `~/.ai-memory/<name>/recall/` — session summaries
- `~/.ai-memory/shared/` — cross-teammate knowledge (if first teammate)
- SessionEnd hook for sleep-time compute

After init, edit:
1. `~/.ai-memory/<name>/personality.md` — define the teammate's identity
2. `~/.ai-memory/shared/projects.md` — add project context (first teammate only)

For the full walkthrough, see [`references/add-teammate.md`](references/add-teammate.md).

## Launch

Launch Claude with a teammate personality:

```bash
~/.claude/skills/team-memory/scripts/launch.sh                    # active teammate
~/.claude/skills/team-memory/scripts/launch.sh --persona <name>   # specific teammate
~/.claude/skills/team-memory/scripts/launch.sh --persona <name> ~/code/project
```

Recommended alias:
```bash
alias claude-memory='~/.claude/skills/team-memory/scripts/launch.sh'
alias claude-bertram='~/.claude/skills/team-memory/scripts/launch.sh --persona bertram'
```

## List (`/team-memory list`)

Show all teammates in `~/.ai-memory/`:

```bash
ls -1 ~/.ai-memory/ | grep -v shared | grep -v active
```

Show which is active:
```bash
readlink ~/.ai-memory/active
```

## Switch (`/team-memory switch <name>`)

Update the active teammate symlink:

```bash
ln -sfn <name> ~/.ai-memory/active
```

## Status (`/team-memory status [name]`)

Show memory statistics for a teammate:
- Count of core/ blocks
- Count of archival/ blocks
- Count of recall/ summaries
- Confidence distribution across blocks
- Last consolidation date
- Personality version

```bash
PERSONA="${1:-$(readlink ~/.ai-memory/active)}"
echo "Teammate: $PERSONA"
echo "Core blocks: $(ls ~/.ai-memory/$PERSONA/core/*.md 2>/dev/null | wc -l)"
echo "Archival blocks: $(ls ~/.ai-memory/$PERSONA/archival/*.md 2>/dev/null | wc -l)"
echo "Session recalls: $(ls ~/.ai-memory/$PERSONA/recall/*.md 2>/dev/null | wc -l)"
```

## Consolidate (`/team-memory consolidate`)

Run the consolidation pipeline on demand (normally runs at session end):

Dispatch the sleep-consolidate agent:
```
Task tool:
  subagent_type: "general-purpose"
  prompt: "Read ~/.claude/skills/team-memory/references/agents/sleep-consolidate.md and execute. Persona: <name>, Memory dir: <MEMORY_DIR>/<name>"
```

## Forget (`/team-memory forget <query>`)

Search for and remove matching memories:

1. Search archival/ and core/ for blocks matching the query
2. Show matches to the user for confirmation
3. Delete confirmed blocks

Never delete without user confirmation.

## Architecture

### Memory Hierarchy

| Tier | Location | Loading | Purpose |
|------|----------|---------|---------|
| Core | `core/` | @imported in CLAUDE.md | Key decisions, proven patterns, critical preferences |
| Archival | `archival/` | Searched on demand | Session insights, observed patterns, debugging discoveries |
| Recall | `recall/` | Searched on demand | Session summaries, open threads |

### Two Memory Loops

**Active (during session)**: The teammate's CLAUDE.md instructs it to dispatch background `remember` and `recall` agents when encountering decisions, patterns, or needing prior context.

**Passive (session end)**: SessionEnd hook fires the sleep pipeline:
1. **Extract** — find memories the active loop missed in the transcript
2. **Consolidate** — merge duplicates, apply confidence decay, promote/demote
3. **Reflect** — evolve relationship.md and mutable personality sections

### Memory Block Format

```markdown
---
type: decision|pattern|insight|preference|fact
confidence: 0.0-1.0
source: user|session|consolidation|promotion
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [topic, project]
project: optional
---

Concise memory content with enough context to be useful
without the original conversation.
```

### Staleness

Blocks not updated in 30+ days lose 0.1 confidence (facts exempt).
Blocks below 0.3 confidence are pruned during consolidation.
Blocks that stay relevant get refreshed by merges and re-references.

## Sample Personalities

A sample Bertram personality is available at:
`~/.claude/skills/team-memory/references/sample-bertram-personality.md`

Copy and customize for your teammate.
