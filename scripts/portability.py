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
- portable + a path into another skill's directory, anchored
  (`~/.claude/skills/<other>`) or climbing out of its own directory
  (`../<other>/`, `$(dirname "$0")/../../<other>/`) → FAIL: name the skill,
  not its install path.
- portable + any other `~/.claude` reference → FAIL: the skill depends on this
  machine's Claude config; declare machine-bound or drop the dependency.
- `/Users/<name>` → FAIL when portable, WARN when machine-bound.

Programmatic forms count too. Home paths: `${process.env.HOME}/.claude/...`,
`join(HOME, ".claude", ...)`, `Path.home() / ".claude"`, `${HOME}/.claude`.
Sibling climbs: `join(import.meta.dir, "..", "..", "<other>")`,
`Path(__file__).parent.parent.parent / "<other>"`.

A deliberate reference carries `portability: allow` in a comment on that line;
docs/skill-portability.md defines the three grounds that justify one (content
about paths, consumer-config access, declared optional integration).

`report` prints every skill's verdict; `--check` exits non-zero on any FAIL.
"""

from __future__ import annotations

import argparse
import posixpath
import re
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import yaml

ROOT = Path(__file__).resolve().parent.parent
WAIVER = "portability: allow"
TEXT_SUFFIXES = {
    ".md", ".txt", ".py", ".ts", ".tsx", ".js", ".sh", ".bash", ".zsh",
    ".json", ".jsonc", ".yaml", ".yml", ".toml", ".html", ".css", ".csv",
}

HOME_FORMS = r"(?:~|\$HOME|\$\{HOME\}|\$\{?process\.env\.HOME\}?|\$\{?os\.homedir\(\)\}?|\$\{?homedir\(\)\}?|/Users/[A-Za-z0-9_-]+)"
DOTCLAUDE = re.compile(HOME_FORMS + r"/\.claude(?P<rest>/[^\s`'\")\]]*)?")
JOINED_HOME = re.compile(
    r"(?:join|resolve)\(\s*(?:HOME|homedir\(\)|os\.homedir\(\))\s*,\s*['\"]\.claude['\"](?P<args>(?:\s*,\s*['\"][^'\"]+['\"])*)"
    r"|Path\.home\(\)\s*/\s*['\"]\.claude['\"](?P<segs>(?:\s*/\s*['\"][^'\"]+['\"])*)"
)
USER_HOME = re.compile(r"/Users/[A-Za-z0-9_-]+")

PARENT_PATH = re.compile(r"(?:\.\./)+[^\s`'\")\]]*")
PATHLIKE_END = re.compile(r"[A-Za-z0-9_.~/-]$")
SELF_ANCHOR = re.compile(r"""(?:\$[A-Za-z_][A-Za-z0-9_]*|[})"'])/$""")
JOINED_PARENT = re.compile(
    r"(?:join|resolve)\(\s*(?:import\.meta\.dir(?:name)?|__dirname|dirname\([^)]*\))\s*,\s*"
    r"(?P<dots>(?:['\"]\.\.['\"]\s*,\s*)+)['\"](?P<name>[A-Za-z0-9_-]+)['\"]"
)
PATHLIB_PARENT = re.compile(
    r"Path\(__file__\)(?:\.resolve\(\))?(?P<parents>(?:\.parent)+)\s*/\s*['\"](?P<name>[A-Za-z0-9_-]+)['\"]"
)


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


def tracked_skill_mds() -> list[Path]:
    out = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "skills/*/SKILL.md"],
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


def classify(rest: str, skill: str) -> tuple[str, str]:
    if rest.startswith(f"/skills/{skill}/") or rest == f"/skills/{skill}":
        return "self-path", "reference this skill's files relative to its base directory"
    inner = re.match(r"/skills/([A-Za-z0-9_-]+)", rest)
    if inner:
        return "cross-skill-path", f"names skill '{inner.group(1)}' by install path; use its name"
    return "machine-state", "depends on this machine's Claude config"


def opens_path(before: str) -> bool:
    """Whether `../` here begins a path resolved from the file's own directory:
    nothing path-like precedes it, or a self-location prefix does (`$dir/`,
    `${dir}/`, `$(dirname …)/`, a string literal opening with `/`)."""
    return not PATHLIKE_END.search(before) or bool(SELF_ANCHOR.search(before))


def relative_paths(line: str) -> Iterator[str]:
    """Every path on the line that climbs out of the file's own directory."""
    for m in PARENT_PATH.finditer(line):
        if opens_path(line[: m.start()]):
            yield m.group(0)
    for m in JOINED_PARENT.finditer(line):
        yield "../" * m.group("dots").count("..") + m.group("name")
    for m in PATHLIB_PARENT.finditer(line):
        yield "../" * (m.group("parents").count(".parent") - 1) + m.group("name")


def sibling_skill(rel_dir: str, relpath: str, siblings: frozenset[str]) -> str | None:
    """The sibling skill a relative path lands in, resolved from the file's
    repo-relative directory; None when it stays home or leaves `skills/`."""
    parts = PurePosixPath(posixpath.normpath(posixpath.join(rel_dir, relpath))).parts
    if len(parts) > 1 and parts[0] == "skills" and parts[1] in siblings:
        return parts[1]
    return None


def line_findings(line: str, skill: str, rel_dir: str, skills: frozenset[str]) -> list[tuple[str, str]]:
    """(kind, why) for each violation on one line of a file of `skill` living
    at `rel_dir` (repo-relative); a waiver on the line clears it."""
    if WAIVER in line:
        return []
    found: list[tuple[str, str]] = []
    for m in DOTCLAUDE.finditer(line):
        found.append(classify(m.group("rest") or "", skill))
    for m in JOINED_HOME.finditer(line):
        parts = re.findall(r"['\"]([^'\"]+)['\"]", m.group("args") or m.group("segs") or "")
        found.append(classify("/" + "/".join(parts) if parts else "", skill))
    if not found and USER_HOME.search(line):
        found.append(("user-home", "hardcodes a user home path"))
    siblings = skills - {skill}
    for relpath in relative_paths(line):
        if other := sibling_skill(rel_dir, relpath, siblings):
            found.append(("cross-skill-path", f"names skill '{other}' by relative path; use its name"))
    return found


def scan_skill(skill_md: Path, skills: frozenset[str]) -> Verdict:
    skill = skill_md.parent.name
    meta = frontmatter(skill_md).get("metadata") or {}
    tier = meta.get("portability") or "portable"
    severity = "FAIL" if tier == "portable" else "WARN"
    findings: list[Finding] = []

    for path in tracked_files(skill_md.parent):
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        rel = path.relative_to(ROOT).as_posix()
        rel_dir = posixpath.dirname(rel)
        for lineno, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for kind, why in line_findings(line, skill, rel_dir, skills):
                findings.append(Finding(severity, rel, lineno, kind, why))

    return Verdict(skill, tier, tuple(findings))


def scan_all() -> list[Verdict]:
    mds = tracked_skill_mds()
    skills = frozenset(p.parent.name for p in mds)
    return [scan_skill(p, skills) for p in mds]


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
        skills = frozenset(p.parent.name for p in tracked_skill_mds())
        verdicts = [scan_skill(path, skills)]
    else:
        verdicts = scan_all()

    report(verdicts, verbose=args.verbose or bool(args.skill))
    if args.check and any(v.failed for v in verdicts):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
