---
name: codex-review
description: Run code review via Codex CLI with non-Claude models such as GPT-5.2. Use for second opinion from different model, local/private review, or cross-validating Claude's review.
status: experimental
---

# Codex Review

## Arguments

- `-m MODEL`: Model (default: gpt-5.2-codex)
- `--oss`: Use Ollama local model
- `--uncommitted`: Review uncommitted changes only
- Remaining text: Custom review instructions (e.g., "focus on security")

## Workflow

1. **Context**: Get branch name, show `git diff --stat` against origin/main
2. **Build command**:
   ```bash
   codex review --base origin/main [-m MODEL] [--oss] [--uncommitted] ["INSTRUCTIONS"]
   ```
3. **Execute**: Run command, output is markdown review
4. **Present**: Show findings, offer to address issues

## Models

| Flag | Model | Use |
|------|-------|-----|
| (default) | gpt-5.2-codex | General |
| `-m o3` | o3 | Deep reasoning |
| `--oss` | Ollama | Privacy/offline |
