#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Render README catalog tables from skill, command, and agent frontmatter.

The frontmatter is the source of truth for what a skill is and how mature it is;
the README tables are a view of it. `readme` rewrites the block between the
catalog markers, `readme --check` exits non-zero when the block is stale.
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
START = "<!-- catalog:start -->"
END = "<!-- catalog:end -->"
SUMMARY_LIMIT = 120


@dataclass(frozen=True)
class Entry:
    name: str
    summary: str
    status: str | None = None
    reason: str | None = None
    slash_only: bool = False


def tracked(pattern: str) -> list[Path]:
    out = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", pattern],
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


def summarize(description: str) -> str:
    flat = " ".join(description.split())
    first = re.split(r"(?<=[.!?])\s", flat, 1)[0]
    if len(first) <= SUMMARY_LIMIT:
        return first
    cut = first[:SUMMARY_LIMIT].rsplit(" ", 1)[0]
    return f"{cut}…"


def skills() -> list[Entry]:
    entries = []
    for path in tracked("skills/*/SKILL.md"):
        fm = frontmatter(path)
        meta = fm.get("metadata") or {}
        entries.append(
            Entry(
                name=path.parent.name,
                summary=summarize(fm.get("description", "")),
                status=meta.get("status"),
                reason=meta.get("experimental_reason"),
                slash_only=fm.get("disable-model-invocation") is True,
            )
        )
    return entries


def commands() -> list[Entry]:
    return [
        Entry(name=p.stem, summary=summarize(frontmatter(p).get("description", "")))
        for p in tracked("commands/*.md")
    ]


def agents() -> list[Entry]:
    return [
        Entry(name=p.stem, summary=summarize(frontmatter(p).get("description", "")))
        for p in tracked("agents/*.md")
    ]


def table(headers: tuple[str, ...], rows: list[tuple[str, ...]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join("---" for _ in headers) + "|",
    ]
    lines += ["| " + " | ".join(cell.replace("|", "\\|") for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def render() -> str:
    all_skills = skills()
    stable = [s for s in all_skills if s.status is None and not s.slash_only]
    slash = [s for s in all_skills if s.status is None and s.slash_only]
    experimental = [s for s in all_skills if s.status == "experimental"]

    sections = [
        "### Skills — stable, auto-invoked",
        "",
        "Claude loads these when the task matches the description.",
        "",
        table(("Skill", "Domain"), [(f"`{s.name}`", s.summary) for s in stable]),
        "",
        "### Skills — stable, invoked by slash command",
        "",
        "`disable-model-invocation: true` — run as `/name`; Claude will not load them on its own.",
        "",
        table(("Skill", "Domain"), [(f"`/{s.name}`", s.summary) for s in slash]),
        "",
        "### Skills — experimental",
        "",
        "`metadata.status: experimental` in frontmatter. Usable, and the reason each one "
        "hasn't graduated is stated in `metadata.experimental_reason`.",
        "",
        table(
            ("Skill", "Domain", "Why experimental"),
            [(f"`{s.name}`", s.summary, s.reason or "") for s in experimental],
        ),
        "",
        "### Commands",
        "",
        table(("Command", "Purpose"), [(f"`/{c.name}`", c.summary) for c in commands()]),
        "",
        "### Agents",
        "",
        table(("Agent", "Use case"), [(f"`{a.name}`", a.summary) for a in agents()]),
    ]
    return "\n".join(sections)


def splice(readme: str, block: str) -> str:
    start, end = readme.index(START), readme.index(END)
    return f"{readme[:start]}{START}\n{block}\n{readme[end:]}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    readme = sub.add_parser("readme", help="rewrite the README catalog block")
    readme.add_argument("--check", action="store_true", help="fail if the block is stale")
    args = parser.parse_args()

    path = ROOT / "README.md"
    current = path.read_text(encoding="utf-8")
    if START not in current or END not in current:
        print(f"FAIL: README.md lacks {START} / {END} markers", file=sys.stderr)
        return 1
    updated = splice(current, render())
    if args.check:
        if updated != current:
            print("FAIL: README catalog is stale; run `mise run catalog`", file=sys.stderr)
            return 1
        print("OK: README catalog matches frontmatter")
        return 0
    path.write_text(updated, encoding="utf-8")
    print("OK: README catalog rewritten")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
