# ASCII Art Fix: Eval & Wrapper Design

## Problem

The `ascii-art-fix` skill wraps `aadc` to fix misaligned ASCII art borders. The tool corrupts markdown tables — it treats them as diagrams and pads/breaks them. This makes it untrustworthy for general use.

## Goals

1. A `wrapper.py` script that shields markdown tables from aadc
2. An eval harness with synthetic test cases covering fix, no-op, and mixed scenarios
3. Agent-facing instructions so a future session can iterate on the skill

## Structure

```
skills/ascii-art-fix/
  SKILL.md                          # instructions (iteration target A)
  scripts/
    ensure-aadc.sh                  # existing
    wrapper.py                      # table-safe aadc wrapper (iteration target B)
    eval.sh                         # eval runner
  assets/
    cases/
      fix-simple-box/input.txt
      fix-simple-box/expected.txt
      fix-nested-boxes/input.txt
      fix-nested-boxes/expected.txt
      fix-unicode-borders/input.txt
      fix-unicode-borders/expected.txt
      noop-markdown-table/input.md
      noop-markdown-table/expected.md
      noop-aligned-art/input.txt
      noop-aligned-art/expected.txt
      noop-code-block-table/input.md
      noop-code-block-table/expected.md
      mixed-table-and-art/input.md
      mixed-table-and-art/expected.md
      mixed-prose-and-boxes/input.txt
      mixed-prose-and-boxes/expected.txt
  references/
    evaluating.md                   # how to run eval, add cases, iterate
```

## wrapper.py

Accepts file path or stdin, outputs corrected content to stdout.

Algorithm:
1. Read input
2. Identify markdown table regions (contiguous runs of lines matching `|...|` with at least one separator row `|---|`)
3. Replace each table region with a unique placeholder line
4. Write sanitized content to a temp file
5. Run `aadc` on the temp file, capture output
6. Replace placeholders with original table regions
7. Output result

Edge cases:
- Tables inside fenced code blocks (``` or ~~~) — these are already safe from aadc since they're code, but the wrapper should not strip them
- Consecutive tables separated by blank lines
- Single-row "tables" that aren't really tables

## eval.sh

```bash
for case_dir in assets/cases/*/; do
  input=$(find "$case_dir" -name 'input.*' | head -1)
  expected=$(find "$case_dir" -name 'expected.*' | head -1)
  actual=$(python3 scripts/wrapper.py "$input")
  if diff <(echo "$actual") "$expected" > /dev/null 2>&1; then
    PASS
  else
    FAIL (show diff)
  fi
done
```

Exit code = number of failures.

## Test Cases

| Case | Category | Input | Expected |
|------|----------|-------|----------|
| fix-simple-box | Fix | Single `+---+` box with ragged right border | Aligned borders |
| fix-nested-boxes | Fix | Box inside a box, inner misaligned | Both aligned |
| fix-unicode-borders | Fix | `│` and `─` borders misaligned | Aligned |
| noop-markdown-table | No-op | Clean GFM table | Identical |
| noop-aligned-art | No-op | Already-correct box diagram | Identical |
| noop-code-block-table | No-op | Table inside fenced code block | Identical |
| mixed-table-and-art | Mixed | File with GFM table + broken ASCII art | Art fixed, table untouched |
| mixed-prose-and-boxes | Mixed | Prose paragraphs with embedded broken boxes | Boxes fixed, prose untouched |

## references/evaluating.md

Instructions for an agent to:
1. Run `bash scripts/eval.sh` and read results
2. Identify failing cases
3. Adjust `wrapper.py` (filtering logic) or `SKILL.md` (instructions) or both
4. Re-run eval
5. Add new cases when discovering new failure modes

## Iteration Targets

- **wrapper.py**: Table detection regex, placeholder strategy, code-block awareness
- **SKILL.md**: When to use wrapper vs raw aadc, guidance on file types, pre-checks
- **New cases**: Agent can add cases to assets/cases/ when it discovers new failure modes
