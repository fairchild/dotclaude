#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml"]
# ///
"""Structural review of a generated skill. Outputs JSON for Claude to interpret."""

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

FORBIDDEN_ROOT_FILES = {"README.md", "CHANGELOG.md", "INSTALLATION.md", "INSTALLATION_GUIDE.md"}
NAME_PATTERN = re.compile(r"^[a-z][a-z0-9-]*$")
MAX_NAME_LENGTH = 64
MIN_DESCRIPTION_LENGTH = 50
MAX_DESCRIPTION_LENGTH = 1024
BODY_LINE_LIMIT = 500
TOKEN_MULTIPLIER = 1.3  # words -> approximate tokens

TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".sh", ".md", ".yaml", ".yml",
    ".toml", ".json", ".txt", ".html", ".css",
}


def word_count(text: str) -> int:
    return len(text.split())


def estimate_tokens(words: int) -> int:
    return int(words * TOKEN_MULTIPLIER)


def parse_frontmatter(content: str) -> tuple[dict | None, str]:
    """Extract YAML frontmatter and body from SKILL.md."""
    if not content.startswith("---"):
        return None, content
    end = content.find("---", 3)
    if end == -1:
        return None, content
    try:
        fm = yaml.safe_load(content[3:end])
        body = content[end + 3:].strip()
        return fm, body
    except yaml.YAMLError:
        return None, content


def check_frontmatter(fm: dict | None) -> tuple[bool, list[str]]:
    """Validate frontmatter fields. Returns (valid, warnings)."""
    warnings = []
    if fm is None:
        return False, ["No valid YAML frontmatter found"]

    if "name" not in fm:
        warnings.append("Missing required field: name")
    elif not isinstance(fm["name"], str):
        warnings.append("Field 'name' must be a string")
    elif not NAME_PATTERN.match(fm["name"]):
        warnings.append(f"Name '{fm['name']}' must be lowercase hyphen-case (e.g., my-skill)")
    elif len(fm["name"]) > MAX_NAME_LENGTH:
        warnings.append(f"Name exceeds {MAX_NAME_LENGTH} chars")

    if "description" not in fm:
        warnings.append("Missing required field: description")
    elif not isinstance(fm["description"], str):
        warnings.append("Field 'description' must be a string")
    else:
        desc_len = len(fm["description"])
        if desc_len < MIN_DESCRIPTION_LENGTH:
            warnings.append(f"Description too short ({desc_len} chars, min {MIN_DESCRIPTION_LENGTH})")
        elif desc_len > MAX_DESCRIPTION_LENGTH:
            warnings.append(f"Description too long ({desc_len} chars, max {MAX_DESCRIPTION_LENGTH})")

    # Check for extra fields beyond name and description
    extra = set(fm.keys()) - {"name", "description"}
    if extra:
        warnings.append(f"Extra frontmatter fields (consider removing): {', '.join(sorted(extra))}")

    valid = "name" in fm and "description" in fm and not any("Missing" in w for w in warnings)
    return valid, warnings


def inventory_files(skill_path: Path) -> list[dict]:
    """List all files with sizes."""
    files = []
    for f in sorted(skill_path.rglob("*")):
        if f.is_file() and ".git" not in f.parts:
            files.append({
                "path": str(f.relative_to(skill_path)),
                "size": f.stat().st_size,
            })
    return files


def check_forbidden_files(skill_path: Path) -> list[str]:
    """Check for files that shouldn't be at skill root."""
    found = []
    for name in FORBIDDEN_ROOT_FILES:
        if (skill_path / name).exists():
            found.append(name)
    return found


def analyze(skill_path: Path) -> dict:
    """Full structural analysis of a skill directory."""
    warnings = []

    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return {
            "error": f"No SKILL.md found in {skill_path}",
            "files": inventory_files(skill_path),
        }

    content = skill_md.read_text()
    fm, body = parse_frontmatter(content)

    fm_valid, fm_warnings = check_frontmatter(fm)
    warnings.extend(fm_warnings)

    # Body metrics
    body_lines = len(body.splitlines())
    body_words = word_count(body)
    if body_lines > BODY_LINE_LIMIT:
        warnings.append(f"Body exceeds {BODY_LINE_LIMIT} lines ({body_lines} lines)")

    # Metadata metrics
    fm_text = content[:content.find("---", 3)] if content.startswith("---") else ""
    metadata_words = word_count(fm_text)

    # Token estimates
    metadata_tokens = estimate_tokens(metadata_words)
    body_tokens = estimate_tokens(body_words)
    triggered_tokens = metadata_tokens + body_tokens

    # Reference tokens
    refs_dir = skill_path / "references"
    refs_tokens = 0
    if refs_dir.exists():
        for f in refs_dir.rglob("*"):
            if f.is_file() and f.suffix in TEXT_EXTENSIONS:
                refs_tokens += estimate_tokens(word_count(f.read_text(errors="replace")))

    # Budget assessment
    if triggered_tokens < 2000:
        budget = "Light"
    elif triggered_tokens < 10000:
        budget = "Moderate"
    else:
        budget = "Heavy"
        warnings.append(f"Heavy context budget ({triggered_tokens} triggered tokens)")

    # Forbidden files
    forbidden = check_forbidden_files(skill_path)
    if forbidden:
        warnings.append(f"Forbidden files at skill root: {', '.join(forbidden)}")

    files = inventory_files(skill_path)

    return {
        "frontmatter_valid": fm_valid,
        "name": fm.get("name") if fm else None,
        "description_length": len(fm.get("description", "")) if fm else 0,
        "body_lines": body_lines,
        "body_words": body_words,
        "metadata_words": metadata_words,
        "metadata_tokens": metadata_tokens,
        "body_tokens": body_tokens,
        "triggered_tokens": triggered_tokens,
        "references_tokens": refs_tokens,
        "total_tokens": triggered_tokens + refs_tokens,
        "budget": budget,
        "files": files,
        "forbidden_files": forbidden,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Review generated skill structure")
    parser.add_argument("--path", required=True, help="Skill directory to review")
    args = parser.parse_args()

    skill_path = Path(args.path).expanduser().resolve()
    if not skill_path.exists():
        print(json.dumps({"error": f"Path does not exist: {skill_path}"}))
        return 1

    result = analyze(skill_path)
    print(json.dumps(result, indent=2))
    return 0 if not result.get("error") else 1


if __name__ == "__main__":
    sys.exit(main())
