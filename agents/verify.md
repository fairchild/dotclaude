---
name: verify
description: Verify deployment health for production or staging
---

# Verify Subagent

Verify the previously completed task is deployed and working in production or staging before starting new work. This is the **first step** in every new work session.

**Output**: Verification report (pass/fail + details)

## Position in Loop

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  START HERE → verify → next-task-plan → prime → ...                                │
│                       ↓                                                             │
│               Check deployment                                                      │
│               Run smoke tests                                                       │
│               Verify feature works                                                  │
│                       ↓                                                             │
│               ✅ Healthy → Continue to next task                                    │
│               ❌ Unhealthy → Fix before proceeding                                  │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Why This Matters

- **Confidence**: Know previous work is actually working, not just merged
- **Catch regressions**: Detect if something broke after deploy
- **Clean slate**: Start new work with a healthy baseline
- **Accountability**: Verify before moving on

## Input

**Environment**: `production` (default) or `staging`
**Previous Issue ID**: `{issue-id}` - Specific task to verify (auto-detected if not provided)

## Execution Steps

### Phase 1: Identify Previous Work

```bash
# Find most recently closed issue
bd list --status closed --json | jq -r '.[0]'

# Or check git log for recent merges
git log main --oneline -10 --merges

# Get details of the previous task
bd show {previous-issue-id} --json
```

If no previous issue found, check:
- Recent merged PRs: `gh pr list --state merged --limit 5`
- Recent deployments: Check GitHub Actions deploy workflow

### Phase 2: Check Deployment Status

```bash
# Map ENVIRONMENT to deployment URL
if [ "${ENVIRONMENT}" = "staging" ]; then
  ENV_URL="https://staging.planventura.org"
elif [ -z "${ENVIRONMENT}" ] || [ "${ENVIRONMENT}" = "production" ]; then
  ENV_URL="https://planventura.org"
else
  ENV_URL="${ENVIRONMENT}" # Treat custom ENVIRONMENT as direct URL
fi

# Check if deployment workflow succeeded
gh run list --workflow=deploy.yml --limit=1 --json status,conclusion

# Check deployment health endpoint (if available)
curl -s ${ENV_URL}/health || echo "No health endpoint"

# Run deployment health check script
bun scripts/check-deployment-health.js
```

**Expected Outputs**:
- Deployment workflow: `conclusion: success`
- Health endpoint: 200 OK
- No errors in deployment logs

### Phase 3: Service Health Checks

```bash
# Basic connectivity
curl -s -o /dev/null -w "%{http_code}" ${ENV_URL}

# Check key routes respond
curl -s -o /dev/null -w "%{http_code}" ${ENV_URL}/clerk
curl -s -o /dev/null -w "%{http_code}" ${ENV_URL}/planning
curl -s -o /dev/null -w "%{http_code}" ${ENV_URL}/map

# Check API endpoints
curl -s ${ENV_URL}/api/health 2>/dev/null || echo "No API health"
```

### Phase 4: Feature-Specific Verification

Based on the previous task type, run appropriate verification:

#### For Bug Fixes
- Reproduce the original bug scenario
- Confirm it no longer occurs
- Check related functionality still works

#### For New Features
- Navigate to the feature
- Test the happy path
- Test one edge case

#### For UI Changes
- Visual inspection via browser
- Check responsive behavior
- Verify accessibility basics

#### For API Changes
- Call the affected endpoints
- Verify response format
- Check error handling

### Phase 5: Run Smoke Tests

```bash
# Run smoke test suite (subset of E2E)
bun run test:e2e -- --grep "@smoke"

# Or run specific feature tests
bun run test:e2e -- tests/e2e/smoke.spec.ts

# If no smoke tests exist, run critical path E2E
bun run test:e2e -- --grep "critical|smoke|sanity"
```

### Phase 6: Browser Verification (if applicable)

For UI features, use browser tools:

```bash
# Navigate to environment (Claude Code/Claude Desktop)
claude-desktop browser navigate ${ENV_URL}

# Take snapshot
claude-desktop browser snapshot

# Verify key elements present
# Check for errors in console
claude-desktop browser console-messages
```

### Phase 7: Generate Verification Report

```markdown
## Verification Report: {issue-id}

### Environment
- **Target**: {production | staging}
- **URL**: {url}

### Task Details
- **ID**: `{issue-id}`
- **Title**: {title}
- **Type**: {bug|feature|task}
- **Merged**: {date}
- **PR**: #{pr-number}

### Deployment Status
- [ ] Deploy workflow: ✅ Success / ❌ Failed
- [ ] Health endpoint: ✅ 200 OK / ❌ Error
- [ ] Service responding: ✅ Yes / ❌ No

### Feature Verification
- [ ] Feature accessible: ✅ Yes / ❌ No
- [ ] Happy path works: ✅ Yes / ❌ No
- [ ] No console errors: ✅ Yes / ❌ No

### Test Results
- [ ] Smoke tests: ✅ Pass / ❌ Fail / ⚠️ Skipped
- [ ] E2E tests: ✅ Pass / ❌ Fail / ⚠️ Skipped

### Verification Result
**Status**: ✅ VERIFIED / ❌ NEEDS ATTENTION / ⚠️ PARTIAL

{Summary of verification}
```

### Phase 8: Action Based on Result

#### If ✅ VERIFIED

```markdown
Previous task verified successfully!

Ready to continue with next task:
next-task-plan
```

#### If ❌ NEEDS ATTENTION

```markdown
⚠️ Previous task verification failed!

Issues found:
1. {issue 1}
2. {issue 2}

**Do NOT start new work until resolved.**

Options:
1. Create hotfix issue:
   bd create "Hotfix: {problem}" -t bug -p 0 --description="..."

2. Rollback if critical:
   # Revert the merge commit
   git revert {merge-sha}

3. Investigate further:
   # Check deployment logs
   gh run view {run-id} --log
```

#### If ⚠️ PARTIAL

```markdown
Previous task partially verified.

Working:
- {what works}

Unable to verify:
- {what couldn't be tested}

Recommendation: Proceed with caution, monitor after next deploy.

Continue with:
next-task-plan
```

## Verification Strategies by Task Type

### Bug Fix Verification

1. **Find the original bug report** in the issue description
2. **Reproduce the scenario** that caused the bug
3. **Confirm the fix** - bug should not occur
4. **Check regression** - related features still work

### Feature Verification

1. **Read the feature spec** from issue/PR
2. **Test the primary use case** end-to-end
3. **Test one error case** (invalid input, etc.)
4. **Verify UI/UX** matches expectations

### Refactoring Verification

1. **Run full test suite** - all should pass
2. **Compare behavior** - before/after should be identical
3. **Check performance** - no degradation
4. **Verify no new errors** in logs

### Infrastructure Verification

1. **Check all environments** respond
2. **Verify configuration** is correct
3. **Test failover** if applicable
4. **Check monitoring/alerts** are working

## Quick Verification Checklist

For fast verification when confident:

```bash
# Ensure ENV_URL is set from ENVIRONMENT (production default)
if [ -z "${ENV_URL:-}" ]; then
  if [ "${ENVIRONMENT}" = "staging" ]; then
    ENV_URL="https://staging.planventura.org"
  elif [ -z "${ENVIRONMENT}" ] || [ "${ENVIRONMENT}" = "production" ]; then
    ENV_URL="https://planventura.org"
  else
    ENV_URL="${ENVIRONMENT}"
  fi
fi

# 1. Deployment succeeded?
gh run list --workflow=deploy.yml --limit=1

# 2. Site responding?
curl -s -o /dev/null -w "%{http_code}\n" ${ENV_URL}

# 3. Smoke tests pass?
bun run test:e2e -- --grep "@smoke" 2>/dev/null || echo "No smoke tests"

# 4. No errors in logs?
gh run view --log 2>/dev/null | grep -i error | head -5
```

## Creating Verifiable Work

When planning tasks, ensure they can be verified:

### Good (Verifiable)

- "Add loading spinner to search" → Can see spinner during search
- "Fix 500 error on empty query" → Can test empty query works
- "Add aria-labels to buttons" → Can inspect with dev tools

### Poor (Hard to Verify)

- "Improve code quality" → No observable behavior change
- "Refactor internals" → Need deep testing

### Making Work Verifiable

When creating issues, include:

```markdown
## Verification Steps

1. Go to {URL}
2. Do {action}
3. Expect {result}

## Smoke Test

Add to tests/e2e/smoke.spec.ts:
- [ ] Test case for this feature
```

## Example Session

```
verify production

Identifying previous task...
Found: plan-7re "Fix duplicate assistant messages"
Merged: 2025-12-06 via PR #42

Checking deployment...
✅ Deploy workflow succeeded (run #123)
✅ Health endpoint: 200 OK
✅ All routes responding

Verifying feature...
- Opening https://planventura.org/planning
- Sending test query...
- Checking message count...
✅ Only 1 assistant message rendered (was 2 before)

Running smoke tests...
✅ 5/5 smoke tests passed

═══════════════════════════════════════════════════════════════
✅ Previous task VERIFIED

plan-7re: Fix duplicate assistant messages
- Deployed successfully
- Feature working correctly
- All tests passing

Ready to continue:
next-task-plan
═══════════════════════════════════════════════════════════════
```

## Integration with Loop

This subagent should be called:

1. **At start of every session** - Verify last work before new work
2. **After merge** - Before GitHub Action continues loop
3. **After hotfix** - Confirm fix is deployed

The full loop becomes:

```
verify → next-task-plan → prime → 
implement → review → pr-respond → 
merge → (GitHub Action) → verify → ...
```

## Environment Support

This subagent supports both production and staging:

- **Production** (default): `verify` or `verify production`
- **Staging**: `verify staging`

The environment determines which URL to check and which deployment workflow to verify.

