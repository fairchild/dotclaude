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

from openai import OpenAI


def generate_image(
    prompt: str,
    output: Path,
    size: str = "1024x1024",
    quality: str = "standard",
) -> Path:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    response = client.images.generate(
        model="gpt-image-1",
        prompt=prompt,
        n=1,
        size=size,
        quality=quality,
    )

    # gpt-image-1 returns base64 by default
    image_data = base64.b64decode(response.data[0].b64_json)
    output.write_bytes(image_data)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate images with OpenAI gpt-image-1")
    parser.add_argument("--prompt", "-p", required=True, help="Text description of the image")
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
    args = parser.parse_args()

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
