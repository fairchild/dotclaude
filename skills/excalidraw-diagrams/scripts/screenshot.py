#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright"]
# ///
"""
Take a screenshot of the Excalidraw canvas.

Usage:
    uv run scripts/screenshot.py [--output PATH] [--url URL]

Options:
    --output, -o  Output path for screenshot (default: /tmp/diagram.png)
    --url, -u     Canvas URL (default: http://localhost:3000)
"""

import argparse
from playwright.sync_api import sync_playwright


def screenshot(output: str = "/tmp/diagram.png", url: str = "http://localhost:3000") -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)
        page.screenshot(path=output, full_page=True)
        browser.close()
    return output


def main():
    parser = argparse.ArgumentParser(description="Screenshot Excalidraw canvas")
    parser.add_argument("-o", "--output", default="/tmp/diagram.png", help="Output path")
    parser.add_argument("-u", "--url", default="http://localhost:3000", help="Canvas URL")
    args = parser.parse_args()

    path = screenshot(args.output, args.url)
    print(f"Screenshot saved to {path}")


if __name__ == "__main__":
    main()
