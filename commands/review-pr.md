---
description: Review a pull request someone else wrote
---

Review a pull request authored by someone else. This is distinct from `/respond-to-pr-review`, which handles comments on our PR.

## Usage

- `/review-pr 123` - Review PR #123
- `/review-pr 123 "focus on auth and migration risk"` - Review with specific instructions

## Workflow

### Phase 1: Gather PR Context

Fetch PR metadata, branch information, diff, existing discussion, CI status, and project review standards.

```bash
gh pr view {PR_NUMBER} --json number,title,author,headRefName,baseRefName,url,body,reviewDecision,mergeable,changedFiles,additions,deletions
gh pr diff {PR_NUMBER}
gh pr checks {PR_NUMBER}
```

Also read repository guidance when present:
- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`
- Relevant docs or plans referenced by the PR body

### Phase 2: Review in Context

Read the changed files and surrounding code before drawing conclusions. Gather more context when the diff alone does not establish whether behavior is correct.

Prioritize:
- Correctness bugs
- Behavioral regressions
- Security, privacy, or data-loss risk
- Broken project conventions or explicit instructions
- Missing tests where the changed behavior is risky

Do not flag speculative style preferences as findings. If the concern depends on an assumption, verify the assumption or present it as a question.

### Phase 3: Present Findings

Lead with findings, ordered by severity. Use file and line references wherever possible.

```markdown
## Review Findings

**Critical**
- `path/file.ts:42` - {bug/risk}. {why it matters}. {suggested fix}

**Important**
- `path/other.ts:9` - {bug/risk}. {why it matters}. {suggested fix}

**Questions**
- {question that blocks confidence, if any}

Verdict: {approve / request changes / comment only}
```

If there are no high-confidence issues, say that clearly and mention any residual test gaps or unchecked areas.

### Phase 4: Optional GitHub Review

Only post the review when the user asks to publish it.

Use:

```bash
gh pr review {PR_NUMBER} --comment --body "{review body}"
gh pr review {PR_NUMBER} --request-changes --body "{review body}"
gh pr review {PR_NUMBER} --approve --body "{review body}"
```

## Important

- This command reviews someone else's work.
- Do not make code changes unless explicitly asked.
- Keep findings high signal and evidence-backed.
- Do not use this command to respond to review feedback on our own PR; use `/respond-to-pr-review` for that.
