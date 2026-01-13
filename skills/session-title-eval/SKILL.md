---
name: session-title-eval
description: Build and run evaluations for session title generation quality. Use after modifying prompts, when curating test cases, or for periodic quality audits.
license: Apache 2.0
status: wip
---

## Overview

This skill helps evaluate and improve session title generation by:
1. Extracting test cases from existing sessions
2. Maintaining a curated "golden" dataset with ideal titles
3. Running evaluations with multiple metrics
4. Generating reports to identify improvements

## Directory Structure

```
data/
├── candidates.jsonl   # Raw extracted (uncurated)
├── golden.jsonl       # Curated with ideal titles + scores
└── results/           # Eval run outputs
```

## Workflows

### 1. Extract Candidates

Pull test cases from existing session transcripts:

```bash
bun ~/.claude/skills/session-title-eval/scripts/extract-candidates.ts
```

Options:
- `--limit N` - Extract at most N candidates
- `--project NAME` - Filter to specific project

### 2. Curate Golden Dataset

Review `data/candidates.jsonl` and for each promising case:
1. Add `ideal_title` - what the title SHOULD be
2. Add `human_score` (1-5) - how good is the generated title
3. Add `notes` - why you scored it that way
4. Move to `data/golden.jsonl`

### 3. Run Evaluation

Test current title generation against golden dataset:

```bash
bun ~/.claude/skills/session-title-eval/scripts/run-eval.ts
```

Options:
- `--judge-model MODEL` - LLM for judging (default: haiku)

Outputs to `data/results/{timestamp}.jsonl`

### 4. Generate Report

Create readable summary of latest eval run:

```bash
bun ~/.claude/skills/session-title-eval/scripts/report.ts
```

## Metrics

| Metric | Description |
|--------|-------------|
| Fuzzy Match | Levenshtein similarity to ideal title (0-1) |
| LLM Judge | Qualitative score from AI reviewer (1-5) |
| Human Score | Your rating from golden dataset (1-5) |

## Scoring Rubric

See `references/scoring-rubric.md` for detailed criteria.

| Score | Meaning |
|-------|---------|
| 5 | Perfect - specific, actionable, concise |
| 4 | Good - minor issues |
| 3 | Acceptable - gets the gist |
| 2 | Poor - too vague or wrong focus |
| 1 | Bad - misses the point entirely |
