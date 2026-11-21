---
name: fork
description: Fork the current session with context carried over. Use `/fork <branch>` for a new worktree or `/fork --local` for a new session in the current directory.
license: Apache-2.0
disable-model-invocation: true
---

# Fork Session

Fork the current session, carrying context for continuity.

## Usage

```
/fork <branch>                     # Default: open new terminal tab with interactive claude
/fork <branch> --base <ref>        # Fork from a specific base branch/ref
/fork <branch> --move              # Move this session into the worktree
/fork <branch> --team              # Spawn a coordinated teammate in the worktree
/fork <branch> --background        # Spawn autonomous fire-and-forget agent
/fork --local                      # Write handoff for manual pickup
/fork <branch> --dry-run              # Preview what would happen without creating anything
```

## Modes

| Mode | Interactive? | Coordinated? | User stays here? | Best for |
|------|-------------|-------------|-------------------|----------|
| Terminal (default) | Yes | No | Yes | Exploratory/uncertain work |
| Move | Yes | N/A | No | Fully switching focus |
| Team | No | Yes | Yes | Delegated work with oversight |
| Background | No | No | Yes | Well-defined autonomous tasks |
| Local | Manual | N/A | Yes | When other modes aren't available |

## Instructions

### Step 1: Determine Mode and Options

Check the user's input:

| Input | Mode |
|-------|------|
| `/fork <branch>` | Terminal (default) |
| `/fork <branch> --move` | Move |
| `/fork <branch> --team` | Team |
| `/fork <branch> --background` | Background |
| `/fork --local` | Local |
| `/fork` (no args) | Ask: "Branch name for new worktree, or `--local` for same directory?" |

**Options** (combine with any worktree mode):
- `--base <ref>` — Create the worktree from a specific branch, tag, or commit instead of origin's default branch.
- `--dry-run` — Preview what would happen (worktree path, mode, base branch, handoff size) without creating anything. Compatible with all modes.

### Step 1.5: Pre-flight Checks (all worktree modes)

Skip this step for `--local` mode.

Before generating the handoff, verify prerequisites:

1. **Git repo check:**
   ```bash
   git rev-parse --git-dir 2>/dev/null
   ```
   If this fails → tell user "Not in a git repository. Use `/fork --local` for non-git contexts."

2. **Branch collision:**
   ```bash
   REPO_NAME=$(basename "$(git remote get-url origin 2>/dev/null || basename "$(git rev-parse --show-toplevel)")" .git)
   test -d "$HOME/.worktrees/$REPO_NAME/<branch>"
   ```
   If exists → ask: "Worktree `<branch>` already exists at `~/.worktrees/<repo>/<branch>`. Resume there, or pick a different name?"

3. **claude CLI** (for terminal and background modes only):
   ```bash
   command -v claude
   ```
   If missing → fall back to `--local` mode and explain why.

If all checks pass, proceed silently. Only report failures.

### Step 1.7: Dry Run (if `--dry-run`)

If `--dry-run` was specified, report what would happen and stop:

Run the same pre-flight checks from Step 1.5, plus gather additional info, then report:

```bash
# Determine values for the report
REPO_NAME=$(basename "$(git remote get-url origin 2>/dev/null || basename "$(git rev-parse --show-toplevel)")" .git)
WORKTREE_PATH="$HOME/.worktrees/$REPO_NAME/<branch>"

# Branch existence
if [ -d "$WORKTREE_PATH" ]; then
  BRANCH_STATUS="yes — would reuse existing worktree"
else
  BRANCH_STATUS="no — would create new branch from $BASE"
fi

# Uncommitted changes
DIRTY_COUNT=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

# claude CLI
CLAUDE_AVAILABLE=$(command -v claude >/dev/null 2>&1 && echo "available" || echo "NOT available — would fall back to --local")
```

Print the report:

```
Dry run for `/fork <branch>`:
  Mode: {terminal|move|team|background}
  Worktree: {WORKTREE_PATH}
  Base: {base_branch}
  Branch exists: {BRANCH_STATUS}
  Uncommitted changes: {DIRTY_COUNT} files would be carried as patch
  claude CLI: {CLAUDE_AVAILABLE}
  All pre-flight checks passed ✓
```

Do not create the worktree, handoff, or spawn any agents. Return after printing the report.

### Step 2: Generate Context Summary

Create a handoff document summarizing:

1. **Current Task** - what we're working on
2. **Progress** - what's been done so far
3. **Git State** - current branch, dirty files, recent commits
4. **Key Decisions** - important choices made
5. **Next Steps** - what the new session should tackle
6. **Relevant Files** - files we've been working with
7. **Open Questions** - unresolved issues
8. **When Done** - how to merge back and clean up

Use this template:

```markdown
# Session Handoff

## Current Task
{Brief description of what we're working on}

## Progress
- {What's been completed}
- {What's in progress}

## Git State
- Source branch: `{current branch}`
- Base for fork: `{base_branch or "main"}`
- Dirty files: {list of modified/untracked files, or "clean"}
- Recent commits (last 3):
  - `{short hash}` {message}
  - `{short hash}` {message}
  - `{short hash}` {message}

## Key Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| {topic} | {choice} | {rationale} |

## Next Steps
1. {Immediate next action}
2. {Following action}

## Relevant Files
- `path/to/file.ts` - {why it matters}

## Open Questions
- {Unresolved question or blocker}

## When Done
1. Commit your work with conventional commits
2. Push the branch and open a pull request
3. Once it merges, `wt clean` (the `git-worktree` skill) retires this worktree

---
*Forked from `{repo}@{branch}` on {date}*
*Parent directory: `{original_path}`*
```

### Step 3: Capture Uncommitted Changes (all worktree modes)

Before creating the worktree, check for uncommitted changes and save them as a patch. The worktree is created from a clean base — changes don't travel automatically.

```bash
# Check for changes
PATCH=""
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    PATCH=$(mktemp)
    git diff HEAD > "$PATCH"
fi
```

Skip this step if there are no changes to carry.

### Step 4: Create Worktree + Transition

Every worktree mode creates the worktree the same way, with git, then places the handoff and carries the patch:

```bash
REPO_NAME=$(basename "$(git remote get-url origin 2>/dev/null || basename "$(git rev-parse --show-toplevel)")" .git)
MAIN_PATH=$(git rev-parse --show-toplevel)
WORKTREE_PATH="$HOME/.worktrees/$REPO_NAME/<branch>"

if git show-ref -q --verify refs/heads/<branch> || git show-ref -q --verify refs/remotes/origin/<branch>; then
    git worktree add "$WORKTREE_PATH" <branch>
else
    git worktree add -b <branch> "$WORKTREE_PATH" "${BASE:-origin/HEAD}"   # BASE from --base
fi

for f in .env .env.local .dev.vars; do
    [ -f "$MAIN_PATH/$f" ] && cp "$MAIN_PATH/$f" "$WORKTREE_PATH/$f"
done

mkdir -p "$WORKTREE_PATH/.context"
cat > "$WORKTREE_PATH/.context/handoff.md" << 'EOF'
{generated handoff content}
EOF

if [ -n "$PATCH" ] && [ -s "$PATCH" ]; then
    git -C "$WORKTREE_PATH" apply "$PATCH" && rm "$PATCH"
fi
```

#### Terminal mode (default)

Open a new terminal tab in `$WORKTREE_PATH` running:

```bash
claude 'Read .context/handoff.md and continue the work described there.'
```

In Rex, open it as a tab in the current session with the `rex` CLI (the `rex` skill has the commands). Anywhere else,
give the user that command, prefixed with `cd "$WORKTREE_PATH" &&`, to paste into a new tab.

#### Move mode

The Bash tool resets `cwd` after every call, so `cd` does not move the session; `EnterWorktree` does.

1. Restore the original working directory to clean state, since the patch now lives in the worktree:
```bash
git checkout -- .
```

2. Switch the session in: `EnterWorktree(path: "<WORKTREE_PATH>")`. This works from the session's launch directory
   for any path in `git worktree list`. If the session is already in a worktree, the tool only accepts paths under
   `.claude/worktrees/`; then prefix every Read, Edit and Write with `$WORKTREE_PATH` instead, and tell the user the
   session works there through absolute paths.

When the session only needs relocating and `--base` doesn't matter, skip the git snippet and call
`EnterWorktree(name: "<branch>")` instead: it creates the worktree in `.claude/worktrees/` and moves the session there.

#### Team mode

After the worktree is created:

1. Create or reuse team:
```
TeamCreate(team_name: "fork-<branch>", description: "Forked work: <branch>")
```

2. Create task from handoff:
```
TaskCreate(
  subject: "<task from handoff Next Steps>",
  description: "<full handoff content>",
  activeForm: "Working on <branch>"
)
```

3. Spawn teammate in worktree:
```
Task(
  team_name: "fork-<branch>",
  name: "<branch>-worker",
  subagent_type: "general-purpose",
  prompt: "You are working in a forked worktree at ~/.worktrees/<repo>/<branch>.
    Use absolute paths for all file operations.
    Read .context/handoff.md at that path for full context.

    Work through the task list (TaskList). Update tasks as you progress (TaskUpdate).
    When blocked or done, message the team lead via SendMessage.
    Commit changes with conventional commits."
)
```

4. Assign task to teammate:
```
TaskUpdate(taskId: "<id>", owner: "<branch>-worker", status: "in_progress")
```

The main session stays active. Teammate messages arrive automatically when idle. The user can:
- Check progress: `TaskList`
- Send instructions: `SendMessage` to `<branch>-worker`
- Shut down: `SendMessage(type: "shutdown_request", recipient: "<branch>-worker")`

**Rollback on failure:**

If any step above fails, clean up what was created:

| Failed at | Clean up |
|-----------|----------|
| TeamCreate | Nothing to clean — abort and report error |
| TaskCreate | `TeamDelete(team_name: "fork-<branch>")` |
| Task spawn | Cancel task, then `TeamDelete` |
| TaskUpdate | Teammate is running but unassigned — send shutdown, then cancel task and delete team |

Report what happened: "Fork to `<branch>` failed at [step]. Cleaned up [resources]. Worktree exists at `~/.worktrees/<repo>/<branch>` — you can use it manually."

#### Background mode

After the worktree is created, run claude in the background with structured logging:

All paths must be absolute (use `$HOME`, not `~`). `WORKTREE_PATH` is built from `$HOME` so `LOG_DIR` inherits that.

```bash
WORKTREE_PATH="$HOME/.worktrees/$REPO_NAME/<branch>"  # absolute via $HOME
LOG_DIR="$WORKTREE_PATH/.context"
mkdir -p "$LOG_DIR"

cd "$WORKTREE_PATH" && \
  claude --print 'Read .context/handoff.md and complete the work described there. Commit with conventional commits.' \
  > "$LOG_DIR/fork.log" 2>&1 &
FORK_PID=$!
echo "$FORK_PID" > "$LOG_DIR/fork.pid"

# Write completion marker when done
(wait $FORK_PID; echo $? > "$LOG_DIR/fork.exit") &
```

Use `run_in_background: true` on the Bash tool call.

#### Local mode

```bash
mkdir -p .context
cat > .context/handoff.md << 'EOF'
{generated handoff content}
EOF
```

No worktree created. User opens a new terminal and runs `claude`.

### Step 5: Confirm

Mode-specific confirmation messages:

- **Terminal**: "Forked to `<branch>`. New terminal tab opened with interactive Claude session (or: here is the command to paste). Handoff at `~/.worktrees/<repo>/<branch>/.context/handoff.md`."
- **Move**: "Moved into worktree `<branch>`. To return: `ExitWorktree(action: "keep")`" (or if using absolute paths: "Working in `~/.worktrees/<repo>/<branch>` via absolute paths.")
- **Team**: "Forked to `<branch>`. Teammate `<branch>-worker` is working in the worktree. Messages will arrive here when they need input or finish."
- **Background**: "Forked to `<branch>`. Background agent running (PID in `.context/fork.pid`).
  - Monitor: `tail -f ~/.worktrees/<repo>/<branch>/.context/fork.log`
  - Check status: `test -f ~/.worktrees/<repo>/<branch>/.context/fork.exit && cat it`
  - Kill: `kill $(cat ~/.worktrees/<repo>/<branch>/.context/fork.pid)`"
- **Local**: "Context written to `.context/handoff.md`. Open a new terminal here and run `claude`."

If `--base` was used, include it in the confirmation: "Based on `<ref>`."

## Examples

### Terminal Fork (default)
```
User: /fork feature-dark-mode

Claude: I'll fork this session to a new worktree with an interactive Claude session.

[Generates handoff summary]
[Runs git worktree add, writes .context/handoff.md, opens a Rex tab running claude]

Forked to `feature-dark-mode`. New terminal tab opened with interactive Claude session.
Handoff at ~/.worktrees/dotclaude/feature-dark-mode/.context/handoff.md
```

### Move with uncommitted changes
```
User: /fork fix-timeout --move

Claude: I'll fork and move this session into the worktree, carrying your changes.

[Captures git diff as patch]
[Runs git worktree add, writes .context/handoff.md]
[Applies patch in worktree]
[Restores original working directory]
[Works via absolute paths to ~/.worktrees/myapp/fix-timeout/]

Moved into worktree `fix-timeout`. Working via absolute paths.
Changes from main applied. To return: work in /original/path.
```

### Fork from a specific base
```
User: /fork fix-auth-bug --base release/v2.1

[Runs git worktree add -b fix-auth-bug ... release/v2.1, writes the handoff, opens a tab]

Forked to `fix-auth-bug` based on `release/v2.1`. New terminal tab opened.
```

### Team Fork
```
User: /fork feature-auth --team

[Creates worktree, applies any patches, creates team, spawns teammate]

Forked to `feature-auth`. Teammate `feature-auth-worker` is working in the worktree.
Messages will arrive here when they need input or finish.
```

### Local Fork
```
User: /fork --local

[Writes to .context/handoff.md]

Context written to `.context/handoff.md`.
Open a new terminal here and run `claude`.
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Changes missing in worktree | Worktree created from clean base branch | Capture `git diff HEAD` as patch before creating worktree, apply after |
| `cd` doesn't persist after Bash call | Claude Code Bash tool resets cwd per invocation | Use absolute paths or `EnterWorktree` tool |
| `EnterWorktree` rejects a `~/.worktrees/` path | Once the session is in a worktree, it only switches into `.claude/worktrees/` | Work in `~/.worktrees/` through absolute paths |

## Notes

- **Worktree naming**: `<repo>` is derived from `git remote get-url origin` (e.g., `~/.claude` with remote `dotclaude.git` → `~/.worktrees/dotclaude/<branch>`) <!-- portability: allow -->
- **Requires**: git; the `rex` CLI for opening a tab in Rex
- The handoff is a snapshot — it won't update if you continue working here
- Use `/chronicle` if you want persistent cross-session memory instead
- `--base` defaults to origin's default branch (`origin/HEAD`)
