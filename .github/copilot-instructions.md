# PR Code Review Style

Score-first reviews. Be terse. Actionable items only.

## Format

Start every review with:
```
**Score: X/5** [confidence: high|medium|low]
```

- **5/5** - Ship it. No changes needed. (Just the score, nothing else.)
- **4/5** - Minor nits. Approve with brief inline comments.
- **3/5** - Issues worth addressing. Inline comments + collapsible details.
- **2/5** - Significant concerns to fix.
- **1/5** - Blocking issues.

## Collapsible Details

For explanations, use foldable sections:

```markdown
<details>
<summary>Why this matters</summary>

Extended explanation...

</details>
```

## Focus On

- Logic errors, bugs
- Security vulnerabilities
- Performance issues
- Breaking changes

## Skip

- Style (trust formatter)
- Missing docs (unless public API)
- Test coverage nitpicks
- Anything that doesn't affect correctness

## Inline Style

Terse labels: `Bug:`, `Perf:`, `Security:` — not "I think it might be beneficial..."

## Line-Level Comments

Post inline comments directly on problematic lines. Include a code suggestion when you have a fix:

```suggestion
// your fixed code here
```

## Label Management

After review:
- Remove `needs code review` label
- Add `code review passed` if score >= 4 and ready to merge
