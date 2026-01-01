# Project Configuration Checklist

When setting up Claude Code for a new project.

## Quick Setup (5 min)

- [ ] Create `.claude/` directory in project root
- [ ] Add `CLAUDE.md` with:
  - Tech stack (languages, frameworks)
  - Package manager and key commands (`bun test`, `pnpm run dev`)
  - Any project-specific conventions
- [ ] Decide: Use global config or add `settings.json`?

## Full Setup (15 min)

### 1. Project Context (.claude/CLAUDE.md)

```markdown
# Project Name

## Stack
- Runtime: Bun/Node/Python
- Framework: Hono/FastAPI/etc
- Package manager: bun/pnpm/poetry

## Commands
- `bun test` - Run tests
- `bun run dev` - Start dev server
- `bun run deploy` - Deploy to production

## Conventions
- (Any project-specific patterns)
```

### 2. Permissions (.claude/settings.json)

Copy from `~/.claude/references/permission-templates.md`:
- [ ] Pick base template (minimal/standard/full)
- [ ] Add package manager permissions
- [ ] Add deployment permissions if needed
- [ ] Include security denies

### 3. Task Tracking

Choose approach based on project type:

| Type | Approach |
|------|----------|
| Multi-session with handoffs | Beads (`bd init`) |
| Design-heavy features | Todos (`mkdir todos && touch todos/AGENTS.md`) |
| Simple/single-session | Use built-in TodoWrite |

### 4. Hooks (Optional)

Add hooks for:
- [ ] Beads integration (if using beads)
- [ ] Custom status line
- [ ] Pre-compact priming

See `~/.claude/references/hook-patterns.md`.

### 5. Skills (Optional)

Check if global skills cover your needs. Add project-specific skills only if:
- Unique workflow not covered globally
- Domain-specific knowledge required

## Verification

```bash
# Check what's configured
ls -la .claude/

# Verify CLAUDE.md is readable
cat .claude/CLAUDE.md

# Test permissions work
claude --print-settings
```

## Common Patterns by Stack

### Cloudflare Workers (TypeScript)
```
.claude/
├── CLAUDE.md          # Stack: Bun, Hono, Workers
└── settings.json      # wrangler permissions
```

### Python API (FastAPI/Flask)
```
.claude/
├── CLAUDE.md          # Stack: uv/poetry, FastAPI
└── settings.json      # poetry/uv permissions
```

### iOS/Swift
```
.claude/
├── CLAUDE.md          # Stack: Swift, SwiftUI
├── settings.json      # xcodebuild permissions
└── skills/            # iOS-specific skills
```
