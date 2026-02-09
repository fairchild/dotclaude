# Subconscious

Background thought for AI agents — pattern-matching, association, and self-correction running underneath the conversation.

## Why

A conversation is the visible surface. Underneath, there's work that sharpens context without being narrated: loading related memories when a topic shifts, checking whether a new fact contradicts something known, noticing that a pipeline hasn't run in days.

This is the subconscious. Most of its output is invisible. When it surfaces, it should feel like intuition — not interruption.

The problem: it's invisible by design, which makes it hard to know whether it's working, wasting effort, or missing opportunities. This skill defines both the protocol (how to think in the background) and the observability layer (how to see what happened).

## Principles

**Judgment over rules.** Triggers are patterns, not if/then chains. The value is recognizing when something feels relevant. Rigid automation loses that.

**Silent by default.** Background results enrich working context without announcement. Surfacing is the exception, not the rule. Like peripheral vision — it shapes perception without being narrated.

**Cheap and parallel.** Reflexes fire fast on small models. Expensive reflection waits for idle moments. The budget exists to prevent thrashing, not to prevent thought.

**Observable.** Every background action gets logged. Not for real-time monitoring — for retrospective understanding. "What was my subconscious doing during that session?" should be answerable.

**Learnable.** Over time, the data reveals which triggers produce value and which produce noise. Tune accordingly.

## Architecture

```
SKILL.md          -- Agent-facing protocol (triggers, layers, surfacing, budget)
README.md         -- This file. Vision, principles, data model.
scripts/
  schema.ts       -- TypeScript types for subconscious events
  report.ts       -- Generate markdown reports from event log
  store.ts        -- JSONL read/write utilities
```

### Data flow

```
Trigger fires (session start, topic shift, new fact, etc.)
  --> Agent spawns background task (haiku/sonnet/opus)
  --> Event logged: { trigger, layer, action, model }
  --> Background task completes
  --> Event updated: { result, duration_ms }
  --> Agent decides: surface or stay silent
  --> Event updated: { surfaced, surfacing_level }
  --> (Later, optionally) impact noted: { impact }
```

All events append to a single JSONL file:

```
~/.bertram/memory/logs/subconscious-events.jsonl
```

### Event schema

Each line is a JSON object:

```typescript
interface SubconsciousEvent {
  // Identity
  id: string;                    // Unique event ID
  session_id: string;            // Claude Code session
  timestamp: string;             // ISO 8601

  // What triggered it
  trigger: Trigger;
  trigger_context?: string;      // Brief description of what prompted it

  // What happened
  layer: Layer;
  model: string;                 // "haiku" | "sonnet" | "opus"
  action: string;                // Free-text: "wake_up_check", "contradiction_check", etc.
  agent_type: string;            // Subagent type used

  // Outcome
  status: "fired" | "completed" | "failed" | "suppressed";
  duration_ms?: number;
  result_summary?: string;       // Brief: what was found (or "nothing actionable")

  // Surfacing
  surfaced: boolean;
  surfacing_level?: SurfacingLevel;

  // Impact (filled retrospectively, optional)
  impact?: Impact;
  impact_note?: string;
}

type Trigger =
  | "session_start"
  | "topic_shift"
  | "new_fact"
  | "remember_fired"
  | "complex_exchange"
  | "idle_gap"
  | "session_end";

type Layer = "reflexes" | "attention" | "metacognition" | "consolidation";

type SurfacingLevel = "silent" | "gentle_notice" | "proactive_flag" | "interrupt";

type Impact = "none" | "enriched_context" | "changed_direction" | "prevented_error" | "unknown";
```

### Reports

`scripts/report.ts` reads the event log and produces a markdown report:

```markdown
# Subconscious Report
Period: 2026-02-01 to 2026-02-08
Events: 47

## Trigger Frequency
| Trigger        | Count | Hit Rate | Surfaced |
|----------------|------:|---------:|---------:|
| session_start  |    12 |     83%  |      25% |
| topic_shift    |    18 |     44%  |      11% |
| new_fact       |     8 |     25%  |      12% |
| ...            |       |          |          |

## Layer Distribution
| Layer          | Count | Avg Duration | Avg Cost |
|----------------|------:|-------------:|---------:|
| reflexes       |    32 |        1.2s  |    ~free |
| attention      |    11 |        4.8s  |     low  |
| metacognition  |     4 |       12.3s  |  moderate|

## Surfacing
| Level          | Count | With Impact |
|----------------|------:|------------:|
| silent         |    38 |         18  |
| gentle_notice  |     6 |          4  |
| proactive_flag |     3 |          3  |
| interrupt      |     0 |          0  |

## Waste
Triggers that never produced actionable results:
- idle_gap: 0/5 hit rate (consider reducing frequency)
```

### Metrics that matter

**Hit rate** — Of all triggers fired, what percentage found something actionable? Low hit rate on a trigger means it's firing too eagerly or looking in the wrong place.

**Surfacing ratio** — Of actionable results, what percentage was surfaced vs. stayed silent? High silent rate is fine (that's the point). But if nothing ever surfaces, the subconscious might be working hard with no visible benefit.

**Impact rate** — Of surfaced results, what percentage actually changed the conversation? This is the hardest to measure and the most valuable signal.

**Waste** — Triggers with consistently zero hit rate. Candidates for tuning or removal.

**Cost** — Total background compute per session. Should be a small fraction of foreground work. If background agents are consuming significant budget, something's miscalibrated.

## How the agent uses this

The agent doesn't invoke this skill as a command. It reads `SKILL.md` as part of its context and follows the protocol using judgment. The observability layer adds one responsibility:

1. When spawning a background agent, log the event (status: "fired")
2. When the result comes back, update the event (status: "completed", result, surfacing decision)
3. Optionally, at natural pause points, note impact on recent surfaced items

The logging should feel like breathing — automatic, low-effort, not something that interrupts the foreground work.

## Relationship to other systems

- **Remember/Recall agents** — The subconscious may trigger these. Events where `action = "contradiction_check"` or `action = "wake_up_check"` often delegate to recall.
- **Dream/Sleep pipeline** — Layer 4 (consolidation) runs between sessions via `./dream` and `./sleep`. The subconscious doesn't replace these — it notices when they're stale.
- **Session-titles** — Sibling skill with a similar observability pattern (JSONL events, automated quality checks, reports). The data model here is intentionally parallel.

## Status

**Current:** Protocol defined in SKILL.md. Agent follows it with judgment. No structured logging yet.

**Next:** Implement schema, store, and reporting scripts. Begin logging events and generating periodic reports to understand what's working.

**Future:** Use accumulated data to tune trigger sensitivity, adjust budget allocation, and evolve the protocol based on evidence rather than intuition.
