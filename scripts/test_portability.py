#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Unit cases for scripts/portability.py.

Usage:
  ./scripts/test_portability.py       # or: python scripts/test_portability.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import portability  # noqa: E402

SKILLS = frozenset({"agent-inbox", "chronicle", "cmux-orchestrator", "session-titles"})
CMUX_SCRIPTS = ("cmux-orchestrator", "skills/cmux-orchestrator/scripts")

# skills/cmux-orchestrator/scripts/wake-parent.sh at 80c3c23, lines 15-18: a
# hard dependency on a sibling skill that `--check` reported as clean.
WAKE_PARENT_HEAD = """script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The inbox skill is installed beside this orchestration skill.
# shellcheck source=../../agent-inbox/scripts/lib.sh
. "$script_dir/../../agent-inbox/scripts/lib.sh"
"""


def kinds(line: str, skill: str, rel_dir: str) -> list[str]:
    return [kind for kind, _ in portability.line_findings(line, skill, rel_dir, SKILLS)]


class SiblingClimb(unittest.TestCase):
    def test_wake_parent_source_line_at_80c3c23(self) -> None:
        found = portability.line_findings(
            '. "$script_dir/../../agent-inbox/scripts/lib.sh"', *CMUX_SCRIPTS, SKILLS
        )
        self.assertEqual([kind for kind, _ in found], ["cross-skill-path"])
        self.assertIn("'agent-inbox'", found[0][1])

    def test_shell_prefix_spellings(self) -> None:
        for line in [
            '$(dirname "$0")/../../agent-inbox/scripts/lib.sh',
            'source "${BASH_SOURCE%/*}/../../agent-inbox/scripts/lib.sh"',
            '. "$(cd "$(dirname "$0")" && pwd)/../../agent-inbox/scripts/lib.sh"',
            "bash ../../agent-inbox/scripts/lib.sh",
            "# shellcheck source=../../agent-inbox/scripts/lib.sh",
            'const lib = import.meta.dir + "/../../agent-inbox/scripts/lib.sh";',
        ]:
            with self.subTest(line=line):
                self.assertEqual(kinds(line, *CMUX_SCRIPTS), ["cross-skill-path"])

    def test_skill_md_markdown_link(self) -> None:
        line = "> **Related:** see [chronicle](../chronicle/SKILL.md)."
        self.assertEqual(kinds(line, "session-titles", "skills/session-titles"), ["cross-skill-path"])

    def test_programmatic_forms(self) -> None:
        for line in [
            'join(import.meta.dir, "..", "..", "agent-inbox", "scripts", "lib.sh")',
            'resolve(__dirname, "..", "..", "agent-inbox")',
            'Path(__file__).resolve().parent.parent.parent / "agent-inbox" / "scripts"',
        ]:
            with self.subTest(line=line):
                self.assertEqual(kinds(line, *CMUX_SCRIPTS), ["cross-skill-path"])

    def test_waiver_clears_the_line(self) -> None:
        line = '. "$script_dir/../../agent-inbox/scripts/lib.sh"  # portability: allow'
        self.assertEqual(kinds(line, *CMUX_SCRIPTS), [])

    def test_climb_within_own_skill(self) -> None:
        for line, rel_dir in [
            ('. "$script_dir/../scripts/lib.sh"', "skills/agent-inbox/hooks"),
            ("Implementation: `../../scripts/backlog.sh`.", "skills/agent-inbox/references/backends"),
            ('join(import.meta.dir, "..", "data", "outcomes.jsonl")', "skills/agent-inbox/scripts"),
            ('Path(__file__).resolve().parent.parent / "scripts"', "skills/agent-inbox/tests"),
        ]:
            with self.subTest(line=line):
                self.assertEqual(kinds(line, "agent-inbox", rel_dir), [])

    def test_neighbours_that_are_not_skill_references(self) -> None:
        for line, skill, rel_dir in [
            ("reply_to: ../alice/tmp/", "agent-inbox", "skills/agent-inbox"),
            ("https://github.com/.../pull/123", "agent-inbox", "skills/agent-inbox"),
            ("https://example.com/a/../chronicle/", "agent-inbox", "skills/agent-inbox"),
            ("--repo=../../etc/passwd style inputs", "chronicle", "skills/chronicle/scripts"),
            ("see ../../../docs/skill-portability.md", "chronicle", "skills/chronicle/scripts"),
            ('resolve(s.path, "..", target)', "chronicle", "skills/chronicle/scripts"),
        ]:
            with self.subTest(line=line):
                self.assertEqual(kinds(line, skill, rel_dir), [])


class AnchoredPaths(unittest.TestCase):
    def test_existing_kinds_unchanged(self) -> None:
        for line, kind in {
            "~/.claude/skills/agent-inbox/scripts/lib.sh": "cross-skill-path",
            "~/.claude/skills/cmux-orchestrator/scripts/wake-parent.sh": "self-path",
            "~/.claude/settings.json": "machine-state",
            "/Users/someone/code": "user-home",
            'join(HOME, ".claude", "skills", "agent-inbox")': "cross-skill-path",
        }.items():
            with self.subTest(line=line):
                self.assertEqual(kinds(line, *CMUX_SCRIPTS), [kind])


class RepoScan(unittest.TestCase):
    def test_scan_all_catches_wake_parent_at_80c3c23(self) -> None:
        files = {
            "skills/agent-inbox/SKILL.md": "---\nname: agent-inbox\n---\n",
            "skills/agent-inbox/scripts/lib.sh": "agent_inbox_root() { :; }\n",
            "skills/cmux-orchestrator/SKILL.md": "---\nname: cmux-orchestrator\n---\n",
            "skills/cmux-orchestrator/scripts/wake-parent.sh": "#!/usr/bin/env bash\nset -euo pipefail\n\n" + WAKE_PARENT_HEAD,
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel, text in files.items():
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text(text)
            subprocess.run(["git", "init", "-q", tmp], check=True)
            subprocess.run(["git", "-C", tmp, "add", "."], check=True)
            saved = portability.ROOT
            portability.ROOT = root
            try:
                verdicts = {v.skill: v for v in portability.scan_all()}
            finally:
                portability.ROOT = saved

        self.assertFalse(verdicts["agent-inbox"].failed)
        self.assertTrue(verdicts["cmux-orchestrator"].failed)
        self.assertEqual(
            [(f.file, f.line, f.severity, f.kind) for f in verdicts["cmux-orchestrator"].findings],
            [
                ("skills/cmux-orchestrator/scripts/wake-parent.sh", 6, "FAIL", "cross-skill-path"),
                ("skills/cmux-orchestrator/scripts/wake-parent.sh", 7, "FAIL", "cross-skill-path"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
