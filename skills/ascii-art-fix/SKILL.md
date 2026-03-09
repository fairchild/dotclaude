---
name: ascii-art-fix
description: Fix misaligned right borders in ASCII art diagrams using the aadc CLI
license: Apache-2.0
metadata:
  status: experimental
---

# ASCII Art Fix

Wraps [aadc](https://github.com/Dicklesworthstone/aadc) (ASCII Art Diagram Corrector) to automatically detect and fix misaligned right borders in ASCII diagrams. Only adds padding — never removes content.

## Setup

If `which aadc` fails, build from source:

```bash
bash ~/.claude/skills/ascii-art-fix/scripts/ensure-aadc.sh
```

## Usage

Fix a file in place:
```bash
aadc -i file.md
```

Preview changes as a diff:
```bash
aadc -d file.md
```

Recursive fix across a directory:
```bash
aadc -ri docs/
```

Pipe from stdin:
```bash
echo '| short|' | aadc
```

## Key Options

| Flag | Short | Description |
|------|-------|-------------|
| `--in-place` | `-i` | Edit file in place |
| `--recursive` | `-r` | Process files recursively |
| `--diff` | `-d` | Show unified diff instead of full output |
| `--dry-run` | `-n` | Preview changes without modifying (exit 3 if changes found) |
| `--verbose` | `-v` | Show correction progress and statistics |
| `--all` | `-a` | Process all diagram-like blocks, even low-confidence ones |
| `--glob` | | Glob pattern for recursive mode (default: `*.txt,*.md`) |
| `--watch` | `-w` | Watch file for changes and auto-correct |
| `--json` | | Output results as JSON |

## When to Use

- After generating or editing ASCII diagrams in documentation
- Cleaning up docs with misaligned box-drawing characters
- Batch-fixing: `aadc -ri --glob "*.md" .`
- Before committing files with ASCII art
