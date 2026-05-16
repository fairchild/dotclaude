---
description: Respond to review feedback on our PR and advance toward mergeable state
scripts:
  - scripts/pr-status.ts
---

Respond to code review comments on a pull request we own. This is distinct from `/review-pr`, which reviews someone else's PR.

## Usage

- `/respond-to-pr-review` - Respond to review comments on the current branch's PR
- `/respond-to-pr-review 123` - Respond to review comments on PR #123
- `/pr-review` - Compatibility alias for this workflow

## Workflow

### Phase 1: Read All Unresolved Review Comments

Run the PR status script:

```bash
bun ~/.claude/scripts/pr-status.ts [PR_NUMBER]
```

If no PR number is provided, auto-detect from the current branch.

This outputs:
- PR metadata: state, mergeability, review decision
- Unresolved review comments with file paths, line numbers, and **thread IDs**
- CI check status: pass, fail, pending
- Artifact saved to `.context/pr-status-{number}.md`

Before touching code, read every unresolved comment and the surrounding review thread context. Do not address comments one-by-one in isolation until the full set is understood.

### Phase 2: Reflect in Context

For each unresolved comment:

1. Read the relevant file and surrounding code.
2. Check related code paths, tests, docs, plans, or prior discussion when they affect the comment.
3. Gather more context before deciding if the comment's intent is unclear, the requested change has hidden product or architectural implications, or multiple comments interact.
4. Decide whether to **do**, **defer**, or **decline**.

Use these decision meanings:

| Decision | Meaning | Required response |
|----------|---------|-------------------|
| Do | The feedback is valid and should be implemented now | Make the change, verify it, and reply with what changed |
| Defer | The feedback is valid, but should not block this PR | Reply with rationale and the intended follow-up path |
| Decline | The feedback is not appropriate for this PR | Reply with evidence and reasoning |

### Phase 3: Present Brief Decision Summary

Before execution, present a compact summary:

```markdown
## Review Response Plan: PR #{number}

### Current State
- Review: {X unresolved comments}
- CI: {Y passing, Z failing, P pending}
- Conflicts: {yes/no}

### Decisions
| Comment | Context checked | Decision | Reason | Planned response |
|---------|-----------------|----------|--------|------------------|
| `path/file.ts:42` @reviewer | file + test + related helper | Do | bug is real | adjust helper and add regression test |
| `path/other.ts:9` @reviewer | API contract + docs | Defer | broader behavior change | reply with follow-up issue/plan |
| `path/ui.tsx:33` @reviewer | product copy + existing pattern | Decline | current behavior is intentional | reply with evidence |
```

Proceed after the summary unless the plan includes risky scope expansion, uncertain product judgment, destructive git operations, or the user has asked to approve each step first.

### Phase 4: Execute Decisions

For each item:

1. **Do**: Make the code change, add or update focused tests when risk justifies it, run verification, and reply to the review thread.
2. **Defer**: Reply in-thread with concise rationale and the follow-up path.
3. **Decline**: Reply in-thread with evidence and reasoning.
4. **CI failure**: Investigate logs, fix if caused by this PR, and verify.
5. **Merge conflicts**: Rebase or merge the base branch only when appropriate for the repo workflow.

**Replying to comments**:

```bash
gh api /repos/{owner}/{repo}/pulls/{PR_NUMBER}/comments \
  -X POST \
  -f body="{brief response}" \
  -F in_reply_to={COMMENT_ID}
```

After addressing all items:
- Commit changes with message: `fix: address PR review feedback`
- Push to trigger CI
- Re-run `bun ~/.claude/scripts/pr-status.ts` to verify state

### Phase 5: Final Check

Once all blockers are addressed:
- Confirm every unresolved comment has either been resolved or answered with do/defer/decline reasoning
- Confirm CI is passing, or clearly report remaining pending/failing checks
- Report ready-to-merge state to the user

### Phase 6: Optional Cleanup

After all comments have been addressed with in-thread replies, **ask the user** before bulk-resolving threads:

```text
All {N} review comments have been addressed with in-thread replies.

Would you like me to resolve all addressed comment threads and post a PR summary comment?
```

If the user confirms, resolve each addressed thread and post a short summary comment on the PR.

## Important

- Always read all unresolved comments before deciding what to change.
- Always reflect on each comment in available code, test, product, and discussion context.
- Gather more context before deciding when the comment's intent or impact is unclear.
- Use **do**, **defer**, or **decline** as explicit decisions.
- Reply in-thread so reviewers can see the decision and evidence.
- Do not auto-resolve threads without user confirmation.
