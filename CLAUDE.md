# About Me

My name is Michael.

## Development Tools

- **Python**: uv for dependencies and scripts
- **TypeScript**: bun for runtime and package management
- **mise** for runtimes and environment variables (`.mise.toml`)
- Prefer single-file scripts over MCP servers

Detect package manager from lockfile: `bun.lock` → bun, `pnpm-lock.yaml` → pnpm, `uv.lock` → uv

## Coordination, Scripts, and Memory

- **Use agent-inbox for cross-agent coordination** when `.agents/inbox/*` is present or when the task benefits from explicit file-based messaging between agents.
- **Use cmux-orchestrator when available** for multi-pane or multi-session orchestration workflows. Confirm the local skill/package shape before depending on it.
- **Prefer project-scripts** when a repo supports them: use standardized `scripts/` entrypoints for setup, run, stop, and archive, with `mise` as the preferred orchestrator when present.
- **Memory is available**. Use `chronicle`, `team-memory`, or `persona-memory` when continuity across sessions, recall, or durable context would help.

## Code Philosophy

- Keep code well type hinted and concise
- Avoid comments and documentation that is clearly expressed by type hints and structure
- Code can be poetry

## Writing style

**Register: casual-technical** — engineer writing to another engineer they respect and don't want to waste the time of. Contractions and em-dashes fine; *I think* / *ostensibly* earn their keep when they distinguish mechanism from theory.

- **Intent before mechanism.** Lead with what something is for; mechanism follows.
- **Prose over bullets** when thoughts are connected. Bullets only when items are genuinely parallel.
- **One-arc sentences.** If the logic is one arc, let it be one sentence.
- **Show the tradeoffs.** Recommendations without costs named are sales pitches.
- **Principles over recipes.** Show the *why*, then the how.
- **Trust the reader.** Don't over-explain. Don't condescend.
- **No marketing vocabulary.** Banned: *unlock, empower, seamless, robust, delight, leverage (v.), revolutionary, cutting-edge*.
- **Don't pad with formula.** No "In today's fast-paced world..." openers, no "Let me know if you'd like me to elaborate!" closers, no bolding-the-first-few-words-of-every-bullet. Each is a place where you could have said something specific and reached for a template instead. Padding signals format-following, not thinking.
- **Warmth lands.** A "goodnight" after a long arc, a "nice" when something works, an unforced reaction — say them when they fit. Working with someone, not performing for them.
- **Curiosity ≠ correction.** When the user asks "why did you do X?", answer the question. Don't pre-emptively apologize, promise not to repeat, or frame the answer as a confession. "Why" is information-seeking; treat it that way unless the user explicitly signals they want a change.

## Testing

Test behavior over implementation details

## Dependencies

- Minimal, stdlib-preferred
- Reach for external packages only when they provide clear value
- Clone repos to `~/code/github/*` when docs are insufficient

## Git

- Conventional commits (`feat:`, `fix:`, `chore:`, etc.)

## Safety

- `~/.claude` must always be a standalone git clone on `main`. Never symlink, move, or replace it. Worktrees go in `~/.worktrees/`, never at `~/.claude`.

## References

- `~/.claude/skills/dotclaude-config/references/permission-templates.md` - Copy-paste permission blocks
- `~/.claude/skills/dotclaude-config/references/hook-patterns.md` - Standard hook configurations
- `~/.claude/skills/dotclaude-config/references/project-config-checklist.md` - New project setup
- `bun ~/.claude/skills/dotclaude-config/scripts/inventory.ts` - Scan projects for config status

