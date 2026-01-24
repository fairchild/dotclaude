#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Image-gen skill test suite.

Usage:
  uv run tests/test_image_gen.py              # Check env vars only (free)
  uv run tests/test_image_gen.py --generate   # Run actual generation (costs $)
  uv run tests/test_image_gen.py --provider openai  # Test one provider

Default mode checks:
  - OPENAI_API_KEY present
  - GOOGLE_API_KEY present
  - FAL_KEY present

With --generate:
  - Generates test image with each configured provider
  - Verifies output file exists and is non-empty
  - Cleans up test files after

Exit codes: 0 = all pass, 1 = failures
"""

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PROVIDERS = {
    "openai": {"env": "OPENAI_API_KEY", "script": "generate_openai.py", "ext": ".png"},
    "imagen": {"env": "GOOGLE_API_KEY", "script": "generate_imagen.py", "ext": ".png"},
    "gemini": {"env": "GOOGLE_API_KEY", "script": "generate_gemini.py", "ext": ".jpg"},
    "fal": {"env": "FAL_KEY", "script": "generate_fal.py", "ext": ".jpg"},
}

SKILL_DIR = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_DIR / "scripts"
TEST_PROMPT = "a simple red circle on white background"


def check_env(provider: str) -> bool:
    """Check if API key is set for provider."""
    env_var = PROVIDERS[provider]["env"]
    return bool(os.environ.get(env_var))


def run_generation(provider: str, output: Path) -> tuple[bool, str]:
    """Run actual image generation. Returns (success, message)."""
    script = SCRIPTS_DIR / PROVIDERS[provider]["script"]
    try:
        result = subprocess.run(
            ["uv", "run", str(script), "--prompt", TEST_PROMPT, "--output", str(output)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            return False, result.stderr.strip() or "Unknown error"
        if not output.exists() or output.stat().st_size == 0:
            return False, "Output file missing or empty"
        return True, f"Generated {output.stat().st_size} bytes"
    except subprocess.TimeoutExpired:
        return False, "Timeout (120s)"
    except Exception as e:
        return False, str(e)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test image-gen skill",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--generate", "-g", action="store_true",
                        help="Run actual generation (costs $)")
    parser.add_argument("--provider", "-p", choices=list(PROVIDERS.keys()),
                        help="Test specific provider only")
    args = parser.parse_args()

    providers = [args.provider] if args.provider else list(PROVIDERS.keys())
    failures = 0

    print("=== Environment Check ===")
    for p in providers:
        ok = check_env(p)
        status = "\u2713" if ok else "\u2717 missing"
        print(f"  {p}: {PROVIDERS[p]['env']} {status}")
        if not ok:
            failures += 1

    if args.generate:
        print("\n=== Generation Test ===")
        with tempfile.TemporaryDirectory() as tmpdir:
            for p in providers:
                if not check_env(p):
                    print(f"  {p}: skipped (no API key)")
                    continue
                output = Path(tmpdir) / f"test_{p}{PROVIDERS[p]['ext']}"
                print(f"  {p}: generating...", end=" ", flush=True)
                ok, msg = run_generation(p, output)
                print("\u2713" if ok else "\u2717", msg)
                if not ok:
                    failures += 1

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
