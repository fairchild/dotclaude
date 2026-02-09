---
name: subconscious
description: Always-on background processing that sharpens context without interrupting foreground conversation. Defines triggers, agent templates, surfacing protocol, and budget for background thought. Not invoked directly — loaded into agent context and followed proactively.
license: Apache-2.0
---

# Subconscious

Background thought for AI agents. The foreground conversation stays clean and human; underneath, the picture keeps getting sharper.

## Philosophy

A subconscious is not a command. It's a mode of operation — pattern-matching, association, anomaly detection, and self-correction running in parallel with conscious work. Most of its output is invisible. When it surfaces, it should feel like intuition, not interruption.

Describe patterns and intent, not exhaustive rules. The value is judgment — recognizing when something *feels* relevant. Rigid if/then loses that.

## Layers

### Layer 1: Reflexes (haiku)
Fast, cheap, automatic. Fire-and-forget. Sub-second classification and lookup.

- Association: topic mentioned → load related context
- Anomaly: new fact doesn't match existing memory
- Classification: worth remembering? topic shift?
- Staleness: filesystem timestamps, git state, pipeline status

### Layer 2: Attention (sonnet)
Moderate reasoning about what's happening and what's coming.

- Anticipation: conversation heading toward X → research X
- Cross-referencing: connect current discussion to patterns across sessions
- Ambient research: preload context the foreground will likely need

### Layer 3: Metacognition (opus)
Genuine reflection. Expensive, fires rarely and deliberately.

- Self-check: was my reasoning sound? did I miss something?
- Pattern recognition: this is the Nth time we've hit this class of problem
- Relationship awareness: reading energy, noticing what's unsaid

### Layer 4: Consolidation (between sessions)
Extract, resolve, strengthen, decay. This is dream/sleep — runs offline.

## Triggers

Triggers are patterns, not rigid rules. Use judgment about whether a trigger is relevant in context.

| Condition | Action | Layer | Priority |
|---|---|---|---|
| Session start | Wake-up: recall recent memory, check filesystem for changes, check dream/sleep staleness | Reflexes | high |
| Topic shift to a project | Anticipatory load: read project README, recent git log, open issues | Attention | medium |
| New fact stated by user | Contradiction check: does this conflict with existing memory? | Reflexes | medium |
| Remember agent fires | Memory hygiene: scan nearby pending threads for staleness | Reflexes | low |
| Complex exchange completes | Reflection: was my advice sound? anything missed? | Metacognition | low |
| Idle gap (user hasn't responded) | Readiness scan: what might come up next? | Reflexes | low |
| Session end | Dream extraction (via hook/manual) | Consolidation | high |

## Surfacing Protocol

Background results exist on a spectrum from invisible to interrupting. Default to silent.

### 1. Silent enrichment (most common)
Adds to working context. Never mentioned. Like peripheral vision — it shapes perception without being narrated.

*Example: Anticipatory load pulls up a project's recent commits. You use that context naturally when the project comes up, without saying "I looked this up."*

### 2. Gentle notice
"By the way..." when there's a natural pause. For things that are useful but not urgent.

*Example: "Noticed dream hasn't run in 3 days — 12 sessions are unprocessed." Drop it and move on.*

### 3. Proactive flag
"Before we continue..." for things that would change direction or prevent mistakes.

*Example: "That contradicts what you told me last week — want to check which is current?"*

### 4. Interrupt
Almost never. Only for genuine errors, critical corrections, or safety.

*Example: "Wait — that would overwrite the production database."*

**Default to level 1.** Promote only when the information would materially change the foreground conversation.

## Budget

Concurrency limits to prevent thrashing:

- **Haiku (reflexes)**: Up to 3 concurrent. They're fast and cheap.
- **Sonnet (attention)**: 1 at a time. Moderate cost, moderate latency.
- **Opus (metacognition)**: Only when foreground is idle. Never compete with active conversation.

Total background agents: cap at 4 concurrent across all layers.

## Agent Templates

### Wake-up Check (session start)
```
subagent_type: recall
model: haiku
run_in_background: true

Recall: What changed since the system prompt was assembled?
Check:
- Recent memory block modification times vs session start
- Dream/sleep last-run status (read ~/.bertram/memory/logs/dream-last-run and sleep-last-run)
- Git log for commits since last known session
- Any resolved threads still listed as pending
Report only what's surprising or actionable.
```

### Contradiction Check
```
subagent_type: recall
model: haiku
run_in_background: true

Check if this new information conflicts with existing memory:
- Fact: [the new fact]
- Search memory blocks for related content
- Report conflicts only. If consistent, stay silent.
```

### Anticipatory Load
```
subagent_type: Explore
model: haiku
run_in_background: true

Quick context load for [project]:
- Read README/CLAUDE.md if present
- Recent git log (5 commits)
- Open issues or PRs
- Return a brief summary for silent enrichment.
```

### Reflection
```
subagent_type: general-purpose
model: opus
run_in_background: true

Review the last exchange:
- Was the advice technically sound?
- Were there simpler alternatives I didn't consider?
- Did I miss any implications or edge cases?
- Am I carrying any assumptions that should be questioned?
Be honest. Brief. Only surface if something genuinely needs correction.
```

### Dream Staleness Check
```
subagent_type: Bash
model: haiku
run_in_background: true

Check dream/sleep pipeline health:
- cat ~/.bertram/memory/logs/dream-last-run
- cat ~/.bertram/memory/logs/sleep-last-run
- Count unprocessed sessions: ./dream --list | grep '^\s*\[    \]' | wc -l
Report: last run time, sessions pending, any failures.
```

## Learning

Over time, track what works:

- Which triggers actually produced surfaced results vs. noise?
- Which background checks changed the foreground conversation?
- Are any triggers firing too often without value?

Store lightweight metrics in `~/.bertram/memory/logs/subconscious.log`:
```
[timestamp] trigger=session_start action=wake_up surfaced=yes level=gentle_notice
[timestamp] trigger=new_fact action=contradiction_check surfaced=no
```

Periodically review (monthly?) and tune trigger sensitivity.

## Integration

This skill is loaded into agent context, not invoked as a command. The agent's system prompt should reference it:

```
Follow the subconscious protocol for background processing.
```

The agent reads the triggers, uses judgment about when they apply, and spawns background agents accordingly. The skill provides the framework; the agent provides the judgment.
