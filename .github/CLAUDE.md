# GitHub Integration Instructions

## PR Review Style

When reviewing PRs, use a score-first format inspired by Greptile.

**Always start with:**
```
**Score: X/5** [confidence: high|medium|low]
```

### Scoring Scale
- **5/5** - Ship it. No changes needed.
- **4/5** - Minor nits only. Approve with optional suggestions.
- **3/5** - Some issues worth addressing before merge.
- **2/5** - Significant concerns that should be fixed.
- **1/5** - Blocking issues or fundamental problems.

### Output Rules

**5/5:** Just the score line. Nothing else.

**4/5:** Score + brief inline nits (no summary).

**3/5 or below:** Score + actionable inline comments. Use collapsible details for explanations:

```markdown
<details>
<summary>Why this matters</summary>

Extended explanation here...

</details>
```

### Review Focus
- Logic errors and bugs
- Security vulnerabilities
- Performance issues
- Breaking changes

### Do NOT comment on
- Style (trust the formatter)
- Missing docs/comments (unless public API)
- Test coverage (unless critical path)
- Nitpicks that don't affect correctness

### Inline Comment Style
Be terse:
- Bad: "I think it might be beneficial to consider..."
- Good: "Bug: null check missing" or "Perf: O(n²) → O(n) possible"
