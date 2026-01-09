# Defer Work to Future Session

Create a comprehensive todo file for work we've explored but decided not to implement now.

## Context

This command is used when we:
1. Explored an enhancement, alternative approach, or feature
2. Researched how to implement it (read code, explored patterns, maybe prototyped)
3. Decided to defer it (out of scope, lower priority, or needs more consideration)
4. Want to capture our research so a future session can execute efficiently

## Instructions

### Step 1: Gather Context

Ask me these questions to understand what we're deferring:

1. **What feature/enhancement are we deferring?** (brief name)
2. **Why did we explore it?** (what problem does it solve)
3. **Why are we deferring?** (out of scope, lower priority, needs more info, etc.)
4. **What did we learn?** (key findings from exploration)

### Step 2: Determine Category

Based on the work, select the appropriate category per `todos/AGENTS.md`:

- **plan**: Comprehensive design for new features (most common for /defer)
- **followup**: Post-merge improvements and tech debt
- **task-list**: Collection of related items

### Step 3: Create Todo File

Create a file at `todos/{feature}-{category}.md` with this structure:

```markdown
---
status: pending
category: {plan|followup|task-list}
pr: null
branch: null
score: null
retro_summary: null
completed: null
---

# {Feature Name}

## Problem Statement

{1-2 paragraphs explaining why this work matters and what problem it solves}

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| {decision point} | {what we'd choose} | {why} |

## Architecture

{ASCII diagram if helpful}

## Implementation Phases

### Phase 1: {Name}

**Files to modify:**
- `path/to/file.ts` - {what changes}

**Files to create:**
- `path/to/new-file.ts` - {purpose}

**Acceptance criteria:**
- [ ] {testable outcome}
- [ ] {testable outcome}

### Phase 2: {Name}
...

## Verification Commands

```bash
# Commands to verify the implementation works
```

## Rollback Plan

{How to undo if things go wrong}

## References

- {Related files, PRs, docs, or external resources}
```

### Step 4: Include Research Artifacts

Incorporate what we learned during exploration:
- Code snippets we prototyped or found
- Configuration examples
- API patterns from existing code
- External documentation links

### Step 5: Commit

Commit the todo file with message:
```
chore: add {feature} plan for future implementation

{One sentence on what this enables}
```

## Quality Checklist

Before finishing, verify the todo file:

- [ ] Has enough context that a fresh session can understand without the original conversation
- [ ] Includes specific file paths (with line numbers when relevant)
- [ ] Has verification commands or acceptance criteria
- [ ] References related code patterns in the codebase
- [ ] Follows the frontmatter schema from `todos/AGENTS.md`

## Example Usage

```
User: /defer
Claude: I'll help capture the work we explored for future implementation.

What feature/enhancement are we deferring?
> R2 storage for docs assets

Why did we explore it?
> Docs screenshots are gitignored, wanted persistent storage without git bloat

Why are we deferring?
> Works fine locally for now, R2 adds complexity we don't need yet

What did we learn?
> R2 bindings in wrangler.jsonc, Worker route pattern, wrangler CLI for uploads

[Creates todos/docs-r2-storage-plan.md with full implementation plan]
```
