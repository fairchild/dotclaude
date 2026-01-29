---
description: Run code review via Codex CLI with non-Claude models (GPT-5, o3, Ollama)
---

## Arguments

- `-m MODEL`: Model (default: gpt-5.2-codex)
- `--oss`: Use Ollama local model
- `--uncommitted`: Review uncommitted changes only
- Remaining text: Custom review instructions

## Workflow

1. Show `git diff --stat` against origin/main
2. Run:
   ```bash
   codex review --base origin/main [-m MODEL] [--oss] [--uncommitted] ["INSTRUCTIONS"]
   ```
3. Present output, offer to address issues
