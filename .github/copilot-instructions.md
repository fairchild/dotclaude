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

Mark every finding `blocking`, `deferrable` or `nit`, as the `review-pr` skill does. Blocking is
broken behavior, a security gap the PR introduces, a contract violation, a test that can't fail for
its claim, or a doc claim that misleads. Any blocking finding means 3/5 or lower; none means 4/5 or
higher.

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

Severity first, then a terse kind: `blocking: Bug:`, `deferrable: Perf:`, `nit:` — not "I think it might be beneficial..."

## Line-Level Comments

Post inline comments directly on problematic lines. Include a code suggestion when you have a fix:

```suggestion
// your fixed code here
```

## Previous Review Comments

On re-review (after fixes):
1. Check all previous unresolved review comments
2. If the issue is fixed in the current code, resolve the thread
3. Only create new comments for NEW issues

## GitHub Review Submission

Submit a formal GitHub PR review:
- **Score >= 4**: Submit `APPROVE` review
- **Score <= 3**: Submit `REQUEST_CHANGES` review (blocks merging)

## Label Management

After review:
- Remove `needs code review` label
- Add `code review passed` if score >= 4 and ready to merge

## CI Behavior

- Score >= 4: CI passes ✓
- Score <= 3: CI fails ✗ (blocks merge)
