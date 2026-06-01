# Dotclaude Skills

This context defines the language used for skills, evaluations, and supporting artifacts in this repository.

## Language

**Skill Eval**:
A structured assessment of whether a skill improves an agent's behavior on realistic tasks compared with a baseline.
_Avoid_: Effectiveness eval, agent eval

**Deterministic Eval**:
A script-backed assessment of a skill's implementation correctness against fixed fixtures and thresholds.
_Avoid_: Unit test, smoke test

**Skill Competition**:
A comparison of one skill against no skill, another skill, or another version of the same skill on the same skill eval cases.
_Avoid_: Leaderboard, bake-off

## Relationships

- A **Skill Eval** evaluates agent behavior with or without a skill.
- A **Deterministic Eval** evaluates a skill's bundled scripts, state transitions, or machine-checkable outputs.
- A **Skill Competition** compares outputs from the same **Skill Eval** cases across two competitors.
- A skill may have zero or more **Skill Evals** and zero or more **Deterministic Evals**.

## Example Dialogue

> **Dev:** "Does this skill need a deterministic eval?"
> **Domain expert:** "Only if it has scripts, fixtures, state, or machine-checkable behavior. Every substantial skill should start with a skill eval."

## Flagged Ambiguities

- "eval" can mean either **Skill Eval** or **Deterministic Eval**; use the precise term when deciding repository requirements.
