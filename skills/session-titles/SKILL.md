---
name: session-titles
description: "Session title generation, evaluation, and optimization. Auto-generates context-aware titles via Stop hook. Includes quality evaluation (pattern checks, LLM judge), GEPA-inspired prompt evolution, golden dataset tooling, and interactive title rating for training data collection."
license: Apache-2.0
---

## Overview

This skill owns the entire session title lifecycle:

1. **Generation** -- Stop hook extracts context from the transcript (primary request, branch, files) and calls Haiku to produce a 4-7 word active-voice title. Detects focus shifts and tracks them with a `(N)` prefix.
2. **Feedback** -- Each generated title is saved as a pending feedback entry for later scoring.
3. **Rating** -- Interactive workflow where an AI judge scores first, then the human confirms or corrects. Builds dual-perspective training data.
4. **Evaluation** -- Pattern checks (fallback, meta-language, too long, etc.) plus optional LLM judge scoring across all pending entries.
5. **Evolution** -- GEPA-inspired prompt mutation: reflect on failures, propose targeted changes, keep improvements.
6. **Golden dataset** -- Extract candidates from real sessions, curate ideal titles, run regression evals.

## How It Works

```
Session ends
  --> Stop hook (hooks/stop.sh)
    --> scripts/generate.ts  (stdin: session_id, cwd, transcript_path)
      --> generate-core.ts
        1. extractSessionContext()  -- parse transcript JSONL
        2. evolveTitleWithContext()  -- initial title or shift detection via Haiku
        3. sanitizeTitle()          -- strip preambles, enforce length
        4. savePendingFeedback()    -- append to title-feedback/pending.jsonl
```

## Scripts

All scripts support `--help` style flags. Run with `bun`.

| Script | Purpose |
|--------|---------|
| `generate.ts` | Hook entry point. Reads JSON from stdin. |
| `generate-core.ts` | Core module: context extraction, title generation, shift detection. |
| `generate-core.test.ts` | Unit + integration tests. `bun test scripts/generate-core.test.ts` |
| `schema.ts` | `TitleFeedback` types, prompt version constants. |
| `store.ts` | JSONL persistence for pending/scored feedback. |
| `eval-quality.ts` | Pattern checks + optional `--judge` LLM scoring. |
| `evolve-prompt.ts` | GEPA evolution. `--iterations N`, `--pareto-size N`. |
| `extract-candidates.ts` | Pull test cases from session transcripts. `--limit N`, `--project NAME`. |
| `run-eval.ts` | Run golden dataset eval. `--judge-model MODEL`. |
| `report.ts` | Generate report from latest eval results. `--file PATH`. |

## Rate Title

Interactive rating workflow (invoke as `/rate-title` or manually):

1. **AI Judge assesses first** -- Score (1-5), reasoning, proposed better title.
2. **Human calibrates** -- Agree? Different score? Better suggestion?
3. **Both perspectives saved** to `~/.claude/title-feedback/scored.jsonl`.

The dual-perspective data enables DSPy optimization of both the judge prompt (learn to rate like the human) and the journalist prompt (generate titles humans rate highly).

### Rating Scale

| Score | Meaning |
|-------|---------|
| 5 | Perfect -- specific, actionable, concise |
| 4 | Good -- minor phrasing improvements possible |
| 3 | Acceptable -- gets the gist but generic |
| 2 | Poor -- too vague or wrong focus |
| 1 | Bad -- completely off-base or misleading |

See `references/scoring-rubric.md` for detailed criteria.

## Data Layout

**Runtime data** (gitignored, at `~/.claude/title-feedback/`):
- `pending.jsonl` -- written by Stop hook
- `scored.jsonl` -- written by /rate-title

**Evaluation data** (gitignored, at `skills/session-titles/data/`):
- `candidates.jsonl` -- extracted test cases
- `golden.jsonl` -- curated with ideal titles
- `results/` -- timestamped eval outputs
- `baseline-*.md`, `evolution-*.md` -- quality reports

## References

- `references/scoring-rubric.md` -- 5-point rating criteria
- `references/adaptive-title-plan.md` -- Roadmap: phases, LanceDB vectors, DSPy optimization
