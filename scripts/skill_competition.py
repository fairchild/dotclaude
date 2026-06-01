#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Create skill competition run packs from AgentSkills-style eval files."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
DEFAULT_OUTPUT_DIR = Path(".eval-runs") / "skill-competition"


@dataclass(frozen=True)
class SkillRef:
    kind: str
    name: str
    path: Path | None


@dataclass(frozen=True)
class EvalCase:
    id: str
    prompt: str
    expected_output: str
    expectations: list[str]
    files: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create skill-vs-baseline competition run packs from evals/evals.json.",
    )
    parser.add_argument(
        "--challenger",
        required=True,
        help="Skill name or path for the challenger, for example cmux-orchestrator.",
    )
    parser.add_argument(
        "--baseline",
        default="none",
        help="Baseline skill name/path, or 'none' for no-skill comparison.",
    )
    parser.add_argument(
        "--evals-from",
        default="challenger",
        help="Where to load evals from: challenger, baseline, or a path to an evals.json file.",
    )
    parser.add_argument(
        "--case-id",
        action="append",
        default=[],
        help="Only include the matching case id. Can be passed more than once.",
    )
    parser.add_argument(
        "--max-cases",
        type=int,
        default=None,
        help="Limit the number of cases, useful for smoke runs.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for generated run artifacts. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--run-name",
        help="Optional run id suffix/name. Defaults to timestamp plus competitor names.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path.cwd(),
        help="Repository root. Defaults to the current working directory.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate inputs and print the planned competition without writing artifacts.",
    )
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="Output format for the command result.",
    )
    return parser.parse_args()


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return slug or "unnamed"


def rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def read_skill_name(skill_dir: Path) -> str:
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        fail(f"skill path does not contain SKILL.md: {skill_dir}")

    text = skill_file.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return skill_dir.name

    parts = text.split("---", 2)
    if len(parts) < 3:
        return skill_dir.name

    for line in parts[1].splitlines():
        if line.strip().startswith("name:"):
            return line.split(":", 1)[1].strip().strip("\"'")
    return skill_dir.name


def resolve_skill(ref: str, repo_root: Path, *, allow_none: bool = False) -> SkillRef:
    if allow_none and ref == "none":
        return SkillRef(kind="none", name="none", path=None)

    raw_candidate = Path(ref)
    candidates = [raw_candidate] if raw_candidate.is_absolute() else [
        repo_root / raw_candidate,
        repo_root / "skills" / ref,
    ]

    candidate = next((item for item in candidates if item.exists()), None)
    if candidate is None:
        fail(f"could not resolve skill '{ref}' as a path or skills/<name>")
    if not candidate.is_dir():
        fail(f"skill reference is not a directory: {candidate}")

    skill_dir = candidate.resolve()
    return SkillRef(kind="skill", name=read_skill_name(skill_dir), path=skill_dir)


def resolve_evals_file(evals_from: str, challenger: SkillRef, baseline: SkillRef, repo_root: Path) -> Path:
    if evals_from == "challenger":
        if challenger.path is None:
            fail("challenger cannot be none")
        return challenger.path / "evals" / "evals.json"

    if evals_from == "baseline":
        if baseline.path is None:
            fail("--evals-from baseline cannot be used with --baseline none")
        return baseline.path / "evals" / "evals.json"

    evals_path = Path(evals_from)
    return evals_path if evals_path.is_absolute() else repo_root / evals_path


def normalize_string_list(value: Any, field: str, case_id: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        fail(f"case {case_id} field '{field}' must be a list of strings")
    return value


def load_eval_cases(evals_file: Path) -> tuple[str | None, list[EvalCase]]:
    if not evals_file.exists():
        fail(f"evals file not found: {evals_file}")

    try:
        payload = json.loads(evals_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"invalid JSON in {evals_file}: {error}")

    if isinstance(payload, list):
        skill_name = None
        raw_cases = payload
    elif isinstance(payload, dict):
        skill_name = payload.get("skill_name")
        raw_cases = payload.get("evals")
    else:
        fail("evals file must contain a JSON object or list")

    if not isinstance(raw_cases, list):
        fail("evals file must contain an 'evals' list")

    cases: list[EvalCase] = []
    for index, raw_case in enumerate(raw_cases, start=1):
        if not isinstance(raw_case, dict):
            fail(f"case {index} must be an object")
        case_id = str(raw_case.get("id") or index)
        prompt = raw_case.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            fail(f"case {case_id} must have a non-empty prompt")
        expected_output = raw_case.get("expected_output", "")
        if not isinstance(expected_output, str):
            fail(f"case {case_id} field 'expected_output' must be a string")
        cases.append(
            EvalCase(
                id=case_id,
                prompt=prompt,
                expected_output=expected_output,
                expectations=normalize_string_list(raw_case.get("expectations"), "expectations", case_id),
                files=normalize_string_list(raw_case.get("files"), "files", case_id),
            )
        )

    if not cases:
        fail(f"evals file has no cases: {evals_file}")
    return skill_name if isinstance(skill_name, str) else None, cases


def filter_cases(cases: list[EvalCase], wanted_ids: list[str], max_cases: int | None) -> list[EvalCase]:
    selected = cases
    if wanted_ids:
        wanted = set(wanted_ids)
        selected = [case for case in selected if case.id in wanted]
        missing = sorted(wanted - {case.id for case in selected})
        if missing:
            fail(f"case id not found: {', '.join(missing)}")
    if max_cases is not None:
        if max_cases < 1:
            fail("--max-cases must be greater than zero")
        selected = selected[:max_cases]
    if not selected:
        fail("no cases selected")
    return selected


def competitor_payload(skill: SkillRef, repo_root: Path) -> dict[str, Any]:
    if skill.path is None:
        return {"kind": "none", "name": "none", "path": None}
    return {
        "kind": "skill",
        "name": skill.name,
        "path": rel(skill.path, repo_root),
    }


def case_payload(case: EvalCase, case_dir: Path, repo_root: Path) -> dict[str, Any]:
    return {
        "id": case.id,
        "prompt": case.prompt,
        "expected_output": case.expected_output,
        "expectations": case.expectations,
        "files": case.files,
        "artifacts": {
            "challenger_prompt": rel(case_dir / "challenger" / "prompt.md", repo_root),
            "challenger_output": rel(case_dir / "challenger" / "output.md", repo_root),
            "baseline_prompt": rel(case_dir / "baseline" / "prompt.md", repo_root),
            "baseline_output": rel(case_dir / "baseline" / "output.md", repo_root),
            "judgement": rel(case_dir / "judgement.md", repo_root),
        },
    }


def build_execution_prompt(
    *,
    role: str,
    competitor: SkillRef,
    challenger: SkillRef,
    baseline: SkillRef,
    case: EvalCase,
) -> str:
    if competitor.kind == "none":
        condition = (
            "Run this task without consulting any skill-specific instructions. "
            f"Do not read or use the challenger skill '{challenger.name}'."
        )
    else:
        assert competitor.path is not None
        other = baseline if role == "challenger" else challenger
        other_note = ""
        if other.kind != "none":
            other_note = f" Do not consult the comparison skill '{other.name}'."
        condition = (
            f"Run this task using only the '{competitor.name}' skill as the skill-specific guidance."
            f"{other_note}"
        )

    expectations = "\n".join(f"- {item}" for item in case.expectations) or "- No explicit expectations listed."
    files = "\n".join(f"- {item}" for item in case.files) or "- No files listed."

    return f"""# Skill Competition Prompt

Role: {role}
Competitor: {competitor.name}
Case: {case.id}

## Condition

{condition}

## Task Prompt

{case.prompt}

## Expected Output

{case.expected_output or "No expected_output field was provided."}

## Expectations

{expectations}

## Files

{files}

## Capture

Write the agent's final output to `output.md` in this directory. Preserve enough detail for a later pairwise judgement.
"""


def output_placeholder(role: str, case: EvalCase) -> str:
    return f"""# Output

Role: {role}
Case: {case.id}

Paste or generate the captured agent output here.
"""


def judgement_template(case: EvalCase, challenger: SkillRef, baseline: SkillRef) -> str:
    expectations = "\n".join(f"- {item}" for item in case.expectations) or "- No explicit expectations listed."
    return f"""# Judgement

Case: {case.id}
Challenger: {challenger.name}
Baseline: {baseline.name}

## Rubric

Score each competitor from 1 to 5 against the expected output and expectations.

Expected output:

{case.expected_output or "No expected_output field was provided."}

Expectations:

{expectations}

## Scores

```json
{{
  "case_id": "{case.id}",
  "winner": "challenger|baseline|tie",
  "scores": {{
    "challenger": null,
    "baseline": null
  }},
  "reasoning": ""
}}
```
"""


def report_markdown(
    *,
    run_id: str,
    challenger: SkillRef,
    baseline: SkillRef,
    evals_file: Path,
    cases: list[EvalCase],
    repo_root: Path,
) -> str:
    case_lines = "\n".join(
        f"- `{case.id}`: `cases/{slugify(case.id)}/challenger/prompt.md`, "
        f"`cases/{slugify(case.id)}/baseline/prompt.md`, `cases/{slugify(case.id)}/judgement.md`"
        for case in cases
    )
    return f"""# Skill Competition Report

Run: `{run_id}`

## Competitors

- Challenger: `{challenger.name}`
- Baseline: `{baseline.name}`

## Eval Source

`{rel(evals_file, repo_root)}`

## Cases

{case_lines}

## Manual Flow

1. Run each `challenger/prompt.md` under the challenger condition and write the result to `challenger/output.md`.
2. Run each `baseline/prompt.md` under the baseline condition and write the result to `baseline/output.md`.
3. Fill in each `judgement.md`.
4. Use `competition.json` as the machine-readable index for later aggregation.
"""


def build_plan(
    *,
    run_id: str,
    challenger: SkillRef,
    baseline: SkillRef,
    evals_file: Path,
    eval_skill_name: str | None,
    cases: list[EvalCase],
    run_dir: Path,
    repo_root: Path,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "adapter": "manual",
        "judge": "manual",
        "mode": "skill-vs-none" if baseline.kind == "none" else "skill-vs-skill",
        "repo_root": rel(repo_root, repo_root),
        "eval_source": {
            "path": rel(evals_file, repo_root),
            "skill_name": eval_skill_name,
        },
        "run_dir": rel(run_dir, repo_root),
        "challenger": competitor_payload(challenger, repo_root),
        "baseline": competitor_payload(baseline, repo_root),
        "cases": [
            case_payload(case, run_dir / "cases" / slugify(case.id), repo_root)
            for case in cases
        ],
    }


def write_artifacts(
    *,
    run_dir: Path,
    plan: dict[str, Any],
    challenger: SkillRef,
    baseline: SkillRef,
    evals_file: Path,
    cases: list[EvalCase],
    repo_root: Path,
) -> None:
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "competition.json").write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
    (run_dir / "report.md").write_text(
        report_markdown(
            run_id=plan["run_id"],
            challenger=challenger,
            baseline=baseline,
            evals_file=evals_file,
            cases=cases,
            repo_root=repo_root,
        ),
        encoding="utf-8",
    )

    for case in cases:
        case_dir = run_dir / "cases" / slugify(case.id)
        challenger_dir = case_dir / "challenger"
        baseline_dir = case_dir / "baseline"
        challenger_dir.mkdir(parents=True)
        baseline_dir.mkdir(parents=True)

        (challenger_dir / "prompt.md").write_text(
            build_execution_prompt(
                role="challenger",
                competitor=challenger,
                challenger=challenger,
                baseline=baseline,
                case=case,
            ),
            encoding="utf-8",
        )
        (challenger_dir / "output.md").write_text(output_placeholder("challenger", case), encoding="utf-8")
        (baseline_dir / "prompt.md").write_text(
            build_execution_prompt(
                role="baseline",
                competitor=baseline,
                challenger=challenger,
                baseline=baseline,
                case=case,
            ),
            encoding="utf-8",
        )
        (baseline_dir / "output.md").write_text(output_placeholder("baseline", case), encoding="utf-8")
        (case_dir / "judgement.md").write_text(judgement_template(case, challenger, baseline), encoding="utf-8")


def main() -> None:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    challenger = resolve_skill(args.challenger, repo_root)
    baseline = resolve_skill(args.baseline, repo_root, allow_none=True)
    evals_file = resolve_evals_file(args.evals_from, challenger, baseline, repo_root).resolve()
    eval_skill_name, all_cases = load_eval_cases(evals_file)
    cases = filter_cases(all_cases, args.case_id, args.max_cases)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    default_run_name = f"{timestamp}-{slugify(challenger.name)}-vs-{slugify(baseline.name)}"
    run_id = slugify(args.run_name or default_run_name)
    output_root = args.output_dir if args.output_dir.is_absolute() else repo_root / args.output_dir
    run_dir = output_root / run_id

    plan = build_plan(
        run_id=run_id,
        challenger=challenger,
        baseline=baseline,
        evals_file=evals_file,
        eval_skill_name=eval_skill_name,
        cases=cases,
        run_dir=run_dir,
        repo_root=repo_root,
    )

    if not args.dry_run:
        write_artifacts(
            run_dir=run_dir,
            plan=plan,
            challenger=challenger,
            baseline=baseline,
            evals_file=evals_file,
            cases=cases,
            repo_root=repo_root,
        )

    if args.format == "json":
        print(json.dumps(plan, indent=2))
        return

    action = "Planned" if args.dry_run else "Created"
    print(f"{action} skill competition: {run_id}")
    print(f"Mode: {plan['mode']}")
    print(f"Cases: {len(cases)}")
    if args.dry_run:
        print("Dry run: no artifacts written")
    else:
        print(f"Run dir: {rel(run_dir, repo_root)}")
        print(f"Report: {rel(run_dir / 'report.md', repo_root)}")


if __name__ == "__main__":
    main()
