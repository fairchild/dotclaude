#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Image-gen skill test suite.

Usage:
  tests/test_image_gen.py                    # Static checks only (free)
  tests/test_image_gen.py --check-env         # Report configured keys
  tests/test_image_gen.py --generate          # Generate and keep outputs (costs $)
  tests/test_image_gen.py --provider openai   # Test one provider

Default mode checks:
  - provider scripts compile
  - executable scripts include uv shebang, executable bit, and PEP 723 metadata
  - provider scripts satisfy the image generation adapter protocol
  - SKILL.md documents direct execution with uv run fallback

With --check-env:
  - OPENAI_API_KEY present
  - GOOGLE_API_KEY or GEMINI_API_KEY present
  - FAL_KEY present

With --generate:
  - Generates test image with each configured provider
  - Verifies output file exists and is non-empty
  - Stores files under outputs/test-runs/{timestamp}/ by default

Exit codes: 0 = all pass, 1 = failures
"""

import argparse
import ast
import base64
import json
import os
import py_compile
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

PROVIDERS = {
    "openai": {"env": ("OPENAI_API_KEY",), "script": "generate_openai.py", "ext": ".png"},
    "imagen": {
        "env": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
        "script": "generate_imagen.py",
        "ext": ".png",
    },
    "gemini": {
        "env": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
        "script": "generate_gemini.py",
        "ext": ".png",
    },
    "fal": {"env": ("FAL_KEY",), "script": "generate_fal.py", "ext": ".jpg"},
}
PROVIDER_REQUIRED_OPTIONS = (
    "--prompt",
    "--output",
    "--output-dir",
    "--model",
    "--check",
    "--protocol",
)
PROVIDER_REQUIRED_FUNCTIONS = ("check_config", "generate_image", "print_protocol", "main")
PROVIDER_PROTOCOL_VERSION = "image-gen-provider/v1"
PROVIDER_PROTOCOL_REQUIRED_KEYS = (
    "protocol_version",
    "provider",
    "default_model",
    "required_options",
    "final_stdout",
    "history",
    "local_helper_imports",
    "supports",
)
ALLOWED_PROVIDER_LOCAL_IMPORTS = {"common"}

SKILL_DIR = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_DIR / "scripts"
TEST_PROMPT = "a simple red circle on white background"
EXECUTABLE_SCRIPTS = [SCRIPTS_DIR / p["script"] for p in PROVIDERS.values()] + [
    SCRIPTS_DIR / "run_examples.py",
    SCRIPTS_DIR / "review_gallery.py",
    SCRIPTS_DIR / "evaluate_review_gallery.py",
    Path(__file__),
]
PYTHON_FILES = EXECUTABLE_SCRIPTS + [SCRIPTS_DIR / "common.py"]

sys.path.insert(0, str(SCRIPTS_DIR))
from common import default_output_dir, load_dotenv_files, record_generation  # noqa: E402
from review_gallery import (  # noqa: E402
    candidate_identity,
    candidate_lineage_key,
    find_candidates,
    normalize_ranking,
)
from run_examples import Example, ModelPreset, initial_manifest, output_entry  # noqa: E402

ONE_PIXEL_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def check_static() -> int:
    failures = 0

    print("=== Static Checks ===")
    for path in PYTHON_FILES:
        if not path.exists():
            print(f"  {path.name}: missing")
            failures += 1
            continue
        try:
            py_compile.compile(str(path), doraise=True)
            print(f"  {path.name}: compiles")
        except py_compile.PyCompileError as e:
            print(f"  {path.name}: compile failed: {e.msg}")
            failures += 1

    for path in EXECUTABLE_SCRIPTS:
        text = path.read_text()
        has_uv_shebang = text.startswith("#!/usr/bin/env -S uv run --script")
        has_pep_723 = "# /// script" in text and "# ///" in text and "requires-python" in text
        is_executable = os.access(path, os.X_OK)
        if has_uv_shebang and has_pep_723 and is_executable:
            print(f"  {path.name}: uv script metadata OK")
        else:
            print(f"  {path.name}: missing uv shebang, executable bit, or PEP 723 metadata")
            failures += 1

    skill_md = SKILL_DIR / "SKILL.md"
    skill_text = skill_md.read_text()
    if (
        "~/.claude/skills/image-gen/scripts/<script>.py" in skill_text
        and "uv run --script" in skill_text
        and "fallback" in skill_text.lower()
    ):
        print("  SKILL.md: direct execution and uv fallback documented")
    else:
        print("  SKILL.md: direct execution or uv fallback documentation missing")
        failures += 1

    return failures


def check_provider_protocol() -> int:
    failures = 0

    print("\n=== Provider Adapter Protocol Check ===")
    for provider, config in PROVIDERS.items():
        path = SCRIPTS_DIR / config["script"]
        text = path.read_text()
        tree = ast.parse(text)
        options = argparse_options(tree)
        functions = top_level_functions(tree)
        local_imports = local_script_imports(tree)
        protocol = provider_protocol(path)

        missing_options = [option for option in PROVIDER_REQUIRED_OPTIONS if option not in options]
        missing_functions = [
            function_name
            for function_name in PROVIDER_REQUIRED_FUNCTIONS
            if function_name not in functions
        ]
        disallowed_imports = sorted(local_imports - ALLOWED_PROVIDER_LOCAL_IMPORTS)
        protocol_problems = validate_provider_protocol(provider, protocol)

        problems = []
        if missing_options:
            problems.append(f"missing options: {', '.join(missing_options)}")
        if missing_functions:
            problems.append(f"missing functions: {', '.join(missing_functions)}")
        if disallowed_imports:
            problems.append(f"disallowed local imports: {', '.join(disallowed_imports)}")
        problems.extend(protocol_problems)
        if "record_generation(" not in text:
            problems.append("does not record successful generations")
        if "print(output_path.resolve())" not in text:
            problems.append("does not print resolved output path as final success line")

        if problems:
            print(f"  {provider}: failed ({'; '.join(problems)})")
            failures += 1
        else:
            print(f"  {provider}: protocol OK")

    return failures


def provider_protocol(path: Path) -> dict:
    result = subprocess.run(
        [sys.executable, str(path), "--protocol"],
        capture_output=True,
        text=True,
        timeout=20,
    )
    if result.returncode != 0:
        return {"_error": result.stderr.strip() or result.stdout.strip() or "unknown error"}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        return {"_error": f"invalid JSON: {error}"}


def validate_provider_protocol(provider: str, protocol: dict) -> list[str]:
    problems = []
    if protocol.get("_error"):
        return [f"--protocol failed: {protocol['_error']}"]

    missing_keys = [key for key in PROVIDER_PROTOCOL_REQUIRED_KEYS if key not in protocol]
    if missing_keys:
        problems.append(f"protocol missing keys: {', '.join(missing_keys)}")

    if protocol.get("protocol_version") != PROVIDER_PROTOCOL_VERSION:
        problems.append("protocol_version is not image-gen-provider/v1")
    if protocol.get("provider") != provider:
        problems.append(f"protocol provider is {protocol.get('provider')!r}")
    if not protocol.get("default_model"):
        problems.append("protocol default_model is missing")
    if protocol.get("final_stdout") != "resolved_output_path":
        problems.append("protocol final_stdout must be resolved_output_path")
    if protocol.get("history") != "generations.jsonl":
        problems.append("protocol history must be generations.jsonl")

    protocol_options = set(protocol.get("required_options") or [])
    missing_protocol_options = [
        option for option in PROVIDER_REQUIRED_OPTIONS if option not in protocol_options
    ]
    if missing_protocol_options:
        problems.append(
            "protocol missing required_options: " + ", ".join(missing_protocol_options)
        )

    protocol_imports = set(protocol.get("local_helper_imports") or [])
    disallowed_protocol_imports = sorted(protocol_imports - ALLOWED_PROVIDER_LOCAL_IMPORTS)
    if disallowed_protocol_imports:
        problems.append(
            "protocol disallowed local_helper_imports: "
            + ", ".join(disallowed_protocol_imports)
        )

    supports = protocol.get("supports")
    if not isinstance(supports, dict) or not supports:
        problems.append("protocol supports must be a non-empty object")

    return problems


def argparse_options(tree: ast.AST) -> set[str]:
    options: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Attribute) or node.func.attr != "add_argument":
            continue
        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value.startswith("--"):
                options.add(arg.value)
    return options


def top_level_functions(tree: ast.AST) -> set[str]:
    return {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}


def local_script_imports(tree: ast.AST) -> set[str]:
    local_modules = {path.stem for path in SCRIPTS_DIR.glob("*.py")}
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".", 1)[0]
                if root in local_modules:
                    imports.add(root)
        elif isinstance(node, ast.ImportFrom) and node.module:
            root = node.module.split(".", 1)[0]
            if root in local_modules:
                imports.add(root)
    return imports


def check_history_logging() -> int:
    print("\n=== History Logging Check ===")
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        output = tmp / "sample.png"
        output.write_bytes(base64.b64decode(ONE_PIXEL_PNG))
        record_generation(
            provider="test",
            model="test-model",
            prompt="one pixel test prompt",
            output_path=output,
            parameters={"size": "1x1", "unused": None},
            data_dir=tmp / "data",
        )

        history_path = tmp / "data" / "generations.jsonl"
        if not history_path.exists():
            print("  history file: missing")
            return 1

        entry = json.loads(history_path.read_text().splitlines()[0])
        expected = {
            "provider": "test",
            "model": "test-model",
            "prompt": "one pixel test prompt",
            "output_size_bytes": output.stat().st_size,
        }
        for key, value in expected.items():
            if entry.get(key) != value:
                print(f"  {key}: expected {value!r}, got {entry.get(key)!r}")
                return 1
        if entry.get("dimensions") != {"width": 1, "height": 1}:
            print(f"  dimensions: unexpected {entry.get('dimensions')!r}")
            return 1
        if "unused" in entry.get("parameters", {}):
            print("  parameters: None values were not compacted")
            return 1

    print("  generations.jsonl: OK")
    return 0


def check_review_candidate_matching() -> int:
    print("\n=== Review Gallery Candidate Matching Check ===")
    outputs = [
        {
            "provider": "openai",
            "model": "gpt-image-2",
            "path": "candidates/logo__openai__regen-20260516-155537.png",
        },
        {
            "provider": "fal",
            "model": "fal-ai/flux-2-pro",
            "path": "candidates/logo__fal__regen-20260516-155120__regen-20260516-155653.png",
        },
    ]

    checks = [
        (
            "candidate_id",
            find_candidates(outputs, {"candidate_id": candidate_identity(outputs[0])}),
            outputs[0],
        ),
        (
            "provider/model",
            find_candidates(outputs, {"provider": "fal", "model": "fal-ai/flux-2-pro"}),
            outputs[1],
        ),
        (
            "stale path lineage",
            find_candidates(outputs, {"path": "candidates/logo__fal.png"}),
            outputs[1],
        ),
    ]
    for label, matches, expected in checks:
        if not matches or matches[0] is not expected:
            print(f"  {label}: failed")
            return 1

    if candidate_lineage_key("candidates/logo__fal__regen-20260516-155120.png") != "candidates/logo__fal":
        print("  lineage normalization: failed")
        return 1
    normalized = normalize_ranking(
        ["candidates/logo__fal.png", "candidates/logo__openai.png"],
        outputs,
    )
    if normalized != [outputs[1]["path"], outputs[0]["path"]]:
        print(f"  ranking normalization: unexpected {normalized!r}")
        return 1

    print("  stale path and identity fallback: OK")
    return 0


def check_example_manifest_schema() -> int:
    print("\n=== Example Manifest Schema Check ===")
    with tempfile.TemporaryDirectory() as tmpdir:
        output_dir = Path(tmpdir)
        example = Example(
            id="logo",
            prompt="Logo prompt",
            output_ext=".png",
            args_by_provider={"openai": ("--size", "1024x1024")},
        )
        preset = ModelPreset(
            id="openai:gpt-image-2",
            provider="openai",
            script="generate_openai.py",
            model="gpt-image-2",
            note="test preset",
        )
        output = output_dir / "logo__openai-gpt-image-2.png"
        output.write_bytes(base64.b64decode(ONE_PIXEL_PNG))
        manifest = initial_manifest(output_dir=output_dir, examples=[example], presets=[preset])
        entry = output_entry(
            preset=preset,
            example=example,
            result={"returncode": 0, "output_path": str(output)},
            output_dir=output_dir,
        )
        if entry is None:
            print("  output entry: missing")
            return 1
        manifest["outputs"].append(entry)

        if manifest.get("prompt") != example.prompt:
            print("  prompt: missing top-level review prompt")
            return 1
        outputs = manifest.get("outputs")
        if not isinstance(outputs, list) or len(outputs) != 1:
            print("  outputs: missing review candidates")
            return 1
        output_entry_value = outputs[0]
        expected = {
            "candidate_id": "logo:openai:gpt-image-2",
            "example": "logo",
            "model": "gpt-image-2",
            "path": "logo__openai-gpt-image-2.png",
            "preset": "openai:gpt-image-2",
            "provider": "openai",
        }
        for key, value in expected.items():
            if output_entry_value.get(key) != value:
                print(f"  {key}: expected {value!r}, got {output_entry_value.get(key)!r}")
                return 1

    print("  reviewable manifest: OK")
    return 0


def env_names(provider: str) -> tuple[str, ...]:
    return PROVIDERS[provider]["env"]


def check_env(provider: str) -> bool:
    """Check if any accepted API key is set for provider."""
    return any(os.environ.get(env_var) for env_var in env_names(provider))


def report_env(providers: list[str], require: bool) -> int:
    failures = 0

    load_dotenv_files()
    print("\n=== Environment Check ===")
    for provider in providers:
        ok = check_env(provider)
        names = " or ".join(env_names(provider))
        status = "OK" if ok else "missing"
        print(f"  {provider}: {names} {status}")
        if require and not ok:
            failures += 1
    return failures


def run_generation(provider: str, output: Path) -> tuple[bool, str]:
    """Run actual image generation. Returns (success, message)."""
    script = SCRIPTS_DIR / PROVIDERS[provider]["script"]
    try:
        result = subprocess.run(
            [
                str(script),
                "--prompt",
                TEST_PROMPT,
                "--output",
                str(output),
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
        if result.returncode != 0:
            return False, result.stderr.strip() or "Unknown error"
        actual_output = output
        if result.stdout.strip():
            actual_output = Path(result.stdout.strip().splitlines()[-1])
        if not actual_output.exists() or actual_output.stat().st_size == 0:
            return False, "Output file missing or empty"
        return True, f"Generated {actual_output.stat().st_size} bytes"
    except subprocess.TimeoutExpired:
        return False, "Timeout (180s)"
    except Exception as e:
        return False, str(e)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test image-gen skill",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--generate",
        "-g",
        action="store_true",
        help="Run actual generation and keep outputs (costs $)",
    )
    parser.add_argument("--check-env", action="store_true", help="Report provider API keys")
    parser.add_argument(
        "--require-env",
        action="store_true",
        help="Fail when --check-env finds missing API keys",
    )
    parser.add_argument(
        "--provider",
        "-p",
        choices=list(PROVIDERS.keys()),
        help="Test specific provider only",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Generation output directory (default: outputs/test-runs/{timestamp})",
    )
    args = parser.parse_args()

    providers = [args.provider] if args.provider else list(PROVIDERS.keys())
    failures = check_static()
    failures += check_provider_protocol()
    failures += check_history_logging()
    failures += check_review_candidate_matching()
    failures += check_example_manifest_schema()

    if args.check_env or args.require_env:
        failures += report_env(providers, require=args.require_env)

    if args.generate:
        load_dotenv_files()
        print("\n=== Generation Test ===")
        configured = [provider for provider in providers if check_env(provider)]
        if not configured:
            print(
                "  no configured providers; set API keys or choose --check-env "
                "for a free configuration report"
            )
            failures += 1

        run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_dir = args.output_dir or default_output_dir() / "test-runs" / run_id
        output_dir.mkdir(parents=True, exist_ok=True)
        print(f"  output_dir: {output_dir.resolve()}")

        for p in providers:
            if not check_env(p):
                status = "failed" if args.provider else "skipped"
                print(f"  {p}: {status} (no API key)")
                if args.provider:
                    failures += 1
                continue
            output = output_dir / f"test_{p}{PROVIDERS[p]['ext']}"
            print(f"  {p}: generating...", end=" ", flush=True)
            ok, msg = run_generation(p, output)
            print("OK" if ok else "failed", msg)
            if not ok:
                failures += 1

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
