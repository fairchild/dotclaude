# Skill Testing Methodology

Inspired by [obra/superpowers](https://github.com/obra/superpowers) (MIT, Jesse Vincent 2025).

## Core Principle

Writing skills is test-driven development applied to process documentation. Observe agents fail before documenting solutions.

## Red-Green-Refactor for Skills

**RED**: Run pressure scenarios without the skill. Document exact agent behavior — where it goes wrong, what it rationalizes, what it skips.

**GREEN**: Write the minimal skill addressing only those specific failures. No speculative content.

**REFACTOR**: Test again. Identify new rationalizations the agent produces. Add explicit counters. Repeat until the skill is bulletproof.

## Description as Trigger (CSO)

The description field is a search index, not a summary. Agents read descriptions to decide whether to load the skill body.

**Critical rule**: Descriptions must state *triggering conditions*, not workflow summaries.

**Why this matters**: If the description summarizes the workflow ("dispatches subagent per task with code review between tasks"), agents follow the summary verbatim instead of reading the full skill body. This causes them to miss steps, simplify multi-step processes, and skip nuance documented in the body.

**Good**: "Use when creating new skills, editing existing skills, or verifying skills work before deployment"

**Bad**: "Guide that walks through 6-step skill creation process with init, edit, validate, package, and iterate phases"

## Testing by Skill Type

**Discipline-enforcing skills** (TDD, verification-before-completion):
- Test with academic questions to check if agent skips the discipline
- Apply pressure: time constraints, sunk cost, near-completion exhaustion
- Document every rationalization, then add explicit counters

**Technique skills** (how-to guides):
- Test application to new scenarios the skill doesn't explicitly cover
- Test edge cases and missing instructions
- Verify the agent can follow the steps without prior knowledge

**Process skills** (multi-step workflows):
- Test that agents complete ALL steps, not just the first few
- Test interruption recovery
- Verify ordering constraints are respected

## Bulletproofing Against Rationalization

Agents rationalize skipping skill instructions. Common patterns:

| Rationalization | Counter |
|----------------|---------|
| "This is simple enough to skip" | Explicit: "No exceptions for simple cases" |
| "I already did the equivalent" | Require specific evidence/output |
| "The user didn't ask for this" | State when the skill is mandatory |
| "I'll do it at the end" | Require the step before proceeding |

Build a rationalization table from testing. Every excuse you observe becomes an explicit counter in the skill.

## Token Budget Guidelines

| Skill type | Target |
|-----------|--------|
| Getting-started / bootstrapping | < 150 words |
| Frequently-loaded (every session) | < 200 words |
| On-demand skills | < 500 words body |
| With references | SKILL.md < 500 lines, split to references/ |
