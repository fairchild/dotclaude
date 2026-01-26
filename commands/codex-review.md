---
description: Get code review from Codex CLI (GPT/o3/local models)
---

Get a code review using OpenAI's Codex CLI with different models than Claude.

## Usage

- `/codex-review` - Review with default model (gpt-5.2-codex)
- `/codex-review -m o3` - Review with o3 reasoning model
- `/codex-review --local` - Review with local Ollama model
- `/codex-review "focus on security"` - Review with custom instructions
- `/codex-review --uncommitted` - Review only uncommitted changes

## Workflow

Invoke the `codex-review` skill to execute the review workflow.
