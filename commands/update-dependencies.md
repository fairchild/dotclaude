---
description: Run intelligent dependency updates with batching and learning
---

Run the update-dependencies skill to analyze and update dependencies.

## What This Does

1. **Detects ecosystem** - npm/bun/pnpm, uv/poetry, or cargo
2. **Audits security** - Finds vulnerabilities by severity
3. **Analyzes outdated** - Categorizes by major/minor/patch
4. **Checks history** - Reviews past update outcomes
5. **Groups intelligently** - Batches related packages
6. **Updates + tests** - Applies changes, verifies
7. **Creates PR** - With changelog and risk assessment
8. **Logs outcome** - For continuous improvement

## Options

| Option | Effect |
|--------|--------|
| `security only` | Only fix security vulnerabilities |
| `plan` | Enter plan mode - analyze, design strategy, get approval |
| `major` | Include major version updates |
| `group <name>` | Update specific ecosystem group |

## Examples

- `/update-dependencies` - Auto-detect and proceed
- `/update-dependencies plan` - Analyze and plan for approval
- `/update-dependencies security only` - Just fix vulnerabilities
- `/update-dependencies major` - Include breaking changes

## Quick Analysis

Run the analysis script first to see current state:

```bash
bun ~/.claude/skills/update-dependencies/scripts/analyze.ts
```

Shows:
- Detected ecosystem
- Security vulnerabilities by severity
- Outdated packages by update type
