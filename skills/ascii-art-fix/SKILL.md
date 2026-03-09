---
name: ascii-art-fix
description: Fix misaligned right borders in ASCII art diagrams using the aadc CLI
license: Apache-2.0
metadata:
  status: experimental
  credits:
    - name: aadc
      url: https://github.com/Dicklesworthstone/aadc
      author: Jeffrey Emanuel
---

# ASCII Art Fix

Wraps [aadc](https://github.com/Dicklesworthstone/aadc) (ASCII Art Diagram Corrector) to automatically detect and fix misaligned right borders in ASCII diagrams. Only adds padding — never removes content.

## Setup

If `which aadc` fails, build from source:

```bash
bash ~/.claude/skills/ascii-art-fix/scripts/ensure-aadc.sh
```

## Caution

aadc treats markdown tables as ASCII diagrams, which **corrupts valid markdown** — it breaks separator rows and appends stray `|` to nearby text. It also pads already-aligned box diagrams unnecessarily.

**Rules:**
- **Never** run `aadc -ri` on a directory or repo — bulk operations cause widespread false positives
- **Always** preview with `-d` before applying `-i`
- **Always** review the full diff — reject changes that touch markdown tables or add trailing `|` to prose
- Target **specific files** you know contain misaligned `+---+` / `│` box art
- Best for `.txt` files or code blocks with pure ASCII box diagrams, not `.md` files with tables

## Usage

Preview changes first (always do this):
```bash
aadc -d file.txt
```

Fix a specific file in place (only after reviewing the diff):
```bash
aadc -i file.txt
```

Pipe from stdin:
```bash
echo '| short|' | aadc
```

## Key Options

| Flag | Short | Description |
|------|-------|-------------|
| `--diff` | `-d` | Show unified diff instead of full output |
| `--dry-run` | `-n` | Preview changes without modifying (exit 3 if changes found) |
| `--in-place` | `-i` | Edit file in place |
| `--verbose` | `-v` | Show correction progress and statistics |
| `--all` | `-a` | Process all diagram-like blocks, even low-confidence ones |
| `--recursive` | `-r` | Process files recursively (**avoid — see Caution**) |
| `--glob` | | Glob pattern for recursive mode (default: `*.txt,*.md`) |

## When to Use

- After generating or editing a specific file with ASCII box diagrams
- On `.txt` or plain-text files with `+---+` / `│` box-drawing borders
- When you can see the misalignment and want a targeted fix
