#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["skill-seekers"]
# ///
"""Run skill-seekers create with no AI enhancement (Claude handles review)."""

import argparse
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate skill via skill-seekers")
    parser.add_argument("--source", required=True, help="URL, owner/repo, directory, or PDF")
    parser.add_argument("--name", required=True, help="Skill name (hyphen-case)")
    parser.add_argument("--preset", default="standard", choices=["quick", "standard", "comprehensive"])
    parser.add_argument("--output-dir", required=True, help="Output directory for generated skill")
    args = parser.parse_args()

    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "skill_seekers.cli.main", "create",
        args.source,
        "--name", args.name,
        "--preset", args.preset,
        "--enhance-level", "0",
        "--output", str(output),
    ]

    print(f"Running: skill-seekers create {args.source} --name {args.name} -p {args.preset}")
    result = subprocess.run(cmd, text=True)

    if result.returncode != 0:
        print(f"skill-seekers create failed (exit {result.returncode})", file=sys.stderr)
        return result.returncode

    # Locate the generated SKILL.md
    skill_md = output / "SKILL.md"
    if not skill_md.exists():
        # skill-seekers may nest output in a subdirectory
        candidates = list(output.rglob("SKILL.md"))
        if candidates:
            skill_md = candidates[0]
            print(f"Generated skill at: {skill_md.parent}")
        else:
            print(f"Warning: No SKILL.md found in {output}", file=sys.stderr)
            print(f"Output directory contents:")
            for p in sorted(output.rglob("*")):
                if p.is_file():
                    print(f"  {p.relative_to(output)}")
            return 1
    else:
        print(f"Generated skill at: {output}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
