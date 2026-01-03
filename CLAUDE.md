# Context

My name is Michael.
Today is sometime in the fourth quarter of 2025.

## Personal expressed

I prefer to not have very long cli commands because they make scrolling through my terminal history less smooth.
I like to organize code in narrative fashion when possible to do so without forcing it.

## Development Tools

- We use uv to manage Python dependencies
- We use mise to manage runtimes and environment variables (replaces direnv)
  - Configured with `status.show_env = true` and `status.show_tools = true` for direnv-like output
  - Use `.mise.toml` with `[env]` section for environment variables
  - Reference `.env` files with `_.file = ".env"` in the `[env]` section
  - Shows `+VAR` when loading, `-VAR` when unloading variables

## Code Philosophy

- Keep code well type hinted and concise
- Avoid comments and documentation that is clearly expressed by type hints and structure
- Code can be poetry

## Testing

Test behavior over implementation details

## Tips and Tools

- remember that we have the github cli, `gh`, installed and available
- remember to avoid using `git add -A` unless certain there are no untracked files or changes in our working tree
- When writing a single-file Python script, include a uv shebang and PEP 723 metadata for dependencies at the top; uv will automatically create and reuse a virtual environment for the script, install listed packages, and run it with minimal setup whenever executed.

### GitHub PR Review Comment Replies

**IMPORTANT**: When addressing PR review comments, ALWAYS reply in-thread like a user would in the GitHub UI.

To reply directly to a PR review comment (in-thread), use the REST API with `in_reply_to`:

```bash
# Get the comment ID from the review comment URL
# Example: https://github.com/owner/repo/pull/123#discussion_r2404685950
# The comment ID is 2404685950

gh api /repos/owner/repo/pulls/PR_NUMBER/comments \
  -X POST \
  -f body="Your reply message here" \
  -F in_reply_to=COMMENT_ID
```

**When to use this:**
- When addressing code review feedback
- When explaining fixes you've made in response to review comments
- Any time you need to respond to a specific review thread

**Do NOT use:**
- `gh pr comment` - creates top-level comments, not threaded replies
- GraphQL mutations - unreliable for review comment threads

This creates a threaded reply that appears directly under the original review comment, exactly like manual replies in the GitHub UI.

## Languages & Runtimes

- **Python**: uv for dependencies and scripts
- **TypeScript**: bun for runtime and package management
- Prefer single-file scripts over adding MCP servers for extending capabilities

### Package Manager Detection

Detect package manager from lockfiles (check in order):
- `bun.lock` → `bun`
- `pnpm-lock.yaml` → `pnpm`
- `package-lock.json` → `npm`
- `uv.lock` → `uv`

Use the detected manager for all commands:
- Install: `bun install`, `pnpm install`, `npm install`, `uv sync`
- Run scripts: `bun run`, `pnpm run`, `npm run`, `uv run`
- Add deps: `bun add`, `pnpm add`, `npm install`, `uv add`

## Dependencies

- Minimal, stdlib-preferred
- Reach for external packages only when they provide clear value
- Clone dependencies to explore source when docs are insufficient
  - Third-party repos: `~/code/github/*`
  - Feel free to clone repos to troubleshoot or understand behavior

## Git

- Conventional commits (`feat:`, `fix:`, `chore:`, etc.)
- Shell: zsh

## Task Tracking

Choose approach based on project needs:

| Approach | When to Use |
|----------|-------------|
| **Beads** (`bd`) | Multi-session handoffs, complex dependencies, cross-repo coordination |
| **Todos/AGENTS.md** | Design-heavy features, narrative plans, retrospectives |
| **TodoWrite** (built-in) | Simple session tasks, quick fixes, unconfigured projects |

Beads = issues as data (automate). Todos = work as documentation (narrate).

## References

- `~/.claude/references/permission-templates.md` - Copy-paste permission blocks
- `~/.claude/references/hook-patterns.md` - Standard hook configurations
- `~/.claude/references/project-config-checklist.md` - New project setup
- `bun ~/.claude/scripts/config-inventory.ts` - Scan projects for config status