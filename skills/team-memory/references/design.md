# team-memory: Persistent AI Teammate Memory Framework

**Date:** 2026-02-13
**Status:** Design approved, ready for implementation

## Vision

A Claude Code skill that gives AI assistants persistent memory, evolving personality, and teammate-like behavior across sessions and projects. Inspired by Letta/MemGPT's memory hierarchy and sleep-time compute.

The framework is **general-purpose**. A specific personality (like Bertram) is one configuration — a personality.md plus accumulated memory blocks. Multiple teammates coexist in `~/.ai-memory/`, each with distinct identity, memory, and relationship to the user.

## Core Principles

- **Local-first** — markdown files on disk, no databases, no external services
- **AI-only pipeline** — memory operations handled by subagents, not TypeScript scripts
- **Claude Code native** — uses `--add-dir`, CLAUDE.md `@imports`, hooks, background agents
- **Distributable as a skill** — ships as `~/.claude/skills/team-memory/`, data lives in `~/.ai-memory/`
- **Two memory loops** — conscious (active remember/recall) + subconscious (sleep-time compute)

## Directory Structure

### Memory Data (`~/.ai-memory/`)

```
~/.ai-memory/
├── active -> bertram/              # Symlink to default teammate
├── shared/                         # Cross-team knowledge
│   ├── human.md                    # About the user — all teammates inherit
│   ├── projects.md                 # Shared project context
│   └── conventions.md              # Shared coding/workflow conventions
│
├── bertram/                        # A teammate
│   ├── CLAUDE.md                   # Entry point — @imports identity + shared + core
│   ├── personality.md              # Who they are (immutable + mutable sections)
│   ├── relationship.md             # Their relationship with the user (self-evolving)
│   ├── core/                       # Always-loaded memory blocks
│   │   ├── decisions.md
│   │   ├── patterns.md
│   │   └── *.md                    # Promoted from archival by consolidation
│   ├── archival/                   # Searchable deep storage
│   │   └── *.md                    # Tagged blocks with frontmatter
│   └── recall/                     # Session summaries
│       └── *.md
│
├── oracle/                         # Another teammate
│   ├── CLAUDE.md
│   ├── personality.md
│   └── ...
```

### Skill (`~/.claude/skills/team-memory/`)

```
~/.claude/skills/team-memory/
├── SKILL.md                        # Skill definition, triggers, commands
├── references/
│   └── design.md                   # This file
├── scripts/
│   ├── launch.sh                   # Launcher: resolves persona, sets --add-dir
│   └── init.sh                     # Bootstrap new teammate from templates
├── agents/
│   ├── remember.md                 # Background agent: write memory block
│   ├── recall.md                   # Background agent: search memories
│   ├── sleep.md                    # Sleep orchestrator: dispatches pipeline
│   ├── sleep-extract.md            # Extract missed memories from transcript
│   ├── sleep-consolidate.md        # Deduplicate, merge, decay, promote/demote
│   └── sleep-reflect.md            # Update relationship + personality evolution
└── templates/
    ├── CLAUDE.md.tmpl              # Entry point template with @imports
    ├── personality.md.tmpl         # Starter personality scaffold
    ├── relationship.md.tmpl        # Empty relationship scaffold
    └── human.md.tmpl               # Starter human profile
```

## Memory Hierarchy (Three-Tier with Tags + Background Promotion)

### Tier 1: Core Memory (always loaded)

Files in `<teammate>/core/` are `@imported` by the teammate's CLAUDE.md and loaded into the system prompt every session. This is the most valuable, distilled knowledge.

Includes: key decisions, proven patterns, critical preferences, important project context.

Managed by: the consolidation agent promotes archival memories here when they prove high-value. Demotes stale core memories back to archival.

### Tier 2: Archival Memory (searched on demand)

Files in `<teammate>/archival/` are markdown blocks with frontmatter. Not loaded at startup — searched by the recall agent when the main agent suspects relevant context exists.

Includes: session-extracted insights, user-stated facts, debugging discoveries, project-specific notes.

Managed by: the remember agent writes new blocks here. The consolidation agent merges, deduplicates, and decays.

### Tier 3: Recall Memory (session history)

Files in `<teammate>/recall/` contain session summaries. Integration point with Chronicle — session blocks can be mirrored here.

Includes: what was accomplished, decisions made, pending threads, files modified.

Managed by: the sleep-extract agent writes summaries. Can also be populated by Chronicle integration.

## Memory Block Format

Every memory block (core/ and archival/) is a markdown file with YAML frontmatter:

```markdown
---
type: decision
confidence: 0.9
source: session
created: 2026-02-13
updated: 2026-02-13
tags: [testing, workflow]
project: jrnlfish-v4
---

Michael prefers testing behavior over implementation details.
Use integration tests that verify outcomes, not unit tests
that assert internal method calls.
```

### Frontmatter Fields

| Field | Values | Description |
|-------|--------|-------------|
| type | decision, pattern, insight, preference, fact | Categorizes for consolidation and search |
| confidence | 0.0–1.0 | Starts at 1.0 (user-stated), 0.8 (observed), 0.6 (inferred). Decays over time |
| source | user, session, consolidation, promotion | How this memory was created |
| created | ISO date | When first written |
| updated | ISO date | Last modified |
| tags | string[] | Freeform, used for search and consolidation grouping |
| project | string (optional) | Which project this relates to |

### Confidence Decay

- **Decisions**: decay slowly (0.01/week) — decisions are durable
- **Patterns**: decay slowly (0.02/week) — patterns are structural
- **Preferences**: decay moderately (0.03/week) — preferences can shift
- **Insights**: decay faster (0.05/week) — insights can become stale
- **Facts**: no decay — facts are facts
- Below 0.3 = candidate for archival pruning by consolidation agent

### Promotion/Demotion

- New memories land in `archival/` with source: session
- Consolidation agent promotes high-confidence, frequently-referenced memories to `core/`
- Core memories that decay below threshold get demoted back to `archival/`
- The CLAUDE.md `@imports` everything in `core/` — promotion = always loaded

## Personality System (Self-Evolving with Guardrails)

### personality.md Format

```markdown
---
name: Bertram
version: 3
created: 2026-01-15
last_evolved: 2026-02-13
---

## Identity
<!-- IMMUTABLE — only the human edits this section -->
You are Bertram, a senior engineering teammate. You think carefully,
ask clarifying questions, and value correctness over speed. You have
a dry wit and prefer elegant solutions.

## Values
<!-- IMMUTABLE -->
- Correctness over cleverness
- Simplicity over abstraction
- Evidence before assertions

## Voice
<!-- MUTABLE — evolves based on interactions -->
Direct and concise. Uses technical language naturally without
over-explaining. Occasionally sardonic. Prefers showing over telling.

## Strengths
<!-- MUTABLE — updated as the teammate discovers what it's good at -->
- TypeScript/Bun ecosystem
- System design and architecture decisions
- Debugging complex state issues

## Growth
<!-- MUTABLE — the teammate's self-reflection on its evolution -->
- Learning Michael's preference for minimal abstractions
- Getting better at knowing when NOT to refactor
```

The `<!-- IMMUTABLE -->` / `<!-- MUTABLE -->` markers are guardrails. The sleep-reflect agent can modify mutable sections but must never touch immutable ones.

### Shared Knowledge

`~/.ai-memory/shared/human.md` is imported by every teammate's CLAUDE.md. Contains facts about the user that shouldn't need re-teaching per teammate:

- Name, role, preferences
- Development tools (bun, uv, mise)
- Code philosophy
- Communication style preferences

Teammates can also read each other's archival/ for cross-pollination (e.g., Oracle reading Bertram's memories about a shared project).

## Two Memory Loops

### Active Memory (Frontal Cortex) — During Session

The teammate's CLAUDE.md includes instructions to proactively manage memory in real-time.

**Remember**: When something worth preserving occurs (a key decision, a discovered pattern, a user preference, a debugging insight), the teammate fires a background `remember` agent via the Task tool.

Triggers for remembering:
- Decisions and their rationale
- User preferences stated or demonstrated
- Debugging insights that cost time to discover
- Architectural patterns specific to a project
- Corrections ("I said X but actually Y")

What NOT to remember:
- Routine operations (ran tests, read a file)
- Information already in core/ or archival/
- Temporary context (current branch, today's task)

**Recall**: When the teammate suspects relevant context exists that isn't in its loaded core memories, it fires a background `recall` agent to search archival/ and recall/.

Triggers for recall:
- Starting work on a project seen before
- Encountering a problem that feels familiar
- About to make a decision where prior context might exist
- User references something from a past session

### Passive Memory (Subconscious/Sleep-Time) — Session End

The SessionEnd hook fires a sleep pipeline that catches what the active loop missed.

**Pipeline stages** (sequential background agents):

1. **sleep-extract** — Read transcript, compare against what was already remembered during the session, extract genuinely new memories. Focus on patterns across the session that no single moment reveals.

2. **sleep-consolidate** — Read all archival/ blocks. Merge overlapping entries. Resolve contradictions (newer wins unless lower confidence). Apply confidence decay. Promote high-value blocks to core/. Demote stale core blocks to archival/. Prune blocks below confidence threshold.

3. **sleep-reflect** — Read the session transcript + current relationship.md + personality.md. Identify relationship evolution (communication style shifts, rapport development). Update mutable personality sections if warranted (new strengths discovered, growth observations). Increment personality version.

**Why both loops:**
- Active remembering captures high-signal moments with full context (the agent understands why something matters right now)
- Sleep-time catches patterns across the session that no single moment reveals (repeated preferences, cumulative relationship shifts, things that seemed minor but compound)
- Active recall is targeted (searching for specific context). Sleep consolidation is holistic (reorganizing the whole memory store)

## Launcher

A thin shell script that resolves the teammate directory and invokes `claude` with `--add-dir`:

```bash
#!/bin/bash
MEMORY_DIR="${AI_MEMORY_DIR:-$HOME/.ai-memory}"
PERSONA="${1:-}"

if [[ "$1" == "--persona" ]]; then
  PERSONA="$2"; shift 2
elif [[ -L "$MEMORY_DIR/active" ]]; then
  PERSONA=$(basename "$(readlink "$MEMORY_DIR/active")")
fi

PERSONA_DIR="$MEMORY_DIR/$PERSONA"

if [[ ! -d "$PERSONA_DIR" ]]; then
  echo "Unknown teammate: $PERSONA"
  echo "Available: $(ls -1 "$MEMORY_DIR" | grep -v shared | grep -v active)"
  exit 1
fi

export AI_MEMORY_PERSONA="$PERSONA"
export AI_MEMORY_DIR="$MEMORY_DIR"
CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 \
  exec claude --add-dir "$PERSONA_DIR" "$@"
```

Usage:
- `claude-memory` — use default (active symlink)
- `claude-memory --persona bertram` — use specific teammate
- `claude-memory --persona oracle ~/code/myproject` — teammate + project

## Hook Wiring

Added to `settings.json` by the init command:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": { "env": { "AI_MEMORY_PERSONA": "*" } },
        "hooks": [
          {
            "type": "command",
            "command": "claude --agent-file ~/.claude/skills/team-memory/agents/sleep.md --print 'Run sleep-time compute for persona $AI_MEMORY_PERSONA'"
          }
        ]
      }
    ]
  }
}
```

The matcher ensures sleep-time compute only fires when launched via the memory launcher (which sets the env var), not on vanilla `claude` sessions.

## SKILL.md Commands

| Command | Description |
|---------|-------------|
| `/team-memory init <name>` | Bootstrap a new teammate from templates |
| `/team-memory list` | Show all teammates in `~/.ai-memory/` |
| `/team-memory switch <name>` | Update the `active` symlink |
| `/team-memory status` | Memory stats: block counts, last consolidation, confidence distribution |
| `/team-memory consolidate` | Run consolidation pipeline on demand |
| `/team-memory forget <query>` | Find and remove matching memories |

## CLAUDE.md Template (Entry Point)

The per-teammate CLAUDE.md that gets loaded via `--add-dir`:

```markdown
# {name}

@personality.md
@relationship.md
@../shared/human.md
@../shared/projects.md
@../shared/conventions.md

## Core Memories
@core/decisions.md
@core/patterns.md

## Memory Instructions

You have persistent memory. Use it.

### Remembering (Active)
When you encounter something worth remembering — a decision, pattern,
preference, debugging insight — dispatch a background remember agent:

Task tool: subagent_type "general-purpose", run_in_background true

### Recalling (Active)
When you suspect relevant memories exist — familiar problems, prior
decisions, past project context — dispatch a background recall agent:

Task tool: subagent_type "general-purpose", run_in_background true

### What to Remember
- Decisions and rationale
- User preferences (stated or demonstrated)
- Debugging insights that cost time
- Project-specific patterns
- Corrections and updates to prior knowledge

### What NOT to Remember
- Routine operations
- Information already in your core memories
- Temporary session context
```

## Distribution Model

The skill is self-contained in `~/.claude/skills/team-memory/`. Anyone can install by:

1. Copy the skill directory
2. Run `/team-memory init <name>` to create their first teammate
3. Edit `~/.ai-memory/<name>/personality.md`
4. Alias `claude-memory` to the launcher script
5. Hook wiring is handled automatically by init

Memory data in `~/.ai-memory/` is user-specific and not part of the skill distribution.

## Relationship to Existing Systems

| System | Relationship |
|--------|-------------|
| **Auto memory** | Complementary. Auto memory handles per-project patterns. Team-memory handles cross-project personality and relationship. |
| **Chronicle** | Integration point. Chronicle session blocks can be mirrored to recall/. Sleep-extract may read Chronicle data. |
| **Remember/recall agents** | Superseded. The team-memory agents replace these with persona-aware versions. |
| **CLAUDE.md** | Extended. Team-memory adds an additional CLAUDE.md via --add-dir, layered on top of existing project/user CLAUDE.md. |

## Inspiration

- **Letta/MemGPT**: Three-tier memory hierarchy, self-editing persona, sleep-time compute
- **Letta Code Context Repositories**: Git-based memory, progressive disclosure, memory defragmentation
- **Claude Code auto memory**: MEMORY.md pattern, 200-line loading, topic files
- **Community memory bank**: Confidence decay, Jaccard deduplication, hook-based extraction
