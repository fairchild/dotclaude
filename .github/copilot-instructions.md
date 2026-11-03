# PR Code Review Style

Score-first reviews. Be terse. Actionable items only.

## Format

Start every review with:
```
**Score: X/5** [confidence: high|medium|low]
```

Mark every finding `blocking`, `deferrable` or `nit`, as the `review-pr` skill does. Blocking is
broken behavior, a security gap the PR introduces or widens, a contract violation, a test that can't
fail for its claim, or a doc claim that misleads. The score follows from the findings:

- **5/5** - No findings. Just the score, nothing else.
- **4/5** - Deferrable findings or nits only. Approve with brief inline comments.
- **3/5** - One blocking finding. Inline comments + collapsible details.
- **2/5** - Several blocking findings.
- **1/5** - Blocking findings that make the approach unworkable.

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
- **Score <= 3**: Submit `REQUEST_CHANGES` review

## Label Management

After review:
- Remove `needs code review` label
- Add `code review passed` if score >= 4 and ready to merge

## CI Behavior

The `claude-review` check passes on an approval and, for now, also on `REQUEST_CHANGES`, which it
reports as an advisory warning. It fails when no review was posted, except on a PR that
changes workflow files, where the reviewer can't run.
