# PR Review Instructions

Review this pull request and provide a score-first assessment.

## Response Format

**Always start your review with:**

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

**If score is 5/5:**
- Just the score line. Nothing else needed.

**If score is 4/5:**
- Score line + brief inline comments on the nits (no summary needed)

**If score is 3/5 or below:**
- Score line
- Actionable items as inline review comments
- Use collapsible details for explanations:

```markdown
<details>
<summary>Why this matters</summary>

Extended explanation here...

</details>
```

## Review Focus

Check for:
- Logic errors and bugs
- Security vulnerabilities
- Performance issues
- Breaking changes

**Do NOT comment on:**
- Style preferences (trust the formatter)
- Missing docs/comments (unless public API)
- Test coverage (unless obviously missing for critical paths)
- Nitpicks that don't affect correctness

## Inline Comments

Use GitHub's review comment format. Be terse:
- Bad: "I think it might be beneficial to consider..."
- Good: "Bug: null check missing" or "Perf: O(n²) → O(n) possible"

If you need to explain, fold it:

```markdown
Bug: race condition possible

<details>
<summary>Details</summary>

The `fetch` and `setState` can interleave if...

</details>
```
