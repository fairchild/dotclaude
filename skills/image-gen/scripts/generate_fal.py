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


def generate_image(
    prompt: str,
    output: Path,
    model: str = "fal-ai/flux/dev",
) -> Path:
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        print("Error: FAL_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    os.environ["FAL_KEY"] = api_key

    result = fal_client.subscribe(
        model,
        arguments={"prompt": prompt, "num_images": 1},
    )

    images = result.get("images", [])
    if not images:
        print("Error: No images in response", file=sys.stderr)
        sys.exit(1)

    image_url = images[0].get("url")

    # Download image
    image_response = requests.get(image_url)
    image_response.raise_for_status()
    output.write_bytes(image_response.content)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate images with fal.ai Flux")
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
        default="fal-ai/flux/dev",
        help="Model to use (default: fal-ai/flux/dev)",
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
