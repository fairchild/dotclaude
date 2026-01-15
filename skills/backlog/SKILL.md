---
name: backlog
description: Capture explored work as a backlog item for future implementation. Use when you've explored an enhancement, alternative approach, or feature but decided to defer it. Creates comprehensive plan files in backlog/ directory with enough context for a future session to execute efficiently.
license: Apache-2.0
---

# Backlog

Create a comprehensive backlog item for work we've explored but decided not to implement now.

## Context

This skill is used when we:
1. Explored an enhancement, alternative approach, or feature
2. Researched how to implement it (read code, explored patterns, maybe prototyped)
3. Decided to defer it (out of scope, lower priority, or needs more consideration)
4. Want to capture our research so a future session can execute efficiently

## Instructions

### Step 1: Gather Context

Ask these questions to understand what we're deferring:

1. **What feature/enhancement are we deferring?** (brief name)
2. **Why did we explore it?** (what problem does it solve)
3. **Why are we deferring?** (out of scope, lower priority, needs more info, etc.)
4. **What did we learn?** (key findings from exploration)

### Step 2: Determine Category

Based on the work, select the appropriate category per `backlog/AGENTS.md`:

- **plan**: Comprehensive design for new features (most common for /backlog)
- **followup**: Post-merge improvements and tech debt
- **task-list**: Collection of related items
- **ideas**: Ideas to explore, not yet developed into actionable plans

### Step 3: Create Backlog File

Create a file at `backlog/{feature}-{category}.md` with this structure:

```markdown
---
status: pending
category: {plan|followup|task-list|ideas}
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

Commit the backlog file with message:
```
chore: add {feature} to backlog

{One sentence on what this enables}
```

## Quality Checklist

Before finishing, verify the backlog file:

- [ ] Has enough context that a fresh session can understand without the original conversation
- [ ] Includes specific file paths (with line numbers when relevant)
- [ ] Has verification commands or acceptance criteria
- [ ] References related code patterns in the codebase
- [ ] Follows the frontmatter schema from `backlog/AGENTS.md`

## List Backlog Items

To see all backlog items, run:

```bash
~/.claude/skills/backlog/scripts/status.sh
```

## Example Usage

```
User: /backlog
Claude: I'll help capture the work we explored for future implementation.

What feature/enhancement are we deferring?
> R2 storage for docs assets

Why did we explore it?
> Docs screenshots are gitignored, wanted persistent storage without git bloat

Why are we deferring?
> Works fine locally for now, R2 adds complexity we don't need yet

What did we learn?
> R2 bindings in wrangler.jsonc, Worker route pattern, wrangler CLI for uploads

[Creates backlog/docs-r2-storage-plan.md with full implementation plan]
```

## Setting Up backlog/ Directory

If `backlog/` doesn't exist in the project, create it with:

```bash
mkdir -p backlog/done
```

Then create `backlog/AGENTS.md` with the schema documentation:

```markdown
# backlog/

Deferred work items for future sessions. Each file represents work identified as valuable but out of scope for the current PR.

## Frontmatter Schema

Every file must start with YAML frontmatter:

```yaml
---
status: pending          # pending | in-progress | done
category: plan           # plan | followup | task-list | ideas
pr: null                 # PR number that implements this
branch: null             # branch name that implements this
score: null              # 0-5 effectiveness/efficiency rating
retro_summary: null      # one-sentence summary of how it went
completed: null          # YYYY-MM-DD
---
```

## Categories

### plan
Comprehensive design documents for new features.

### followup
Post-merge improvements and tech debt.

### task-list
Collections of related items discovered during other work.

### ideas
Ideas to explore, not yet developed into actionable plans.

## Naming Convention

`{feature}-{category}.md`

## Lifecycle

1. **pending** - Created, waiting to be picked up
2. **in-progress** - Branch created, PR opened
3. **done** - Move file to `backlog/done/`
```
