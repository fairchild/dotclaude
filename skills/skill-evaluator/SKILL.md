---
name: skill-evaluator
description: >-
  Evaluate third-party skills before trusting or installing them. Use when
  reviewing a skill from skills.sh or GitHub, when asking "should I install
  this skill", "is this skill safe", "review this skill", "evaluate skill
  quality", or when comparing competing skills. Performs security audit,
  quality assessment, context budget analysis, and generates advisory report
  with adopt/skip/modify recommendation.
---

# Skill Evaluator

Evaluate third-party skills for security, quality, context cost, and value before adoption.

**Input**: GitHub URL, skills.sh identifier, or local path to a skill
**Output**: Evaluation report saved to `~/.claude/skills/skill-evaluator/reports/`

## Workflow

Follow these 7 steps in order. Do not skip steps.

### Step 1: Resolve Source

Run the fetch script to clone the skill and gather metadata:

```bash
uv run ~/.claude/skills/skill-evaluator/scripts/fetch_skill.py \
  --source "<github-url-or-skills.sh-id-or-local-path>" \
  --skill "<skill-name>" \
  --format json
```

If the source is a GitHub repo, also run:
```bash
gh repo view <owner/repo> --json stargazerCount,forkCount,licenseInfo,pushedAt,description
```

Record: repo URL, author, stars, forks, license, last updated date.

If `find-skills` is installed, note it can discover alternative skills for comparison.

### Step 2: Structural Assessment

If `skills-manager` is installed, delegate structural validation:
```bash
bun ~/.claude/skills/skills-manager/scripts/manage.ts validate <skill-path>
```

If not installed, check manually:
- SKILL.md exists with valid YAML frontmatter
- Required fields: `name`, `description`
- Name is hyphen-case, max 64 chars
- Description is 50-1024 chars with specific trigger conditions
- No forbidden files (README.md at root, CHANGELOG.md, INSTALLATION.md)
- Scripts are executable
- No broken reference links

Record all errors and warnings.

### Step 3: Security Audit

Run the security scanner:
```bash
uv run ~/.claude/skills/skill-evaluator/scripts/security_scan.py \
  --path "<skill-path>" \
  --format json
```

Review the JSON output. For each finding:
1. Check if the pattern is **expected** for this skill's purpose (see `references/security-patterns.md`)
2. Read the flagged file and line to understand context
3. Determine if the finding is a true risk or false positive

**Pay special attention to**:
- CRITICAL findings (always investigate)
- `hooks:` in frontmatter (what does the hook execute?)
- `allowed-tools:` in frontmatter (what capabilities does it request?)
- Scripts that combine network access + credential reading

Rate: PASS / WARN / FAIL (see `references/scoring-rubric.md`)

### Step 4: Quality Assessment

Read the skill's SKILL.md and evaluate:

**Frontmatter**: Does the description include specific trigger phrases? Is it within 50-1024 chars?

**Body structure**: Is it under 500 lines? Does it use imperative form? Are there concrete examples? Is there a clear workflow or task organization?

**References**: Are they organized for progressive disclosure? Are large docs split into on-demand references rather than inlined?

**Examples**: Does the skill include realistic usage examples? Are they copy-pasteable?

Rate: A (exemplary) / B (good) / C (functional) / D (poor)

### Step 5: Context Budget

Run the budget analyzer:
```bash
uv run ~/.claude/skills/skill-evaluator/scripts/context_budget.py \
  --path "<skill-path>" \
  --format json
```

Compare against guidelines:
- Metadata (always loaded): ~100 words ideal
- Body (when triggered): ~500 words guideline, <500 lines
- Total triggered: <2K (Light), 2-10K (Moderate), >10K (Heavy)

Rate: Light / Moderate / Heavy

### Step 6: Value Assessment

Evaluate the skill's unique contribution:

1. **Capabilities**: What does this skill enable that you can't do without it?
2. **Built-in overlap**: How much of this knowledge is already in Claude's training data?
3. **Installed overlap**: If `skills-manager` is installed, run `bun ~/.claude/skills/skills-manager/scripts/manage.ts list` to check for overlapping skills
4. **Unique value**: What specific, non-obvious knowledge or workflows does it add?
5. **Value per token**: Is the context cost justified by the value provided?

Rate: High / Medium / Low / Redundant

### Step 7: Generate Report

Using `references/report-template.md` as a guide, produce a markdown report with:

1. **Summary table** with all ratings and recommendation
2. **Source & Provenance** section
3. **Security Audit** with findings and verdict
4. **Quality Assessment** with specific observations
5. **Context Budget** with token breakdown
6. **Compatibility** notes
7. **Value Assessment** with overlap analysis
8. **Recommendation**: ADOPT / ADOPT WITH MODIFICATIONS / SKIP

Save the report to:
```
~/.claude/skills/skill-evaluator/reports/<skill-name>-<YYYY-MM-DD>.md
```

Present the summary table and recommendation to the user.

## Recommendation Decision Matrix

Use `references/scoring-rubric.md` for the full matrix. Quick reference:

| Security | Quality | Value | Recommendation |
|----------|---------|-------|----------------|
| PASS | A-B | High-Medium | **ADOPT** |
| PASS | C | High | **ADOPT WITH MODIFICATIONS** |
| WARN | A-B | High | **ADOPT WITH MODIFICATIONS** |
| FAIL | Any | Any | **SKIP** |
| Any | D | Any | **SKIP** |
| Any | Any | Redundant | **SKIP** |

## Comparing Skills

When evaluating competing skills for the same purpose:

1. Run the full evaluation for each candidate
2. Compare side-by-side on all dimensions
3. Weight security and value highest
4. Present comparison table with clear winner recommendation
