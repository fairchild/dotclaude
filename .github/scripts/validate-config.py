#!/usr/bin/env python3
"""
Validate Claude Code configuration files.

Validates:
- settings.json against JSON schema
- .mcp.json against JSON schema
- agents/*.md YAML frontmatter
- skills/*/SKILL.md YAML frontmatter and integrity
"""

import json
import re
import sys
from pathlib import Path
from typing import TypedDict

try:
    import jsonschema
    import yaml
except ImportError:
    print("Missing dependencies. Install with: pip install jsonschema pyyaml")
    sys.exit(1)


class ValidationResult(TypedDict):
    file: str
    valid: bool
    errors: list[str]
    warnings: list[str]


def load_json_schema(schema_path: Path) -> dict | None:
    if not schema_path.exists():
        return None
    return json.loads(schema_path.read_text())


def validate_json_file(file_path: Path, schema: dict) -> ValidationResult:
    result: ValidationResult = {
        "file": str(file_path),
        "valid": True,
        "errors": [],
        "warnings": [],
    }

    if not file_path.exists():
        result["warnings"].append(f"File not found: {file_path}")
        return result

    try:
        data = json.loads(file_path.read_text())
    except json.JSONDecodeError as e:
        result["valid"] = False
        result["errors"].append(f"Invalid JSON: {e}")
        return result

    try:
        jsonschema.validate(data, schema)
    except jsonschema.ValidationError as e:
        result["valid"] = False
        result["errors"].append(f"Schema validation: {e.message}")
        if e.path:
            result["errors"].append(f"  at: {'.'.join(str(p) for p in e.path)}")

    return result


def extract_frontmatter(content: str) -> tuple[dict | None, str | None]:
    """Extract YAML frontmatter from markdown content."""
    if not content.startswith("---"):
        return None, "Missing YAML frontmatter (must start with ---)"

    parts = content.split("---", 2)
    if len(parts) < 3:
        return None, "Invalid frontmatter format (missing closing ---)"

    try:
        fm = yaml.safe_load(parts[1])
        return fm, None
    except yaml.YAMLError as e:
        # Provide actionable advice for common issues
        error_msg = str(e)
        if "mapping values are not allowed" in error_msg:
            return None, (
                "Invalid YAML: Colon in value breaks parsing. "
                "Quote the description or use multi-line syntax:\n"
                "    description: |\n      Your description with: colons here"
            )
        return None, f"Invalid YAML: {e}"


def validate_agent(file_path: Path) -> ValidationResult:
    result: ValidationResult = {
        "file": str(file_path),
        "valid": True,
        "errors": [],
        "warnings": [],
    }

    content = file_path.read_text()
    fm, error = extract_frontmatter(content)

    if error:
        result["valid"] = False
        result["errors"].append(error)
        return result

    if not fm:
        result["valid"] = False
        result["errors"].append("Empty frontmatter")
        return result

    # Required fields
    if "name" not in fm:
        result["valid"] = False
        result["errors"].append("Missing required field: name")

    if "description" not in fm:
        result["valid"] = False
        result["errors"].append("Missing required field: description")
    elif len(fm.get("description", "")) < 20:
        result["warnings"].append("Description is very short (< 20 chars)")

    # Optional field validation
    valid_models = ["opus", "sonnet", "haiku", "inherit"]
    if "model" in fm and fm["model"] not in valid_models:
        result["warnings"].append(f"Unknown model: {fm['model']}")

    return result


def validate_skill(skill_dir: Path) -> ValidationResult:
    skill_md = skill_dir / "SKILL.md"
    result: ValidationResult = {
        "file": str(skill_md),
        "valid": True,
        "errors": [],
        "warnings": [],
    }

    if not skill_md.exists():
        result["valid"] = False
        result["errors"].append("Missing SKILL.md")
        return result

    content = skill_md.read_text()
    fm, error = extract_frontmatter(content)

    if error:
        result["valid"] = False
        result["errors"].append(error)
        return result

    if not fm:
        result["valid"] = False
        result["errors"].append("Empty frontmatter")
        return result

    # Required fields
    if "name" not in fm:
        result["valid"] = False
        result["errors"].append("Missing required field: name")
    elif fm["name"] != skill_dir.name:
        result["warnings"].append(
            f"name '{fm['name']}' doesn't match directory '{skill_dir.name}'"
        )

    if "description" not in fm:
        result["valid"] = False
        result["errors"].append("Missing required field: description")
    elif len(fm.get("description", "")) < 30:
        result["warnings"].append("Description is very short (< 30 chars)")

    # Check for referenced files in SKILL.md
    body = content.split("---", 2)[2] if content.startswith("---") else content
    check_skill_references(skill_dir, body, result)
    check_skill_scripts(skill_dir, result)

    return result


def check_skill_references(skill_dir: Path, body: str, result: ValidationResult):
    """Check that referenced files exist."""
    # Skip validation if this is the skill-creator (contains example paths)
    if skill_dir.name == "skill-creator":
        return

    # Find markdown links like [text](path) and script references like `scripts/foo.py`
    link_pattern = r'\[([^\]]+)\]\(([^)]+)\)'
    # Only match clean paths without spaces/args (excludes `scripts/foo.sh --arg`)
    code_pattern = r'`((?:scripts|references|assets)/[^`\s]+)`'

    for match in re.finditer(link_pattern, body):
        ref_path = match.group(2)
        if ref_path.startswith(("http://", "https://", "#")):
            continue
        full_path = skill_dir / ref_path
        if not full_path.exists():
            result["warnings"].append(f"Referenced file not found: {ref_path}")

    for match in re.finditer(code_pattern, body):
        ref_path = match.group(1)
        full_path = skill_dir / ref_path
        if not full_path.exists():
            result["warnings"].append(f"Referenced path not found: {ref_path}")


def check_skill_scripts(skill_dir: Path, result: ValidationResult):
    """Lint bundled scripts."""
    scripts_dir = skill_dir / "scripts"
    if not scripts_dir.exists():
        return

    for script in scripts_dir.iterdir():
        if not script.is_file():
            continue

        # Basic syntax checks
        if script.suffix == ".py":
            try:
                compile(script.read_text(), script, "exec")
            except SyntaxError as e:
                result["valid"] = False
                result["errors"].append(f"Python syntax error in {script.name}: {e}")

        elif script.suffix == ".sh":
            content = script.read_text()
            if not content.startswith("#!"):
                result["warnings"].append(f"Shell script {script.name} missing shebang")


def main():
    root = Path(__file__).parent.parent.parent
    schemas_dir = root / ".github" / "schemas"

    results: list[ValidationResult] = []
    has_errors = False

    # Validate settings.json
    settings_schema = load_json_schema(schemas_dir / "settings.schema.json")
    if settings_schema:
        result = validate_json_file(root / "settings.json", settings_schema)
        results.append(result)
        if not result["valid"]:
            has_errors = True

    # Validate .mcp.json
    mcp_schema = load_json_schema(schemas_dir / "mcp.schema.json")
    if mcp_schema:
        result = validate_json_file(root / ".mcp.json", mcp_schema)
        results.append(result)
        if not result["valid"]:
            has_errors = True

    # Validate agents
    agents_dir = root / "agents"
    if agents_dir.exists():
        for agent_file in agents_dir.glob("*.md"):
            if agent_file.name.startswith("AGENTS-"):
                continue  # Skip README-style files
            result = validate_agent(agent_file)
            results.append(result)
            if not result["valid"]:
                has_errors = True

    # Validate skills
    skills_dir = root / "skills"
    # Skip these directories - they're shared resources, not skills
    skip_dirs = {"references", "scripts", "assets"}
    if skills_dir.exists():
        for skill_dir in skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue
            if skill_dir.name in skip_dirs:
                continue
            result = validate_skill(skill_dir)
            results.append(result)
            if not result["valid"]:
                has_errors = True

    # Output results
    print_results(results)

    # Generate GitHub Actions output
    if "GITHUB_OUTPUT" in __import__("os").environ:
        generate_github_output(results)

    sys.exit(1 if has_errors else 0)


def print_results(results: list[ValidationResult]):
    for result in results:
        status = "\u2705" if result["valid"] else "\u274c"
        print(f"{status} {result['file']}")

        for error in result["errors"]:
            print(f"    \u274c {error}")

        for warning in result["warnings"]:
            print(f"    \u26a0\ufe0f  {warning}")

    valid_count = sum(1 for r in results if r["valid"])
    print(f"\n{valid_count}/{len(results)} files valid")


def generate_github_output(results: list[ValidationResult]):
    import os

    errors = []
    warnings = []

    for result in results:
        for error in result["errors"]:
            errors.append(f"**{result['file']}**: {error}")
        for warning in result["warnings"]:
            warnings.append(f"**{result['file']}**: {warning}")

    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"error_count={len(errors)}\n")
        f.write(f"warning_count={len(warnings)}\n")
        f.write(f"has_errors={'true' if errors else 'false'}\n")

        # Write summary for PR comment
        summary_lines = []
        if errors:
            summary_lines.append("### Errors")
            summary_lines.extend(f"- {e}" for e in errors)
        if warnings:
            summary_lines.append("")
            summary_lines.append("### Warnings")
            summary_lines.extend(f"- {w}" for w in warnings)
        if not errors and not warnings:
            summary_lines.append("All configuration files are valid!")

        # Use delimiter for multiline output
        # EOF must be on its own line with nothing after it
        f.write("summary<<EOF\n")
        f.write("\n".join(summary_lines))
        f.write("\nEOF\n")


if __name__ == "__main__":
    main()
