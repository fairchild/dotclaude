---
status: done
category: followup
thread: null
pr: 136
branch: fix/chronicle-extraction-dedup
score: 4
retro_summary: Curator identified issues, cmux agent did the bulk work, review pass added fast-path optimization
completed: 2026-03-22
---

# Chronicle Extraction Dedup & Quality

## Problem
SessionEnd hook created duplicate block files (up to 5 per session) and produced low-quality summaries (truncated prompt text).

## Solution
- Upsert by sessionId instead of always creating new files
- Deterministic `date-project-shortSessionId.json` filenames
- Fast-path filename lookup before content scan fallback
- Enriched Haiku prompt for goal/challenges/nextSteps
- Meaningful fallback summaries from file/action context
