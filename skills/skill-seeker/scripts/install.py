#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Install a generated skill to ~/.claude/skills/."""  # portability: allow

import argparse
import shutil
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Install skill to Claude Code")
    parser.add_argument("--source", required=True, help="Source skill directory")
    parser.add_argument("--target", help="Target directory (default: ~/.claude/skills/<name>)")  # portability: allow
    args = parser.parse_args()

    source = Path(args.source).expanduser().resolve()
    if not source.exists():
        print(f"Error: Source not found: {source}", file=sys.stderr)
        return 1

    skill_md = source / "SKILL.md"
    if not skill_md.exists():
        print(f"Error: No SKILL.md in {source}", file=sys.stderr)
        return 1

    # Determine target
    if args.target:
        target = Path(args.target).expanduser().resolve()
    else:
        name = source.name
        target = Path.home() / ".claude" / "skills" / name  # portability: allow

    # Safety check: don't overwrite without notice
    if target.exists():
        print(f"Target exists: {target}")
        print("Overwriting with new version...")
        shutil.rmtree(target)

    shutil.copytree(source, target)

    # Verify
    installed_md = target / "SKILL.md"
    if not installed_md.exists():
        print(f"Error: Installation failed — SKILL.md not at {target}", file=sys.stderr)
        return 1

    print(f"Installed to: {target}")
    installed = sorted(f.relative_to(target) for f in target.rglob("*") if f.is_file())
    for f in installed:
        print(f"  {f}")
    print(f"\n{len(installed)} files installed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
