#!/usr/bin/env python3
"""Validate ASCII box diagram alignment consistency.

Checks that all lines within each box have their border characters
at the same column. Does not fix anything — just reports problems.
"""

import re
import sys
from pathlib import Path


PLUS_BORDER_RE = re.compile(r"\+[-=]+\+")
UNICODE_BORDER_RE = re.compile(r"[┌┐└┘][─━]+[┌┐└┘]")
FENCE_OPEN_RE = re.compile(r"^(\s*)(```|~~~)")
TABLE_SEP_RE = re.compile(r"^\s*\|[\s:-]*[-:][\s:-]*\|[\s:|-]*$")


def find_boxes(lines: list[str]) -> list[dict]:
    """Find box diagrams and return their structure."""
    boxes: list[dict] = []
    fenced: set[int] = set()

    # Mark fenced code block lines
    in_fence = False
    fence_char = ""
    for i, line in enumerate(lines):
        if not in_fence:
            m = FENCE_OPEN_RE.match(line)
            if m:
                in_fence = True
                fence_char = m.group(2)
                fenced.add(i)
        else:
            fenced.add(i)
            if line.strip() == fence_char or line.strip().rstrip("`~") == "":
                if line.strip().startswith(fence_char):
                    in_fence = False

    # Mark table lines
    tables: set[int] = set()
    i = 0
    while i < len(lines):
        if i in fenced:
            i += 1
            continue
        if TABLE_SEP_RE.match(lines[i]):
            # Walk backwards and forwards to find full table
            start = i
            while start > 0 and "|" in lines[start - 1] and start - 1 not in fenced:
                start -= 1
            end = i + 1
            while end < len(lines) and "|" in lines[end] and end not in fenced:
                end += 1
            for j in range(start, end):
                tables.add(j)
            i = end
            continue
        i += 1

    # Find plus-dash box borders
    for i, line in enumerate(lines):
        if i in fenced or i in tables:
            continue
        for m in PLUS_BORDER_RE.finditer(line):
            col_start = m.start()
            col_end = m.end() - 1  # column of closing +
            width = col_end - col_start + 1

            # Look for matching bottom border and content lines
            content_lines = []
            bottom = None
            for j in range(i + 1, len(lines)):
                if j in fenced or j in tables:
                    break
                if lines[j].strip() == "":
                    break  # blank line ends the box
                jm = PLUS_BORDER_RE.search(lines[j])
                if jm and jm.start() == col_start and jm.end() - 1 == col_end:
                    bottom = j
                    break
                content_lines.append(j)

            if bottom is not None and content_lines:
                boxes.append({
                    "top": i,
                    "bottom": bottom,
                    "col_start": col_start,
                    "col_end": col_end,
                    "width": width,
                    "content_lines": content_lines,
                    "style": "plus",
                })

    # Find unicode box borders
    for i, line in enumerate(lines):
        if i in fenced or i in tables:
            continue
        for m in UNICODE_BORDER_RE.finditer(line):
            col_start = m.start()
            col_end = m.end() - 1
            width = col_end - col_start + 1

            content_lines = []
            bottom = None
            for j in range(i + 1, len(lines)):
                if j in fenced or j in tables:
                    break
                if lines[j].strip() == "":
                    break
                jm = UNICODE_BORDER_RE.search(lines[j])
                if jm and jm.start() == col_start and jm.end() - 1 == col_end:
                    bottom = j
                    break
                content_lines.append(j)

            if bottom is not None and content_lines:
                boxes.append({
                    "top": i,
                    "bottom": bottom,
                    "col_start": col_start,
                    "col_end": col_end,
                    "width": width,
                    "content_lines": content_lines,
                    "style": "unicode",
                })

    return boxes


def validate_box(lines: list[str], box: dict) -> list[str]:
    """Check that content lines have border chars at the right columns."""
    errors = []
    open_char = "|" if box["style"] == "plus" else "│"
    col_start = box["col_start"]
    col_end = box["col_end"]

    for line_idx in box["content_lines"]:
        line = lines[line_idx]
        if len(line) <= col_start:
            errors.append(
                f"  line {line_idx + 1}: too short ({len(line)} chars), "
                f"expected opening '{open_char}' at column {col_start + 1}"
            )
            continue

        if line[col_start] != open_char:
            continue  # not a content line of this box (could be blank or nested)

        # Find the closing border char
        # It should be at col_end
        if len(line) <= col_end or line[col_end] != open_char:
            # Find where it actually is
            actual_end = None
            # Search backwards from end of line for the border char
            for k in range(len(line) - 1, col_start, -1):
                if line[k] == open_char:
                    actual_end = k
                    break
            if actual_end is not None and actual_end != col_end:
                errors.append(
                    f"  line {line_idx + 1}: closing '{open_char}' at column {actual_end + 1}, "
                    f"expected column {col_end + 1}"
                )
            elif actual_end is None:
                errors.append(
                    f"  line {line_idx + 1}: no closing '{open_char}' found"
                )

    return errors


def validate_file(path: Path) -> list[str]:
    """Validate all boxes in a file. Returns list of error strings."""
    content = path.read_text()
    lines = content.splitlines()
    boxes = find_boxes(lines)
    all_errors = []

    for box in boxes:
        errors = validate_box(lines, box)
        if errors:
            all_errors.append(
                f"Box at lines {box['top'] + 1}-{box['bottom'] + 1} "
                f"(width {box['width']}, columns {box['col_start'] + 1}-{box['col_end'] + 1}):"
            )
            all_errors.extend(errors)

    return all_errors


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: validate.py <file>...", file=sys.stderr)
        sys.exit(2)

    exit_code = 0
    for arg in sys.argv[1:]:
        path = Path(arg)
        if not path.exists():
            print(f"SKIP  {path} (not found)")
            continue
        errors = validate_file(path)
        if errors:
            print(f"FAIL  {path}")
            for e in errors:
                print(e)
            exit_code = 1
        else:
            print(f"OK    {path}")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
