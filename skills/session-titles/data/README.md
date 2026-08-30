# Session Titles Data

All files in this directory are gitignored because they contain real session data from projects.

## Runtime data (at `~/.claude/title-feedback/`) <!-- portability: allow -->

| File | Written by | Format |
|------|-----------|--------|
| `pending.jsonl` | Stop hook (auto) | `TitleFeedback` entries awaiting scoring |
| `scored.jsonl` | `/rate-title` workflow | Entries with both judge + human assessments |

## Evaluation data (this directory)

| File | Written by | Format |
|------|-----------|--------|
| `candidates.jsonl` | `extract-candidates.ts` | Test cases extracted from transcripts |
| `golden.jsonl` | Manual curation | Curated test cases with ideal titles |
| `results/*.jsonl` | `run-eval.ts` | Timestamped eval run outputs |
| `baseline-*.md` | `eval-quality.ts` | Quality reports from pattern checks |
| `evolution-*.md` | `evolve-prompt.ts` | GEPA evolution run results |
