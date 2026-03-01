# Persona Memory AI Intelligence Roadmap

## Purpose

Define the path from current script-first memory to a continuous AI background layer that:
1. consolidates memory continuously
2. refreshes search and recall indexes continuously
3. proposes and applies high-signal memory updates over time

## Current Baseline (Today)

Current system is primarily deterministic:
- event capture (`remember.ts`)
- rule-based consolidation (`consolidate.ts`)
- keyword/boost recall (`recall.ts`)
- launcher prompt injection (`launch-claude.sh`)
- lifecycle hooks (`session-start.ts`, `session-end.ts`)

AI today is mostly at runtime conversation behavior in Claude, not in the memory engine itself.

## Target State

A local continuous background layer with queue + workers:
1. Ingest new session signals and memory events continuously.
2. Run AI extraction and consolidation in the background.
3. Update retrieval indexes continuously (text + semantic).
4. Keep a bounded working-memory snapshot ready for next prompt/session.
5. Fail open and degrade to deterministic behavior if AI services fail.

## Architecture Evolution

## Stage A: Deterministic Control Plane (foundation)

Add a local job system under `~/.ai-memory/runtime/`:
- `jobs.jsonl` queue
- `workers/` lock files
- `runs/` execution logs

Job types:
- `ingest-session`
- `extract-candidates`
- `consolidate-memory`
- `refresh-search-index`
- `prepare-working-memory`

Outcome:
- repeatable background pipeline before introducing model calls.

## Stage B: AI Candidate Extraction

Introduce optional AI extraction for candidate memory generation:
- transcript/session delta -> structured candidates
- candidate schema includes confidence and rationale

New script layer:
- `scripts/ai-extract.ts`
- `scripts/ai-score.ts`

Control flags:
- `AI_MEMORY_MODE=deterministic|hybrid|ai`
- `AI_MEMORY_AI_PROVIDER=anthropic` (initial)

Outcome:
- higher-quality candidates with deterministic fallback retained.

## Stage C: AI Consolidation and Conflict Resolution

Move from simple dedupe to semantic consolidation:
1. merge equivalent memories with canonical wording
2. detect conflicts with prior decisions/preferences
3. produce “update proposals” before writing sensitive changes

New script layer:
- `scripts/ai-consolidate.ts`
- `scripts/ai-conflicts.ts`

Outcome:
- better long-term memory quality and less duplication drift.

## Stage D: Hybrid Search Intelligence

Upgrade recall from keyword-only to hybrid retrieval:
1. lexical index (fast deterministic fallback)
2. semantic index (embeddings)
3. reranking for session-start and active-task context

New data/indexes:
- `~/.ai-memory/index/fts.sqlite` (or equivalent)
- `~/.ai-memory/index/embeddings.*`

New script layer:
- `scripts/index-refresh.ts`
- `scripts/recall-hybrid.ts`

Outcome:
- recall quality increases while preserving low-latency fallback path.

## Stage E: Continuous Background Layer

Run background workers on cadence + triggers:
1. near-real-time: every 1-2 minutes for new events
2. hourly: consolidation + index refresh
3. daily: sleep-time semantic compression and summary
4. weekly: pattern mining + personality alignment suggestions

Worker model:
- single-process orchestrator in v1 (`background-runner.ts`)
- multi-worker split in v2 if needed

Outcome:
- memory/search/update loop is continuous, not only session-bound.

## Stage F: Proactive Memory Intelligence

Enable proactive teammate behavior based on personality/assertiveness:
1. auto-suggest context on project switches
2. prompt “decision memory updates” after major changes
3. propose stale-thread closures and priority shifts

Safety:
- high assertiveness still respects destructive-action guardrails
- all memory writes are auditable via event log

Outcome:
- system feels like a persistent teammate, not just storage.

## Implementation Milestones

## M1 (1-2 weeks): Queue + Runner + Observability

Deliver:
- job queue files and runner loop
- retry/backoff/dead-letter handling
- run logs and simple health report

Exit criteria:
- background jobs run continuously without blocking Claude sessions.

## M2 (1-2 weeks): AI Extraction in Hybrid Mode

Deliver:
- Anthropic-backed candidate extraction
- deterministic fallback on key/network/model failures
- budget controls per day/session

Exit criteria:
- candidate precision improves over deterministic baseline.

## M3 (1-2 weeks): AI Consolidation + Conflict Workflow

Deliver:
- semantic dedupe and merge
- conflict tagging and proposal outputs

Exit criteria:
- fewer duplicate entries and cleaner decision timeline.

## M4 (1-2 weeks): Hybrid Retrieval + Index Refresh

Deliver:
- lexical + semantic retrieval
- hybrid recall CLI path integrated with launcher/session-start

Exit criteria:
- higher recall usefulness with latency targets preserved.

## M5 (1 week): Continuous Schedules + Proactive Suggestions

Deliver:
- scheduled background cadence
- proactive suggestion generation with personality-aware assertiveness

Exit criteria:
- measurable increase in continuity value across sessions.

## AI vs Script Ownership by Stage

Stage A:
- AI managed: 0-10%
- Script managed: 90-100%

Stage C:
- AI managed: 30-50%
- Script managed: 50-70%

Stage F target:
- AI managed: 60-75%
- Script managed: 25-40%

Script-managed components remain mandatory for:
- reliability
- fallback safety
- deterministic auditability

## Guardrails

1. Fail-open: no memory failure should block coding flow.
2. Budget caps: token and call limits by day/session.
3. Privacy mode: allow deterministic-only operation.
4. Auditability: every write/update is logged with provenance.
5. Rollback: snapshot + restore path for block corruption or bad merges.

## Metrics

Quality:
- memory precision/recall (human-rated sample)
- duplicate/conflict rates
- stale-thread resolution rate

Performance:
- session-start recall latency
- background job SLA and failure rate
- index freshness lag

Product value:
- % sessions with useful proactive context
- user acceptance of suggested updates/actions

## Recommended Immediate Next Step

Build M1 first:
1. `background-runner.ts`
2. queue schema and retry policy
3. job telemetry files

Then introduce Anthropic-backed extraction behind a feature flag (`AI_MEMORY_MODE=hybrid`).
