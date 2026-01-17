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


MIME_TO_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def generate_image(
    prompt: str,
    output: Path | None,
    model: str = "gemini-3-pro-image-preview",
    aspect_ratio: str = "1:1",
    image_size: str | None = None,
) -> Path:
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GOOGLE_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    image_config_kwargs = {"aspect_ratio": aspect_ratio}
    if image_size:
        image_config_kwargs["output_image_size"] = image_size

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(**image_config_kwargs),
        ),
    )

    for part in response.parts:
        if part.inline_data is not None:
            mime_type = part.inline_data.mime_type
            ext = MIME_TO_EXT.get(mime_type, ".jpg")
            if output is None:
                timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                output = Path(f"./generated-{timestamp}{ext}")
            output.write_bytes(part.inline_data.data)
            return output

    print("Error: No image in response", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate images with Google Gemini (Nano Banana Pro)")
    parser.add_argument("--prompt", "-p", required=True, help="Text description of the image")
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
    args = parser.parse_args()

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
