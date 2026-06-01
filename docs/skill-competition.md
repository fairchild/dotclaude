# Skill Competition

Skill Competition is the repo-level workflow for comparing one skill against no skill, another skill, or another version of the same skill on the same Skill Eval cases.

The first implementation is deliberately artifact-first. It creates reproducible manual run packs and judgement templates from `skills/<skill>/evals/evals.json`; it does not pretend to automatically load or isolate Claude/Codex skills.

## Goals

- Compare a challenger skill against `none` to measure whether the skill adds value.
- Compare a challenger skill against another skill to understand overlap and relative quality.
- Preserve prompts, outputs, judgement templates, and summary metadata for later inspection.
- Keep run-pack generation deterministic and usable before automated execution exists.

## Non-Goals

- Automatically invoke Claude Code, Codex, or another agent runtime.
- Produce a public leaderboard.
- Replace skill-specific Deterministic Evals for scripts, state transitions, or fixed fixtures.

## Run Pack Generator

Use the repo-level UV script:

```bash
uv run --script scripts/skill_competition.py \
  --challenger cmux-orchestrator \
  --baseline none
```

Compare two skills:

```bash
uv run --script scripts/skill_competition.py \
  --challenger cmux-orchestrator \
  --baseline webapp-testing
```

Smoke one case:

```bash
uv run --script scripts/skill_competition.py \
  --challenger cmux-orchestrator \
  --baseline none \
  --max-cases 1
```

Use an explicit eval file:

```bash
uv run --script scripts/skill_competition.py \
  --challenger cmux-orchestrator \
  --baseline none \
  --evals-file skills/cmux-orchestrator/evals/evals.json
```

Preview without writing artifacts:

```bash
uv run --script scripts/skill_competition.py \
  --challenger cmux-orchestrator \
  --baseline none \
  --dry-run
```

## Inputs

The generator reads AgentSkills-style eval files:

```text
skills/<skill>/evals/evals.json
```

The expected shape is:

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": "example-001",
      "prompt": "Do the task.",
      "expected_output": "The observable outcome.",
      "expectations": ["Specific behavior to check"],
      "files": []
    }
  ]
}
```

## Artifacts

By default, runs are written under:

```text
.eval-runs/skill-competition/<run-id>/
```

Each run contains:

```text
competition.json
report.md
cases/
  <case-id>/
    challenger/
      prompt.md
      output.md
    baseline/
      prompt.md
      output.md
    judgement.md
```

`competition.json` is machine-readable run metadata. `report.md` is a human-readable index. `prompt.md` files are the exact manual execution prompts for each competitor. `output.md` files are placeholders for captured agent output. `judgement.md` is a manual comparison template.

## Comparison Modes

`--baseline none` means the same task is run without consulting the challenger skill.

`--baseline <skill>` means the same task is run with the baseline skill as the comparison competitor.

Future versions can add version comparisons by letting `--baseline` resolve a different checkout or packaged skill version.

## Judgement

The first version uses manual judgement templates. This is intentional: skill outputs are often qualitative, and the repo needs inspectable artifacts before automated judging is trustworthy.

Future versions can add:

- LLM-as-judge scoring
- Deterministic assertion checks
- Pairwise preference collection
- Automated Claude/Codex execution
