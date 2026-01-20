#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["google-genai"]
# ///
"""Generate images using Google's Gemini image models (Nano Banana Pro)."""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

from google import genai
from google.genai import types
from google.genai.errors import ClientError, ServerError


MIME_TO_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
EXT_TO_MIME = {v: k for k, v in MIME_TO_EXT.items()}


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
    output: Path | None,
    model: str = "gemini-3-pro-image-preview",
    aspect_ratio: str = "1:1",
    image_size: str | None = None,
) -> Path:
    api_key = get_api_key()
    client = genai.Client(api_key=api_key)

    image_config_kwargs = {"aspect_ratio": aspect_ratio}
    if image_size:
        image_config_kwargs["output_image_size"] = image_size

    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(**image_config_kwargs),
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

    for part in response.parts:
        if part.inline_data is not None:
            mime_type = part.inline_data.mime_type
            actual_ext = MIME_TO_EXT.get(mime_type, ".jpg")

            if output is None:
                timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                output = Path(f"./generated-{timestamp}{actual_ext}")
            else:
                user_ext = output.suffix.lower()
                if user_ext and user_ext != actual_ext:
                    corrected = output.with_suffix(actual_ext)
                    print(f"Note: API returned {mime_type}, saving as {corrected.name} instead of {output.name}", file=sys.stderr)
                    output = corrected

            output.write_bytes(part.inline_data.data)
            return output

    error_exit("No image in response", "The API returned empty results. Try a different prompt.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate images with Google Gemini (Nano Banana Pro)")
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
        default="gemini-3-pro-image-preview",
        help="Model to use (default: gemini-3-pro-image-preview aka Nano Banana Pro)",
    )
    parser.add_argument(
        "--aspect-ratio",
        "-a",
        default="1:1",
        help="Aspect ratio (default: 1:1, options: 1:1, 16:9, 9:16, 21:9)",
    )
    parser.add_argument(
        "--image-size",
        "-s",
        default=None,
        help="Output size for Pro model (options: 1K, 2K, 4K)",
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

    output_path = generate_image(
        prompt=args.prompt,
        output=args.output,
        model=args.model,
        aspect_ratio=args.aspect_ratio,
        image_size=args.image_size,
    )
    print(output_path.resolve())


if __name__ == "__main__":
    main()
