---
description: Review recent work against plan and project standards
---

Review your work before creating a PR. 
Gathers context automatically and dispatches the code-reviewer subagent.

## Usage

- `/code-review` - Auto-detect context, review changes on current branch
- `/code-review "Added auth system"` - With explicit description

## Workflow

### Phase 1: Gather Context

Run these commands to collect review context:

```bash
# Get git range
BASE_SHA=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)
HEAD_SHA=$(git rev-parse HEAD)
BRANCH=$(git branch --show-current)

# Show what will be reviewed
echo "Branch: $BRANCH"
echo "Base: $BASE_SHA"
echo "Head: $HEAD_SHA"
git log --oneline $BASE_SHA..HEAD
```

**Find plan file** (check in order, use first found):
1. `.context/plan.md` or `.context/*-plan.md`
2. `docs/plans/*.md` (most recently modified)
3. Active todo list from session

**Find project standards** (if exists):
- `.github/copilot-instructions.md`
- `CLAUDE.md` project-specific sections

### Phase 2: Build Review Request

Construct the context for the reviewer:

```markdown
## Description
{User-provided description OR summarize from git log}

## Git Range
- Base: {BASE_SHA}
- Head: {HEAD_SHA}
- Branch: {BRANCH}
- Commits: {N commits}

## Requirements/Plan
{Content from plan file, or "No plan file found - reviewing against general best practices"}

## Project Standards
{Content from copilot-instructions.md, or "No project-specific standards found"}

## Files Changed
{Output of: git diff --stat BASE_SHA..HEAD}
```

### Phase 3: Dispatch Reviewer

Launch the code-reviewer subagent:

```
Task(superpowers:code-reviewer):

Review the following changes:

{Built review request from Phase 2}

Focus on:
1. Plan alignment (if plan provided)
2. Code quality and patterns
3. Test coverage
4. Project standards compliance (if standards provided)
5. Production readiness

Categorize issues as:
- **Critical**: Must fix before merge
- **Important**: Should fix before merge
- **Minor**: Nice to have, can defer

End with a clear verdict: Ready to merge? Yes / No / With fixes
```

### Phase 4: Present Results

After subagent returns, present findings:

```
## Code Review Results

### Verdict: {Ready / Not Ready / Ready with fixes}

### Strengths
- {What was done well}

### Issues Found

**Critical** (must fix):
- {issue + file:line + recommendation}

**Important** (should fix):
- {issue + file:line + recommendation}

**Minor** (can defer):
- {issue + file:line + recommendation}

### Recommended Actions
1. {Specific fix for critical issue}
2. {Specific fix for important issue}
...

Would you like me to address these issues?
```

### Phase 5: Fix Issues (If Requested)

For each issue the user wants fixed:
1. Make the code change
2. Run relevant tests
3. Commit with descriptive message

After fixes, offer to re-run review to verify.

## Context Detection Details

### Plan File Detection

```bash
# Check .context first
PLAN=$(ls -t .context/*plan*.md 2>/dev/null | head -1)

# Fall back to docs/plans
if [ -z "$PLAN" ]; then
  PLAN=$(ls -t docs/plans/*.md 2>/dev/null | head -1)
fi

# Report
if [ -n "$PLAN" ]; then
  echo "Found plan: $PLAN"
else
  echo "No plan file found"
fi
```

### Standards Detection

```bash
# Check for project review standards
if [ -f ".github/copilot-instructions.md" ]; then
  echo "Found: .github/copilot-instructions.md"
fi
```
