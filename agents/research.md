---
name: research
description: Deep codebase exploration to understand a problem and create a research artifact
---

# Research Subagent

Deep codebase exploration to understand a problem and create a research artifact. **Run this in a separate session** before implementation to protect context.

**Output**: `tmp/research/research-{slug}.md`

## Purpose

Research is the **investigation step** that:
- Explores relevant code and patterns
- Understands the problem space
- Creates a compressed artifact for implementation

## Why Separate Session?

Research fills the context window with exploration. By running in a separate session:
- **Fast model** does the exploration (cost-effective)
- **Capable model** gets clean context for implementation
- **Artifact** captures findings in portable form

Typical workflow:
1. Session 1 (fast model): `research {topic}` → creates artifact
2. Session 2 (capable model): Load artifact → `implement`

## Input

**Topic**: What you want to understand or implement

Examples:
- "add response caching to clerk agent"
- "fix duplicate messages in planning assistant"
- "understand how source ranking works"

## Execution Steps

### Phase 1: Issue Context

```bash
bd ready --json 2>/dev/null
bd list --status in_progress --json 2>/dev/null
```

Note any related work.

### Phase 2: Deep Codebase Exploration

This is the **context-heavy** part. Systematically explore:

1. **Core Understanding**
   - Read `CLAUDE.md`
   - Read `docs/architecture.md`
   - Scan `src/` structure

2. **Domain-Specific Files**
   - **clerk agent**: `src/agents/clerk/`
   - **planning agent**: `src/agents/planning/`
   - **UI**: `src/ui/`, `src/components/`
   - **worker**: `src/worker.ts`
   - **tests**: `tests/e2e/`

3. **Reference Docs**
   - Check `docs/references/`
   - Load relevant llms.txt files

4. **Related Tests**
   - Find existing tests: `grep -r "{keywords}" tests/`
   - Understand expected behavior

### Phase 3: Create Artifact

```bash
mkdir -p tmp/research
```

Write to `tmp/research/research-{slug}.md`:

```markdown
# Research: {topic}

> Generated: {date}
> Slug: {slug}

## Context

{Related beads issues, current state}

## Architecture Summary

{How the relevant system works}

### Key Files
| File | Purpose |
|------|---------|
| `path/to/file.ts` | {what it does} |

### Data Flow
{How data moves through the system}

## Implementation Notes

### Patterns to Follow
- {Pattern from existing code}
- {Convention from CLAUDE.md}

### Gotchas
- {Common trap}
- {Dependency quirk}

### Reference Snippets
```typescript
// Relevant pattern
{actual code}
```

## Suggested Approach

### Step-by-Step
1. {First step}
2. {Second step}

### Tests to Write
- [ ] {Test case}

## Files to Open
- `src/path/to/main.ts`
- `tests/relevant.test.ts`
```

### Phase 4: Output

```markdown
═══════════════════════════════════════════════════════════════
Research Complete

Topic: {topic}
Artifact: tmp/research/research-{slug}.md

To use this research:
1. Start implementation session (capable model)
2. Open: tmp/research/research-{slug}.md
3. Run: prime {issue-id}
   or: implement {issue-id}
═══════════════════════════════════════════════════════════════
```

## Slug Generation

Convert topic to kebab-case:
- "add response caching to clerk agent" → `clerk-response-caching`
- "fix duplicate messages" → `duplicate-messages-fix`
- "understand source ranking" → `source-ranking`

## Example: Feature Research

```
research add response caching to clerk agent

[Reads CLAUDE.md for conventions]
[Explores src/agents/clerk/ structure]
[Finds existing caching patterns in codebase]
[Reviews Cloudflare KV documentation]
[Checks related tests]

═══════════════════════════════════════════════════════════════
Research Complete

Topic: add response caching to clerk agent
Artifact: tmp/research/research-clerk-response-caching.md

Key findings:
- Use Cloudflare KV for persistence
- Cache key should include normalized query
- 5-minute TTL recommended
- Pattern exists in similar module

To implement:
1. Start new session (capable model)
2. Load artifact as context
3. Run: implement
═══════════════════════════════════════════════════════════════
```

## Example: Bug Investigation

```
research fix duplicate assistant messages in planning

[Reads planning agent implementation]
[Compares with clerk agent (working)]
[Finds persistence vs streaming difference]
[Reviews E2E test expectations]

═══════════════════════════════════════════════════════════════
Research Complete

Topic: fix duplicate assistant messages in planning
Artifact: tmp/research/research-planning-duplicate-messages.md

Root cause identified:
- Mock path calls persistMessages AND streams message
- AIChatAgent may auto-persist from stream
- Clerk agent clears DB first, avoiding duplicates

To implement:
1. Start new session (capable model)
2. Load artifact
3. Run: implement plan-7re
═══════════════════════════════════════════════════════════════
```

## Tips

- **Be specific**: "caching for clerk responses" > "caching"
- **Include the problem**: "fix X" tells what's broken
- **Name the area**: "clerk agent", "planning UI"

## Artifact Lifecycle

1. **Create**: This subagent
2. **Use**: Load in implementation session
3. **Update**: Add discoveries during implementation
4. **Delete**: After PR merged or >1 week stale

