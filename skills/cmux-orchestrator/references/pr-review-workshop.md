# Respond to PR Review Workshop

A Worktree Workshop variant focused on responding to code review comments on our PR. Say **"set up a respond-to-pr-review workshop for PR #<number>"** and get:

- Worktree on the PR branch (created or reused, idempotent)
- Browser open to the PR's Files Changed tab
- Review comments pre-loaded as agent context
- Permissions pre-configured for autonomous verification
- Re-review capability built into the workflow exit

## Entry Points

```
"set up a respond-to-pr-review workshop for PR #185"
"respond-to-pr-review workshop for 185"
"respond to review on PR 185"
"set up a pr-review workshop for PR #185"
"pr-review workshop for 185"
```

The `pr-review workshop` phrasing is a compatibility alias. Use `respond-to-pr-review` for new documentation and requests. Use `/review-pr` when reviewing a PR someone else wrote.

## Phase 1: Read All Review Context

Before creating any workspace or touching code, fetch the PR metadata, review comments, and review discussion.

1. Get PR details:
   ```bash
   gh pr view <number> --json number,title,headRefName,baseRefName,url,reviewRequests,reviews,body
   ```

2. Get review comments (the actual feedback to address):
   ```bash
   gh api repos/{owner}/{repo}/pulls/<number>/comments --jq '.[] | {path, line, body, user: .user.login, id}'
   ```

3. Get review threads for conversation context:
   ```bash
   gh api repos/{owner}/{repo}/pulls/<number>/reviews --jq '.[] | select(.state != "APPROVED") | {user: .user.login, state, body}'
   ```

4. Save context to a temp file for the agent prompt:
   ```bash
   # Or use the helper script:
   uv run ~/.claude/skills/cmux-orchestrator/scripts/pr-fetch-context.py <number> > /tmp/pr-<number>-context.md
   ```

## Phase 2: Reflect and Decide

Read every unresolved comment before deciding what to change. Review comments can interact with each other, and a local-looking suggestion may have product, testing, or architectural context.

For each comment:

1. Read the relevant file and surrounding code.
2. Check related code paths, tests, docs, plans, or prior discussion when they affect the comment.
3. Gather more context before deciding if the comment's intent is unclear, the requested change has hidden implications, or multiple comments interact.
4. Decide whether to **do**, **defer**, or **decline**.

Use these decision meanings:

| Decision | Meaning | Required response |
|----------|---------|-------------------|
| Do | The feedback is valid and should be implemented now | Make the change, verify it, and reply with what changed |
| Defer | The feedback is valid, but should not block this PR | Reply with rationale and the intended follow-up path |
| Decline | The feedback is not appropriate for this PR | Reply with evidence and reasoning |

Present a brief decision summary before execution:

```markdown
## Review Response Plan: PR #<number>

| Comment | Context checked | Decision | Reason | Planned response |
|---------|-----------------|----------|--------|------------------|
| `path/file.ts:42` @reviewer | file + test + helper | Do | bug is real | adjust helper and add regression test |
| `path/other.ts:9` @reviewer | API contract + docs | Defer | broader behavior change | reply with follow-up path |
```

Proceed after the summary unless the plan includes risky scope expansion, uncertain product judgment, destructive git operations, or the user has asked to approve each step first.

## Phase 3: Create/Reuse Worktree (Idempotent)

Follow the standard Worktree Workshop worktree phase from `references/worktree-workshop.md` with these specifics:

1. Derive branch from PR: `headRefName` from Phase 1
2. Worktree path: `~/.worktrees/<repo>/<branch>/`
3. **Idempotent**: If worktree already exists:
   - Verify it's on the correct branch: `git -C <path> branch --show-current`
   - Pull latest: `git -C <path> pull --rebase origin <branch>`
   - Reuse it (don't error, don't ask)
4. If worktree doesn't exist, create it:
   ```bash
   git worktree add ~/.worktrees/<repo>/<branch> <branch>
   ```

## Phase 4: Launch Workshop Layout

Create the cmux workspace with a respond-to-pr-review-specific layout:

```
+---------------------+---------------------+
|                     |                      |
|  Agent / Review     |  Browser             |
|  (main terminal)    |  (PR Files Changed)  |
|                     |                      |
+---------------------+---------------------+
|  Verification (full width, compact)        |
+--------------------------------------------+

Sidebar:
  Title: "PR #<number>: <title>"
  Status: review: addressing feedback, branch: <branch>
  Progress: 0/<N> comments addressed
```

Build steps:

1. Create workspace:
   ```bash
   cmux new-workspace --cwd <worktree-path>
   ```

2. Split top pane right for browser:
   ```bash
   cmux new-pane --type browser --direction right --workspace <ws> --url "https://github.com/<owner>/<repo>/pull/<number>/files"
   ```

3. Split down for compact verification pane:
   ```bash
   cmux new-split down --workspace <ws>
   cmux resize-pane --pane <bottom> --workspace <ws> -U --amount 15
   ```

4. Set sidebar:
   ```bash
   cmux rename-workspace "PR #<number>: <short-title>" --workspace <ws>
   cmux set-status "review" "addressing feedback" --icon "magnifyingglass" --color "#FFB800" --workspace <ws>
   cmux set-status "branch" "<branch>" --icon "arrow.triangle.branch" --color "#888888" --workspace <ws>
   cmux set-progress 0.0 --label "0/<N> comments addressed" --workspace <ws>
   ```

## Phase 5: Launch Agent with Permissions

The critical difference from a standard workshop: the agent launches with pre-approved permissions for autonomous verification work.

### Permission Profile

Use `--allowedTools` with this set when launching the agent in `-p` (print) mode, or rely on the user's global `~/.claude/settings.json` for interactive mode.

For autonomous agents (`-p` mode), the `--allowedTools` set:

```
Bash(gh pr *) Bash(gh api *) Bash(gh run *)
Bash(git diff *) Bash(git log *) Bash(git show *) Bash(git status *) Bash(git add *) Bash(git commit *) Bash(git fetch *) Bash(git pull *) Bash(git stash *) Bash(git checkout *)
Bash(swift build *) Bash(swift test *) Bash(swift run *)
Bash(uv run *) Bash(uv sync *) Bash(python *) Bash(python3 *)
Bash(grep *) Bash(find *) Bash(ls *) Bash(cat *) Bash(head *) Bash(tail *) Bash(wc *) Bash(tree *) Bash(mkdir *) Bash(echo *) Bash(pwd)
Bash(cmux *)
```

**Key additions vs standard workshop:**
- `gh api *` — needed for posting review responses and requesting re-review
- `gh run *` — needed to check/trigger CI
- `swift build *` / `swift test *` — project-specific verification
- `uv run *` / `python *` — inline verification scripts (import hygiene, symbol checks)

**What stays in `ask`** (even for autonomous agents):
- `git push *` — pushing changes should still require confirmation
- `git reset *` / `git rebase *` — destructive operations

### Launch the agent

**Interactive mode** (recommended — human can intervene):
```bash
cmux send --surface <agent-surface> 'claude --add-dir <worktree-path> "$(cat /tmp/pr-<number>-context.md)"'
cmux send-key --surface <agent-surface> Enter
```

**Autonomous mode** (fire-and-forget):
```bash
cmux send --surface <agent-surface> 'claude --dangerously-skip-permissions "$(cat /tmp/pr-<number>-context.md)"'
cmux send-key --surface <agent-surface> Enter
```

Interactive mode gives the agent full tool access to read files, run commands, and iterate autonomously.

## Phase 6: Agent Re-Review Flow

After the agent has addressed all review comments, it closes the loop:

### 5a. Commit and push changes
```bash
git add <changed-files>
git commit -m "fix: address PR review feedback

- <summary of each concern addressed>"
git push origin <branch>
```

### 5b. Post a summary comment on the PR
```bash
gh pr comment <number> --body "$(cat <<'EOF'
## Review Feedback Addressed

| # | Concern | Status | Evidence |
|---|---------|--------|----------|
| 1 | <reviewer concern> | Addressed | <link or description> |
| 2 | <reviewer concern> | Addressed | <link or description> |

All <N> review comments have been addressed. Requesting re-review.
EOF
)"
```

### 5c. Request re-review
```bash
# Request re-review from all original reviewers (excludes bots)
uv run ~/.claude/skills/cmux-orchestrator/scripts/pr-fetch-context.py <number> --request-rereview
```

This discovers reviewers from comments and reviews, filters out bots, and calls the GitHub API to request re-review from each human reviewer.

### 5d. Update sidebar
```bash
cmux set-progress 1.0 --label "All comments addressed"
cmux set-status "review" "re-review requested" --icon "checkmark.circle" --color "#00FF00"
cmux log "Re-review requested from <reviewer>" --source "respond-to-pr-review"
cmux notify --title "PR #<number> Ready" --body "All review comments addressed, re-review requested"
```

## Cleanup

When the PR is approved and merged:
```bash
git worktree remove ~/.worktrees/<repo>/<branch>
git branch -d <branch>
```

Or archive for reference:
```bash
wt archive <branch>
```
