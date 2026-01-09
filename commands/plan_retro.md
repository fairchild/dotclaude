---
description: Append a retrospective section to the current plan file
---

# Plan Retrospective

Append a retrospective section to the current plan file. The retrospective should reflect on how the planning and execution of this task went, with insights for future efficiency.

> **Usage**: Invoke with `/plan_retro` in Claude Code. Commands in `.claude/commands/` are auto-discovered.

## Structure

Add an --- horizontal rule, then a `## Retrospective` section with:

### What Happened
A numbered list of the key steps in this session, from initial request through final implementation. Be factual and concise.

### Observations
2-3 observations about what went well or could have been tighter. Use bold for the key insight in each observation. Focus on:
- Scope accuracy (did we build what was needed, or over/under-deliver?)
- Exploration efficiency (did we ask the right questions before diving in?)
- Implementation proportionality (was the effort matched to the task size?)

### Recommendations for Future Sessions
3-5 actionable recommendations that would make similar future sessions more efficient. Each should be:
- Specific and actionable (not generic advice)
- Grounded in what actually happened this session
- Phrased as a directive ("Ask before exploring" not "It might help to ask")

## Tone
Be direct and self-critical. The goal is genuine learning, not justification. If over-engineering happened, name it. If clarifying questions were skipped, note that.

## Example Output

See `.claude/plans/cheeky-stirring-creek.md` for a complete example of this format in practice.
