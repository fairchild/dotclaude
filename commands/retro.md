---
description: Review session trajectory and update todo file with lessons learned
---

# Session Retrospective

Review the current session's trajectory, update the todo file with lessons learned, and improve our process.

> **Usage**: Invoke with `/retro` at session completion (or mid-session if abandoning).

## When to Use

- **Successful completion**: PR merged or ready, work done
- **Abandoning**: Session went off track, starting over

## What This Command Does

1. **Review the session**: Look at the goal, the path taken, the outcome
2. **Score effectiveness**: Rate 0-5 how efficiently we reached the goal
3. **Extract insights**: What could have been done better?
4. **Update the todo file**: Append retrospective, update frontmatter
5. **Consider process improvements**: Should any commands/skills/instructions be updated?
6. **Move to done/** (if complete): Update status and move file

## Retrospective Section Format

Append to the todo file:

```markdown
---

## Retrospective

**Session**: {branch name or session identifier}
**Date**: YYYY-MM-DD
**Score**: N/5
**Outcome**: {completed | abandoned | partial}

### What Happened
Numbered list of key steps from initial request through final outcome.

### Efficiency Analysis
- Goal vs actual path comparison
- Where did we spend time unnecessarily?
- What clarifications could have been asked earlier?

### Insights
2-3 observations with bold key insight. Consider:
- Scope accuracy (built what was needed?)
- Exploration efficiency (asked right questions?)
- Implementation proportionality (effort matched task?)

### Process Improvements
If any of these should be updated based on this session, list specific changes:
- `todos/AGENTS.md` (todo creation guidance)
- `.claude/commands/*.md` (slash commands)
- `.claude/skills/*.skill` (skills)
- `AGENTS.md` or `CLAUDE.md` (project instructions)
```

## Frontmatter Updates

Update the todo file's frontmatter:
- `status: done` (or keep `in-progress` if partial)
- `score: N` (0-5 effectiveness rating)
- `retro_summary: "One sentence summary"`
- `completed: YYYY-MM-DD` (if done)
- `pr: N` (if PR was created)
- `branch: branch-name`

## Session Identifiers

Include these in the retrospective for potential session resumption:
- **Branch**: `git branch --show-current`
- **PR number**: if created
- **Plan file path**: if used (e.g., `~/.claude/plans/rosy-leaping-lerdorf.md`)
- **Session ID**: Find the current session's JSONL file:
  ```bash
  # Project path is encoded (/ becomes -)
  ls -lt ~/.claude/projects/-Users-fairchild-conductor-workspaces-bread-builder-kabul/*.jsonl | head -1
  ```
  Resume with: `claude --resume <session-id>`

## Tone

Be direct and self-critical. The goal is genuine learning, not justification.
If over-engineering happened, name it. If we went down a rabbit hole, document it.
