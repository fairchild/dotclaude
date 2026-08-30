# CLAUDE.md Patterns

Authoring and organizing CLAUDE.md files for Claude Code projects.

## File Locations and Loading Order

CLAUDE.md files are loaded from multiple locations, merged in order:

| Location | Scope | Purpose |
|----------|-------|---------|
| `~/.claude/CLAUDE.md` | Global | Personal preferences, style, tools <!-- portability: allow --> |
| `CLAUDE.md` (repo root) | Project | Project context, architecture, conventions |
| `.claude/CLAUDE.md` | Project | Alternative project location |
| `src/CLAUDE.md` (subdirs) | Directory | Directory-specific rules (loaded when working in that dir) |

All applicable files are concatenated. Later files don't override earlier ones — they add to them.

## What to Include

| Include | Example |
|---------|---------|
| Project architecture overview | "This is a Next.js app with Hono API" |
| Coding conventions | "Use snake_case for Python, camelCase for TS" |
| Testing expectations | "Test behavior, not implementation" |
| Build/run commands | "Use `bun test` not `npm test`" |
| Package manager | "Detect from lockfile: bun.lock → bun" |
| Critical constraints | "Never modify files in contracts/" |
| Domain-specific terms | "A 'widget' is our term for..." |

## What to Exclude

| Exclude | Why |
|---------|-----|
| Self-evident type hints | Code shows this already |
| Generic best practices | Claude already knows these |
| Lengthy API docs | Use `@path` imports or references |
| Step-by-step tutorials | CLAUDE.md is instructions, not a manual |
| Session-specific state | Use MEMORY.md for that |

## @path Imports

Pull in external files without bloating CLAUDE.md:

```markdown
# Project Instructions

Use our API conventions:
@docs/api-conventions.md

Follow the style guide:
@.github/STYLE_GUIDE.md
```

Paths are relative to the CLAUDE.md file. The imported file's content is loaded inline.

Use `@path` for:
- Large reference documents
- Shared style guides
- API specifications
- Architecture decision records

## Rules Files

`.claude/rules/*.md` files are auto-loaded as modular alternatives to CLAUDE.md:

```
.claude/rules/
├── testing.md        # "Always use vitest, test behavior not implementation"
├── security.md       # "Never commit .env files, validate all inputs"
├── git.md            # "Conventional commits, never force push main"
└── api-patterns.md   # "Use Hono, return typed responses"
```

Each rule file is a standalone markdown document. Benefits:
- **Modular** — team members can own different rule files
- **Focused** — each file covers one topic
- **Auto-loaded** — no need to import or reference them

## Size Management

CLAUDE.md is loaded into every conversation. Keep it lean:

- **Target**: <200 lines for the main file
- **Hard limit**: ~500 lines before performance degrades
- **Strategy**: Brief instructions in CLAUDE.md, details in `@path` imports or rules files

Signs your CLAUDE.md is too long:
- Contains code examples longer than 5 lines
- Repeats what the code structure already shows
- Includes full API documentation
- Has sections that only apply to specific subdirectories

## Emphasis Techniques

For critical rules that must not be ignored:

```markdown
IMPORTANT: Never modify migration files directly.

YOU MUST run `bun test` before committing.

ALWAYS use the project's configured formatter.
```

Use sparingly — if everything is emphasized, nothing is.

## Examples by Project Type

### TypeScript (bun)

```markdown
# Project

TypeScript app using bun runtime.

## Tools
- `bun test` for tests
- `bun run build` for production build
- Detect package manager from lockfile

## Conventions
- Strict TypeScript, no `any`
- Prefer type inference over explicit annotations
- Test behavior, not implementation
```

### Python (uv)

```markdown
# Project

Python service managed with uv.

## Tools
- `uv run pytest` for tests
- `uv run ruff check .` for linting

## Conventions
- Type hints on all public functions
- Use stdlib when possible
- Pydantic for data validation
```

### Monorepo

```markdown
# Project

Monorepo with packages/ directory.

## Structure
- `packages/api/` — Hono API server
- `packages/web/` — Next.js frontend
- `packages/shared/` — Shared types and utilities

## Conventions
- Changes to shared/ must not break other packages
- Each package has its own CLAUDE.md for specifics

@packages/api/CLAUDE.md
@packages/web/CLAUDE.md
```

## Common Mistakes

| Mistake | Better |
|---------|--------|
| Documenting every function | Let code speak; document non-obvious constraints |
| "Use good variable names" | Claude already does this |
| Pasting entire API docs | Use `@path` to reference them |
| Adding comments to explain CLAUDE.md | It's instructions, not documentation |
| Duplicating global rules in project | Check `~/.claude/CLAUDE.md` first <!-- portability: allow --> |
