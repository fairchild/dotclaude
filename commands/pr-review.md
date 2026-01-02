---
description: Address PR review feedback and advance toward mergeable state
---

Get a pull request into mergeable state by addressing code review comments and ensuring CI passes.

## Usage

- `/pr-review` - Review current branch's PR
- `/pr-review 123` - Review specific PR #123

## Workflow

### Phase 1: Gather PR Status

Run the pr-status script:

```bash
bun scripts/pr-status.ts [PR_NUMBER]
```

If no PR number provided, auto-detects from current branch.

This outputs:
- PR metadata (state, mergeable, review decision)
- Unresolved review comments with file paths, line numbers, and **thread IDs**
- CI check status (pass/fail/pending)
- Artifact saved to `.context/pr-status-{number}.md`

### Phase 2: Analyze Merge Blockers

A PR is **mergeable** when:
1. All review comments are either **resolved** or **responded to** with reason to defer
2. All CI checks have **passed**

Categorize blockers:

| Blocker Type | Action Required |
|--------------|-----------------|
| Unresolved comment - code change needed | Fix the code, mark resolved |
| Unresolved comment - clarification needed | Reply explaining approach |
| Unresolved comment - defer/won't fix | Reply with reasoning, request resolution |
| CI failure | Investigate and fix |
| CI pending | Wait or investigate if stuck |
| Merge conflicts | Rebase or merge base branch |

### Phase 3: Present Plan

**If already mergeable:**
```
PR #{number} is ready to merge!

- All review comments resolved
- All CI checks passing
- No merge conflicts

Would you like me to merge this PR?
```

**If blockers exist:**
```
## PR Review Plan: #{number}

### Current State
- Review: {X unresolved comments}
- CI: {Y passing, Z failing}
- Conflicts: {yes/no}

### Plan to Merge

1. **Address comment at `path/file.ts:42`** (@reviewer)
   > {comment summary}

   Approach: {describe fix or response}

2. **Fix CI failure: {check name}**
   Approach: {investigate / known fix}

3. ...

Would you like me to proceed with this plan, or would you like to modify it?
```

### Phase 4: Execute (After User Confirmation)

For each item in the approved plan:

1. **Code changes**: Read the file, make the fix, reply to comment thread, **mark resolved**
2. **Clarification responses**: Reply to comment thread with explanation, **mark resolved**
3. **Defer responses**: Reply with reasoning (do NOT mark resolved - reviewer decides)
4. **CI fixes**: Investigate failure logs, fix code, push

**Marking comments as resolved** (after addressing):

```bash
# Get the thread ID from the review thread
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread { isResolved }
    }
  }
' -f threadId="{THREAD_NODE_ID}"
```

After addressing all items:
- Commit changes with message: `fix: address PR review feedback`
- Push to trigger CI
- Re-run `bun scripts/pr-status.ts` to verify state

### Phase 5: Final Check

Once all blockers addressed:
- Confirm all comments resolved or responded to
- Confirm CI passing
- Report ready-to-merge state to user

## Important

- Always read the full context of a review comment before addressing
- When replying to comments, use the in-thread reply pattern from CLAUDE.md
- **Mark comments as resolved** after addressing them (code fix or clarification)
- Only leave unresolved when deferring - let reviewer decide if acceptable
- If unsure about a comment's intent, ask the user for clarification
