#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["openai"]
# ///
"""Generate images using OpenAI's gpt-image-1 model."""

import argparse
import base64
import os
import sys
from datetime import datetime
from pathlib import Path

from openai import OpenAI, AuthenticationError, APIConnectionError, RateLimitError, BadRequestError


def error_exit(msg: str, hint: str | None = None) -> None:
    print(f"Error: {msg}", file=sys.stderr)
    if hint:
        print(f"\n{hint}", file=sys.stderr)
    sys.exit(1)


def get_api_key() -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        error_exit(
            "OPENAI_API_KEY environment variable not set",
            "To fix, either:\n"
            "  1. Add to ~/.env:      OPENAI_API_KEY=your-key-here\n"
            "  2. Or export in shell: export OPENAI_API_KEY=your-key-here\n\n"
            "Get your API key at: https://platform.openai.com/api-keys"
        )
    return api_key


def check_config() -> None:
    api_key = get_api_key()
    client = OpenAI(api_key=api_key)
    try:
        client.models.list()
        print("OK: OPENAI_API_KEY is valid")
    except AuthenticationError:
        error_exit(
            "OPENAI_API_KEY is invalid or expired",
            "Get a new API key at: https://platform.openai.com/api-keys"
        )
    except APIConnectionError:
        error_exit("Cannot connect to OpenAI API", "Check your internet connection")


def generate_image(
    prompt: str,
    output: Path,
    size: str = "1024x1024",
    quality: str = "standard",
) -> Path:
    api_key = get_api_key()
    client = OpenAI(api_key=api_key)

    try:
        response = client.images.generate(
            model="gpt-image-1",
            prompt=prompt,
            n=1,
            size=size,
            quality=quality,
        )
    except AuthenticationError:
        error_exit(
            "OPENAI_API_KEY is invalid or expired",
            "Get a new API key at: https://platform.openai.com/api-keys"
        )
    except APIConnectionError:
        error_exit("Cannot connect to OpenAI API", "Check your internet connection")
    except RateLimitError:
        error_exit(
            "Rate limit exceeded or insufficient quota",
            "Wait a moment and try again, or check your usage at:\n"
            "https://platform.openai.com/usage"
        )
    except BadRequestError as e:
        if "content_policy" in str(e).lower() or "safety" in str(e).lower():
            error_exit(
                f"Content policy violation for prompt: {prompt[:50]}...",
                "Try rephrasing your prompt to avoid restricted content"
            )
        raise

    image_data = base64.b64decode(response.data[0].b64_json)
    output.write_bytes(image_data)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate images with OpenAI gpt-image-1")
    parser.add_argument("--prompt", "-p", help="Text description of the image")
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="Output file path (default: ./generated-{timestamp}.png)",
    )
    parser.add_argument(
        "--size",
        "-s",
        default="1024x1024",
        choices=["1024x1024", "1024x1792", "1792x1024"],
        help="Image size (default: 1024x1024)",
    )
    parser.add_argument(
        "--quality",
        "-q",
        default="auto",
        choices=["low", "medium", "high", "auto"],
        help="Image quality (default: auto)",
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
        size=args.size,
        quality=args.quality,
    )
    print(output_path.resolve())


if __name__ == "__main__":
    main()
