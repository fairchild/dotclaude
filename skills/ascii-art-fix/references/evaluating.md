# Evaluating & Iterating on ascii-art-fix

## Running the Eval

### Step 1: Clean previous outputs

```bash
bash skills/ascii-art-fix/scripts/clean.sh
```

### Step 2: Process each case

For each directory in `assets/cases/*/`:
1. Read `input.*` — this is the broken or clean content
2. Apply the ascii-art-fix skill instructions to fix it
3. Write the result to `output.*` (same extension as input) in the same case directory

Case categories:
- **fix-*** — broken ASCII art that needs correction
- **noop-*** — content that must pass through unchanged
- **mixed-*** — files with both; fix the art, leave everything else intact

### Step 3: Score

```bash
bash skills/ascii-art-fix/scripts/eval.sh
```

Exit code = number of failures. Zero = all pass.

## Adding Cases

```bash
mkdir -p assets/cases/<category>-<description>
# Create input.* and expected.* files
# Run eval to confirm
```

## Iteration Targets

### SKILL.md (prompting)
The skill instructions teach the LLM how to recognize and fix ASCII art. Improve:
- Pattern recognition guidance (what constitutes a box border, what doesn't)
- Rules for what NOT to touch (markdown tables, code blocks, flow arrows)
- Step-by-step fixing procedure

### scripts/fixer.py (optional automation)
If prompting alone isn't enough, a Python script can handle deterministic cases:
- Find box top/bottom borders, measure width
- Pad content lines to match border width
- Leave non-diagram content untouched

Add script assistance only if eval data shows it helps. Compare pass rates with and without.

## Iteration Workflow

1. `bash scripts/clean.sh`
2. Process all cases using the skill
3. `bash scripts/eval.sh`
4. Read failures — understand what went wrong
5. Adjust SKILL.md instructions or add/modify scripts
6. Repeat from step 1
