#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["google-genai"]
# ///
"""Generate images using Google's Imagen models."""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

from google import genai
from google.genai import types
from google.genai.errors import ClientError, ServerError


def error_exit(msg: str, hint: str | None = None) -> None:
    print(f"Error: {msg}", file=sys.stderr)
    if hint:
        print(f"\n{hint}", file=sys.stderr)
    sys.exit(1)


def get_api_key() -> str:
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        error_exit(
            "GOOGLE_API_KEY environment variable not set",
            "To fix, either:\n"
            "  1. Add to ~/.env:      GOOGLE_API_KEY=your-key-here\n"
            "  2. Or export in shell: export GOOGLE_API_KEY=your-key-here\n\n"
            "Get your API key at: https://aistudio.google.com/apikey"
        )
    return api_key


def check_config() -> None:
    api_key = get_api_key()
    client = genai.Client(api_key=api_key)
    try:
        list(client.models.list())
        print("OK: GOOGLE_API_KEY is valid")
    except ClientError as e:
        if "API_KEY_INVALID" in str(e) or "401" in str(e):
            error_exit(
                "GOOGLE_API_KEY is invalid",
                "Get a new API key at: https://aistudio.google.com/apikey"
            )
        raise


def generate_image(
    prompt: str,
    output: Path,
    model: str = "imagen-4.0-generate-001",
) -> Path:
    api_key = get_api_key()
    client = genai.Client(api_key=api_key)

    try:
        response = client.models.generate_images(
            model=model,
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
            ),
        )
    except ClientError as e:
        err_str = str(e)
        if "API_KEY_INVALID" in err_str or "401" in err_str:
            error_exit(
                "GOOGLE_API_KEY is invalid",
                "Get a new API key at: https://aistudio.google.com/apikey"
            )
        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
            error_exit(
                "Rate limit exceeded or quota exhausted",
                "Wait a moment and try again, or check your quota at:\n"
                "https://console.cloud.google.com/apis/dashboard"
            )
        if "safety" in err_str.lower() or "blocked" in err_str.lower():
            error_exit(
                f"Content blocked for prompt: {prompt[:50]}...",
                "Try rephrasing your prompt to avoid restricted content"
            )
        error_exit(f"API error: {err_str}")
    except ServerError:
        error_exit("Google API server error", "Try again in a moment")
    except Exception as e:
        if "connect" in str(e).lower() or "network" in str(e).lower():
            error_exit("Cannot connect to Google API", "Check your internet connection")
        raise

    if not response.generated_images:
        error_exit("No images in response", "The API returned empty results. Try a different prompt.")

    image_data = response.generated_images[0].image.image_bytes
    output.write_bytes(image_data)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate images with Google Imagen")
    parser.add_argument("--prompt", "-p", help="Text description of the image")
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="Output file path (default: ./generated-{timestamp}.png)",
    )
    parser.add_argument(
        "--model",
        "-m",
        default="imagen-4.0-generate-001",
        help="Model to use (default: imagen-4.0-generate-001, options: imagen-4.0-fast-generate-001, imagen-4.0-ultra-generate-001)",
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
