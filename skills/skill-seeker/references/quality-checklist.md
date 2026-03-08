# Quality Checklist for Generated Skills

Distilled from skill-building standards. Use during Phase 3 review.

## Frontmatter Rules

- **Only** `name` and `description` fields allowed
- `name`: lowercase hyphen-case, max 64 chars
- `description`: 50-1024 chars, includes specific trigger conditions
  - Good: "Use when the user says X, asks about Y, or wants to Z"
  - Bad: "A tool for working with things"
- No `version`, `author`, `license`, `hooks`, or other fields (unless the skill genuinely needs hooks)

## Body Limits

- Under 500 lines (hard limit)
- Imperative form ("Run the script" not "You should run the script")
- Concrete examples with real commands, not placeholders
- Verification steps after key procedures ("Run X and verify Y")
- No "When to Use" section in the body (that belongs in description)

## Reference Organization

- One level deep from SKILL.md (no nested subdirectories in references/)
- Files over 100 lines should have a table of contents
- No duplication between body and references
- SKILL.md references files with clear "when to read" guidance

## Forbidden Files at Skill Root

- README.md (use only if needed for human documentation, never for agent)
- CHANGELOG.md
- INSTALLATION.md / INSTALLATION_GUIDE.md
- QUICK_REFERENCE.md

## Token Budget Thresholds

| Category | Threshold | Action |
|----------|-----------|--------|
| Light | <2K triggered tokens | No concern |
| Moderate | 2-10K triggered tokens | Acceptable, note cost |
| Heavy | >10K triggered tokens | Must trim — move to references/ |

**Triggered tokens** = metadata + body (loaded when skill activates)
**Total tokens** = triggered + all references (worst case if all loaded)

Estimate: words * 1.3 ≈ tokens

## Security Red Flags

- Subprocess calls that aren't clearly justified
- Network requests outside the skill's stated purpose
- Reading credentials, environment variables, or sensitive files
- Writing to locations outside expected output directories
- Hooks that execute arbitrary commands

## Quality Ratings

| Rating | Criteria |
|--------|----------|
| A | Clear workflow, concrete examples, verification steps, good progressive disclosure |
| B | Covers core use cases, minor gaps in examples or organization |
| C | Functional but thin — lacks examples, weak organization, or missing verification |
| D | Missing structure, vague instructions, no examples, or broken references |

## Value Assessment

- **High**: Adds domain-specific knowledge Claude doesn't have (APIs, schemas, workflows)
- **Medium**: Organizes known knowledge into a useful workflow
- **Low**: Mostly restates what Claude already knows
- **Redundant**: Overlaps significantly with an installed skill

Ask: "Does this skill justify its context cost with unique, actionable knowledge?"
