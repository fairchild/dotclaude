---
arc: memory-loop-quality
priority: 3
timeout: 30d
ready-for-human: a direction decision — do the three memory systems unify under one surface, or stay independent with clear boundaries? Needs Michael's call before any consolidation work.
---

# Memory systems coherence

## Problem

Three memory systems are in active, overlapping development in this repo, and there is no single place that says how they relate or which is canonical for what:

- **chronicle** — per-session continuity for coding work (blocks, catchup, pending, recap). Session-scoped, project-keyed.
- **team-memory** — persistent AI-teammate memory: personality injection, durable blocks in `~/.ai-memory`, session-start/end workflows.
- **persona-memory** (a.k.a. auto-memory) — persona + durable memory framework, also session-start/end, also `~/.ai-memory`-shaped.

team-memory and persona-memory in particular look like near-duplicates of the same idea (durable blocks + personality + start/end hooks), while chronicle occupies a different altitude (session traces rather than persona). The overlap has been showing up as stale pending items in chronicle (`Decision on whether auto-memory and team-memory should unify with chronicle or remain independent surfaces`) with no owning artifact, so it ages silently instead of being decided.

This matters for Principle #1 (every session sharpens the next): three partial memory surfaces that don't compose means traces land in different stores and recall is fragmented.

## The decision

Pick a direction before doing any consolidation work:

1. **Unify** — one memory surface, the others become views or are absorbed. Highest coherence, most migration cost.
2. **Bounded independence** — keep them separate but write down the boundary: chronicle = session traces, one of {team-memory, persona-memory} = durable persona/facts, and retire or merge the redundant third. Lower cost, requires naming the canonical store per concept (Principle #6).
3. **Status quo** — accept the overlap as parallel experiments (Principle #2, adventure). Cheapest, but the fragmentation persists.

## Phases (after the decision)

This task's first deliverable is the decision itself, captured here and reflected in `ROADMAP.md`. Only then:

- **Phase 1** — write the boundary doc: what each system owns, where its data lives, which hooks it runs. One table, inspectable in place.
- **Phase 2** — if unify/merge: identify the redundant surface and plan its absorption or retirement (data migration from `~/.ai-memory`, hook dedup at session start/end).
- **Phase 3** — collapse the duplicated session-start/end hook wiring so only the canonical store(s) run.

## Acceptance

- [ ] A direction (1/2/3) is chosen and recorded above with a one-line rationale.
- [ ] `ROADMAP.md` `memory-loop-quality` arc names the coherence decision and its outcome.
- [ ] If consolidation is chosen, a boundary doc exists naming the canonical store per concept.
- [ ] The two stale chronicle pending items about memory-system unification can be resolved against this task.

## References

- `skills/chronicle/`, `skills/team-memory/`, `skills/persona-memory/` — the three surfaces
- `~/.ai-memory` — shared durable-block store for team-memory / persona-memory
- chronicle stale items (1mo): the three-systems tracking gap and the unify-vs-independent decision
