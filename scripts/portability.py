#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Lint skills for portability — the gate for serving them over MCP (SEP-2640).

A skill served over MCP is materialized by the consuming host at a path of the
host's choosing, so its content can reference its own files only relative to
its base directory. `metadata.portability: machine-bound` in SKILL.md
frontmatter declares a skill as bound to this machine's state; absence claims
the skill is portable, and this lint verifies the claim:

- portable + a path anchored into its own directory (`~/.claude/skills/<self>`)
  → FAIL: rewrite the reference relative to the skill's base directory.
- portable + a path into another skill's directory → FAIL: name the skill, not
  its install path.
- portable + any other `~/.claude` reference → FAIL: the skill depends on this
  machine's Claude config; declare machine-bound or drop the dependency.
- `/Users/<name>` → FAIL when portable, WARN when machine-bound.
- machine-bound + no such references → WARN: consider declaring it portable.

A line that must mention a path as subject matter (documentation about the
layout itself) carries `portability: allow` in a comment on that line.

`report` prints every skill's verdict; `--check` exits non-zero on any FAIL.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WAIVER = "portability: allow"
TEXT_SUFFIXES = {
    ".md", ".txt", ".py", ".ts", ".tsx", ".js", ".sh", ".bash", ".zsh",
    ".json", ".jsonc", ".yaml", ".yml", ".toml", ".html", ".css", ".csv",
}

DOTCLAUDE = re.compile(r"(?:~|\$HOME|/Users/[A-Za-z0-9_-]+)/\.claude(?P<rest>/[^\s`'\")\]]*)?")
USER_HOME = re.compile(r"/Users/[A-Za-z0-9_-]+")


@dataclass(frozen=True)
class Finding:
    severity: str  # FAIL | WARN
    file: str
    line: int
    kind: str
    text: str


@dataclass(frozen=True)
class Verdict:
    skill: str
    tier: str  # portable | machine-bound
    findings: tuple[Finding, ...]

    @property
    def failed(self) -> bool:
        return any(f.severity == "FAIL" for f in self.findings)


def tracked_files(skill_dir: Path) -> list[Path]:
    out = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", f"skills/{skill_dir.name}/"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    return [ROOT / p for p in sorted(out)]


def frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    return yaml.safe_load(text.split("---", 2)[1]) or {}


def classify(match: re.Match, skill: str) -> tuple[str, str]:
    rest = match.group("rest") or ""
    if rest.startswith(f"/skills/{skill}/") or rest == f"/skills/{skill}":
        return "self-path", "reference this skill's files relative to its base directory"
    inner = re.match(r"/skills/([A-Za-z0-9_-]+)", rest)
    if inner:
        return "cross-skill-path", f"names skill '{inner.group(1)}' by install path; use its name"
    return "machine-state", "depends on this machine's Claude config"


def scan_skill(skill_md: Path) -> Verdict:
    skill = skill_md.parent.name
    meta = frontmatter(skill_md).get("metadata") or {}
    tier = meta.get("portability") or "portable"
    findings: list[Finding] = []

    for path in tracked_files(skill_md.parent):
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        rel = str(path.relative_to(ROOT))
        for lineno, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if WAIVER in line:
                continue
            matched_dotclaude = False
            for m in DOTCLAUDE.finditer(line):
                matched_dotclaude = True
                kind, why = classify(m, skill)
                severity = "FAIL" if tier == "portable" else "WARN"
                findings.append(Finding(severity, rel, lineno, kind, why))
            if not matched_dotclaude and USER_HOME.search(line):
                severity = "FAIL" if tier == "portable" else "WARN"
                findings.append(Finding(severity, rel, lineno, "user-home", "hardcodes a user home path"))

    if tier == "machine-bound" and not findings:
        findings.append(Finding("WARN", f"skills/{skill}/SKILL.md", 1, "tier", "no machine-bound signals; consider portable"))
    return Verdict(skill, tier, tuple(findings))


def scan_all() -> list[Verdict]:
    out = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "skills/*/SKILL.md"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    return [scan_skill(ROOT / p) for p in sorted(out)]


def report(verdicts: list[Verdict], verbose: bool) -> None:
    for v in verdicts:
        fails = sum(1 for f in v.findings if f.severity == "FAIL")
        warns = len(v.findings) - fails
        mark = "FAIL" if v.failed else ("warn" if warns else "ok")
        print(f"{mark:4}  {v.skill:28} {v.tier:13} {fails} fail / {warns} warn")
        if verbose:
            for f in v.findings:
                print(f"      {f.severity} {f.file}:{f.line} [{f.kind}] {f.text}")
    total_fail = sum(1 for v in verdicts if v.failed)
    print(f"\n{len(verdicts)} skills: {total_fail} failing, {len(verdicts) - total_fail} clean")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="exit non-zero if any skill fails")
    parser.add_argument("-v", "--verbose", action="store_true", help="print each finding with file:line")
    parser.add_argument("skill", nargs="?", help="lint a single skill by name")
    args = parser.parse_args()

    if args.skill:
        path = ROOT / "skills" / args.skill / "SKILL.md"
        if not path.exists():
            print(f"no such skill: {args.skill}", file=sys.stderr)
            return 2
        verdicts = [scan_skill(path)]
    else:
        verdicts = scan_all()

    report(verdicts, verbose=args.verbose or bool(args.skill))
    if args.check and any(v.failed for v in verdicts):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
