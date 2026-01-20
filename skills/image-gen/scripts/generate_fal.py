#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["fal-client", "requests"]
# ///
"""Generate images using fal.ai's Flux models."""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

import fal_client
import requests
from fal_client.client import FalClientHTTPError


CONTENT_TYPE_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def error_exit(msg: str, hint: str | None = None) -> None:
    print(f"Error: {msg}", file=sys.stderr)
    if hint:
        print(f"\n{hint}", file=sys.stderr)
    sys.exit(1)


def get_api_key() -> str:
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        error_exit(
            "FAL_KEY environment variable not set",
            "To fix, either:\n"
            "  1. Add to ~/.env:      FAL_KEY=your-key-here\n"
            "  2. Or export in shell: export FAL_KEY=your-key-here\n\n"
            "Get your API key at: https://fal.ai/dashboard/keys"
        )
    return api_key


def check_config() -> None:
    api_key = get_api_key()
    os.environ["FAL_KEY"] = api_key
    try:
        fal_client.api.api_key_status()
        print("OK: FAL_KEY is valid")
    except FalClientHTTPError as e:
        if "401" in str(e) or "Unauthorized" in str(e):
            error_exit(
                "FAL_KEY is invalid",
                "Get a new API key at: https://fal.ai/dashboard/keys"
            )
        raise
    except Exception:
        print("OK: FAL_KEY is set (validation endpoint unavailable)")


def generate_image(
    prompt: str,
    output: Path,
    model: str = "fal-ai/flux/dev",
) -> Path:
    api_key = get_api_key()
    os.environ["FAL_KEY"] = api_key

    try:
        result = fal_client.subscribe(
            model,
            arguments={"prompt": prompt, "num_images": 1},
        )
    except FalClientHTTPError as e:
        err_str = str(e)
        if "401" in err_str or "Unauthorized" in err_str or "Authentication is required" in err_str:
            error_exit(
                "FAL_KEY is invalid or expired",
                "Get a new API key at: https://fal.ai/dashboard/keys"
            )
        if "429" in err_str or "rate" in err_str.lower():
            error_exit(
                "Rate limit exceeded",
                "Wait a moment and try again, or check your usage at:\n"
                "https://fal.ai/dashboard"
            )
        if "402" in err_str or "payment" in err_str.lower() or "credit" in err_str.lower():
            error_exit(
                "Insufficient credits",
                "Add credits at: https://fal.ai/dashboard/billing"
            )
        error_exit(f"API error: {err_str}")
    except Exception as e:
        if "connect" in str(e).lower() or "network" in str(e).lower():
            error_exit("Cannot connect to fal.ai API", "Check your internet connection")
        raise

    images = result.get("images", [])
    if not images:
        error_exit("No images in response", "The API returned empty results. Try a different prompt.")

    image_url = images[0].get("url")

    try:
        image_response = requests.get(image_url, timeout=60)
        image_response.raise_for_status()
    except requests.RequestException as e:
        error_exit(f"Failed to download image: {e}", "Check your internet connection")

    content_type = image_response.headers.get("content-type", "").split(";")[0].strip()
    actual_ext = CONTENT_TYPE_TO_EXT.get(content_type, ".jpg")

    user_ext = output.suffix.lower()
    if user_ext and user_ext != actual_ext:
        corrected = output.with_suffix(actual_ext)
        print(f"Note: API returned {content_type}, saving as {corrected.name} instead of {output.name}", file=sys.stderr)
        output = corrected

    output.write_bytes(image_response.content)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate images with fal.ai Flux")
    parser.add_argument("--prompt", "-p", help="Text description of the image")
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="Output file path (default: ./generated-{timestamp}.{ext} based on response format)",
    )
    parser.add_argument(
        "--model",
        "-m",
        default="fal-ai/flux/dev",
        help="Model to use (default: fal-ai/flux/dev)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate API key configuration without generating an image",
    )
    args = parser.parse_args()

    if args.check:
        check_config()
        return

    if not args.prompt:
        parser.error("--prompt is required unless using --check")

    if args.output is None:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        args.output = Path(f"./generated-{timestamp}.png")

    output_path = generate_image(
        prompt=args.prompt,
        output=args.output,
        model=args.model,
    )
    print(output_path.resolve())


if __name__ == "__main__":
    main()
