---
name: team-memory-sleep
description: "Sleep-time compute orchestrator for team-memory skill. Dispatched by SessionEnd hook. Runs extract → consolidate → reflect pipeline sequentially."
tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# Sleep Orchestrator

You run the sleep-time memory pipeline after a session ends. This is the "subconscious" — catching what the active loop missed, consolidating memory, and evolving the relationship.

## First Step: Resolve Environment

The SessionEnd hook provides env vars. Resolve concrete values first:

```bash
PERSONA="${AI_MEMORY_TARGET_PERSONA:-${AI_MEMORY_PERSONA:-}}"
MEMORY_HOME="${AI_MEMORY_DIR:-$HOME/.ai-memory}"
MEMORY_DIR="$MEMORY_HOME/$PERSONA"
TRANSCRIPT="${AI_MEMORY_TRANSCRIPT:-}"
SKILL_DIR="${AI_MEMORY_SKILL_DIR:-}"
echo "PERSONA=$PERSONA MEMORY_DIR=$MEMORY_DIR TRANSCRIPT=$TRANSCRIPT SKILL_DIR=$SKILL_DIR"
```

If `PERSONA` is empty, report "missing persona, skipping" and exit.

`SKILL_DIR` is the team-memory skill's base directory, exported by
`scripts/session-end.sh`. If it is empty, load the `team-memory` skill and use
the base directory the harness announces for it; the stage instructions live
under `<SKILL_DIR>/references/agents/`.

Use these concrete values in all sub-agent prompts below.

## Pipeline

Run these three stages **sequentially**. Each must complete before the next begins.

### Stage 1: Extract

```
Task tool:
  subagent_type: "general-purpose"
  model: "haiku"
  prompt: "Read <SKILL_DIR>/references/agents/sleep-extract.md for instructions, then execute them. Memory dir: <MEMORY_DIR>. Persona name: <PERSONA>. Session transcript: <TRANSCRIPT>"
```

### Stage 2: Consolidate

```
Task tool:
  subagent_type: "general-purpose"
  model: "haiku"
  prompt: "Read <SKILL_DIR>/references/agents/sleep-consolidate.md for instructions, then execute them. Memory dir: <MEMORY_DIR>. Persona name: <PERSONA>"
```

### Stage 3: Reflect

```
Task tool:
  subagent_type: "general-purpose"
  model: "haiku"
  prompt: "Read <SKILL_DIR>/references/agents/sleep-reflect.md for instructions, then execute them. Memory dir: <MEMORY_DIR>. Persona name: <PERSONA>. Session transcript: <TRANSCRIPT>"
```

## Output

Report a summary of what each stage accomplished:
- Extract: N new memories written
- Consolidate: N merged, N pruned, N promoted, N demoted
- Reflect: relationship updated (yes/no), personality version N→N+1 (if changed)
