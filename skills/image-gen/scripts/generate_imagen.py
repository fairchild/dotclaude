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


def generate_image(
    prompt: str,
    output: Path,
    model: str = "imagen-4.0-generate-001",
) -> Path:
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GOOGLE_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    response = client.models.generate_images(
        model=model,
        prompt=prompt,
        config=types.GenerateImagesConfig(
            number_of_images=1,
        ),
    )

    if not response.generated_images:
        print("Error: No images in response", file=sys.stderr)
        sys.exit(1)

    image_data = response.generated_images[0].image.image_bytes
    output.write_bytes(image_data)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate images with Google Imagen")
    parser.add_argument("--prompt", "-p", required=True, help="Text description of the image")
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
    args = parser.parse_args()

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
