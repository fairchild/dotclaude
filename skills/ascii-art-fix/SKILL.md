---
name: ascii-art-fix
description: Fix misaligned right borders in ASCII art diagrams
license: Apache-2.0
disable-model-invocation: true
metadata:
  status: experimental
  experimental_reason: "Prompt-only repair is useful but still has edge cases around nested diagrams, tables, and mixed markdown content."
---

# ASCII Art Fix

Fix misaligned right borders in ASCII art box diagrams. Prompt-driven — no external tools required.

## Recognizing ASCII Box Diagrams

Box diagrams use border characters to draw rectangular outlines:

**Plus-dash style:**
```
+-------------------+
| Content here      |
+-------------------+
```

**Unicode style:**
```
┌─────────────────┐
│ Content here    │
└─────────────────┘
```

## How to Fix

1. **Find each box** — identify top/bottom borders (lines of `+---+` or `┌───┐` / `└───┘`)
2. **Measure the box width** — count characters in the top border from first `+` to last `+` (inclusive)
3. **Pad each content line** — every `|` or `│` content line between borders must have its closing border character at the same column as the border width
4. **Preserve everything else** — do not modify any text outside box diagrams

## Rules

**DO fix:**
- Content lines where the closing `|` or `│` is at the wrong column
- Pad with spaces between content and closing border
- Borders with the wrong corner glyphs — a top border uses `┌…┐`, a bottom border uses `└…┘` (a bottom drawn as `┌…┐` gets its corners replaced)

**DO NOT touch:**
- Markdown tables (`| Col | Col |` with `|---|---|` separator rows)
- Content inside fenced code blocks (``` or ~~~)
- Flow arrows or connectors between boxes (`|`, `v`, `---->`)
- Lines that don't belong to a box diagram
- Already-aligned boxes

## Distinguishing Tables from Boxes

Markdown tables have:
- Multiple `|` characters per line separating columns
- A separator row matching `|---|---|` (dashes with optional colons)
- No `+` corner characters

Box diagrams have:
- `+` or `┌└┐┘` corner characters on border lines
- Exactly two `|` or `│` per content line (opening and closing)
- Horizontal borders made of `-` or `─`

If a line has a `|---|` separator row, it's a table. Leave it alone.

## Verify Your Work

After fixing, check that every line in each box is the same width. Nested boxes are especially tricky — the outer box content lines that contain an inner box still need their closing `|` at the outer box's column:

```
+------------------+          <- width 20, | at column 20
| Outer content    |          <- | at column 20 ✓
|  +----------+   |          <- | at column 20 ✓ (not column 17)
|  | Inner    |   |          <- | at column 20 ✓
|  +----------+   |          <- | at column 20 ✓
+------------------+
```

Run the validator to catch misalignment:

```bash
python3 scripts/validate.py <file>
```

## Eval

Run the eval to check your work:

```bash
bash skills/ascii-art-fix/scripts/clean.sh
# process each case in assets/cases/*/
bash skills/ascii-art-fix/scripts/eval.sh
```

See `references/evaluating.md` for the full eval workflow.
