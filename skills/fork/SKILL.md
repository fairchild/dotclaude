---
name: fork
description: Fork the current session with context carried over. Use `/fork <branch>` for a new worktree or `/fork --local` for a new session in the current directory.
license: Apache-2.0
requires:
  - git-worktree  # wt.sh for worktree creation (when not --local)
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
```

## Modes

| Mode | Interactive? | Coordinated? | User stays here? | Best for |
|------|-------------|-------------|-------------------|----------|
| Terminal (default) | Yes | No | Yes | Exploratory/uncertain work |
| Move | Yes | N/A | No | Fully switching focus |
| Team | No | Yes | Yes | Delegated work with oversight |
| Background | No | No | Yes | Well-defined autonomous tasks |
| Local | Manual | N/A | Yes | When other modes aren't available |

## Critical: Invoking wt

`wt` is a **shell function** loaded by `.zshrc`. It is NOT available in Claude Code's Bash tool. Always invoke the script directly:

```bash
WT_SCRIPT="$HOME/.claude/skills/git-worktree/scripts/wt.sh"
bash "$WT_SCRIPT" <branch> [options]
```

**Never** use bare `wt`, `$_WT_SCRIPT`, or `source wt.zsh`. These all fail in non-interactive shells.

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
- `--base <ref>` — Create the worktree from a specific branch, tag, or commit instead of main. Passed through to `wt` as `--base <ref>`.

### Step 2: Generate Context Summary

Create a handoff document summarizing:

1. **Current Task** - what we're working on
2. **Progress** - what's been done so far
3. **Key Decisions** - important choices made
4. **Next Steps** - what the new session should tackle
5. **Relevant Files** - files we've been working with
6. **Open Questions** - unresolved issues

Use this template:

```markdown
# Session Handoff

## Current Task
{Brief description of what we're working on}

## Progress
- {What's been completed}
- {What's in progress}

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

---
*Forked from session on {date}*
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

All worktree modes use `wt.sh` directly. Determine the repo name for the worktree path:

```bash
WT_SCRIPT="$HOME/.claude/skills/git-worktree/scripts/wt.sh"
REPO_NAME=$(basename "$(git remote get-url origin 2>/dev/null || basename "$(git rev-parse --show-toplevel)")" .git)
```

#### Terminal mode (default)

```bash
HANDOFF=$(mktemp)
cat > "$HANDOFF" << 'EOF'
{generated handoff content}
EOF

bash "$WT_SCRIPT" <branch> --no-editor --context "$HANDOFF" --open  # add --base <ref> if specified
```

The `--open` flag opens a new terminal tab in the worktree with an interactive claude session. Since `--context` places a handoff file, `--open` automatically tells claude to read it.

#### Move mode

Move mode uses Claude Code's `EnterWorktree` tool, which is the **only** way to actually relocate the session's working directory. The Bash tool resets `cwd` after every call — `cd` does not persist.

```bash
HANDOFF=$(mktemp)
cat > "$HANDOFF" << 'EOF'
{generated handoff content}
EOF

bash "$WT_SCRIPT" <branch> --no-editor --context "$HANDOFF"  # add --base <ref> if specified
```

After the worktree is created:

1. Apply the patch if changes were captured:
```bash
WORKTREE_PATH="$HOME/.worktrees/$REPO_NAME/<branch>"
if [ -n "$PATCH" ] && [ -s "$PATCH" ]; then
    git -C "$WORKTREE_PATH" apply "$PATCH"
    rm "$PATCH"
fi
```

2. Restore the original working directory to clean state:
```bash
git checkout -- .
```

3. Use `EnterWorktree` tool to switch the session:
```
EnterWorktree(name: "<branch>")
```

**Note:** `EnterWorktree` creates its own worktree in `.claude/worktrees/`. If you already created one with `wt.sh`, the session will have two worktrees. To avoid this, you can skip `wt.sh` and use only `EnterWorktree` — but you lose `--base`, `--context`, and conductor setup. Choose based on what the session needs:

- **Needs `--base`, conductor, or `--context`**: Use `wt.sh`, then work via absolute paths (don't use `EnterWorktree`). Set `WT_PATH` and prefix all subsequent file operations with it.
- **Just needs session relocation**: Skip `wt.sh`, use `EnterWorktree` directly.

When using absolute paths without `EnterWorktree`:
```bash
WT_PATH="$HOME/.worktrees/$REPO_NAME/<branch>"
# All subsequent Read/Edit/Write calls use $WT_PATH/path/to/file
```

Tell the user: "Working in `~/.worktrees/<repo>/<branch>` via absolute paths. All file operations target the worktree."

#### Team mode

```bash
HANDOFF=$(mktemp)
cat > "$HANDOFF" << 'EOF'
{generated handoff content}
EOF

bash "$WT_SCRIPT" <branch> --no-editor --context "$HANDOFF"  # add --base <ref> if specified

# Apply patch if changes were captured
WORKTREE_PATH="$HOME/.worktrees/$REPO_NAME/<branch>"
if [ -n "$PATCH" ] && [ -s "$PATCH" ]; then
    git -C "$WORKTREE_PATH" apply "$PATCH"
fi
```

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

#### Background mode

```bash
HANDOFF=$(mktemp)
cat > "$HANDOFF" << 'EOF'
{generated handoff content}
EOF

bash "$WT_SCRIPT" <branch> --no-editor --context "$HANDOFF"  # add --base <ref> if specified

# Apply patch if changes were captured
WORKTREE_PATH="$HOME/.worktrees/$REPO_NAME/<branch>"
if [ -n "$PATCH" ] && [ -s "$PATCH" ]; then
    git -C "$WORKTREE_PATH" apply "$PATCH"
fi
```

After the worktree is created, run claude in the background:

```bash
cd ~/.worktrees/<repo>/<branch> && claude --print 'Read .context/handoff.md and complete the work described there. Commit with conventional commits.' > /tmp/fork-<branch>.log 2>&1
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

- **Terminal**: "Forked to `<branch>`. New terminal tab opened with interactive Claude session. Handoff at `~/.worktrees/<repo>/<branch>/.context/handoff.md`."
- **Move**: "Moved into worktree `<branch>`. To return: `cd <original_path>`" (or if using absolute paths: "Working in `~/.worktrees/<repo>/<branch>` via absolute paths.")
- **Team**: "Forked to `<branch>`. Teammate `<branch>-worker` is working in the worktree. Messages will arrive here when they need input or finish."
- **Background**: "Forked to `<branch>`. Monitor: `tail -f /tmp/fork-<branch>.log`"
- **Local**: "Context written to `.context/handoff.md`. Open a new terminal here and run `claude`."

If `--base` was used, include it in the confirmation: "Based on `<ref>`."

## Examples

### Terminal Fork (default)
```
User: /fork feature-dark-mode

Claude: I'll fork this session to a new worktree with an interactive Claude session.

[Generates handoff summary]
[Runs: bash $WT_SCRIPT feature-dark-mode --no-editor --context /tmp/handoff.md --open]

Forked to `feature-dark-mode`. New terminal tab opened with interactive Claude session.
Handoff at ~/.worktrees/dotclaude/feature-dark-mode/.context/handoff.md
```

### Move with uncommitted changes
```
User: /fork fix-timeout --move

Claude: I'll fork and move this session into the worktree, carrying your changes.

[Captures git diff as patch]
[Runs: bash $WT_SCRIPT fix-timeout --no-editor --context /tmp/handoff.md]
[Applies patch in worktree]
[Restores original working directory]
[Works via absolute paths to ~/.worktrees/myapp/fix-timeout/]

Moved into worktree `fix-timeout`. Working via absolute paths.
Changes from main applied. To return: work in /original/path.
```

### Fork from a specific base
```
User: /fork fix-auth-bug --base release/v2.1

[Runs: bash $WT_SCRIPT fix-auth-bug --base release/v2.1 --no-editor --context /tmp/handoff.md --open]

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
| `wt: command not found` or `permission denied` | Used bare `wt` or `$_WT_SCRIPT` | Use `bash $HOME/.claude/skills/git-worktree/scripts/wt.sh` |
| `compdef: assignment to invalid subscript` | Sourced `wt.zsh` in non-interactive shell | Use `wt.sh` (bash), not `wt.zsh` |
| Changes missing in worktree | Worktree created from clean base branch | Capture `git diff HEAD` as patch before creating worktree, apply after |
| `cd` doesn't persist after Bash call | Claude Code Bash tool resets cwd per invocation | Use absolute paths or `EnterWorktree` tool |
| `EnterWorktree` uses wrong location | It creates in `.claude/worktrees/`, not `~/.worktrees/` | Use `wt.sh` + absolute paths if you need `~/.worktrees/` convention |

## Notes

- **Worktree naming**: `<repo>` is derived from `git remote get-url origin` (e.g., `~/.claude` with remote `dotclaude.git` → `~/.worktrees/dotclaude/<branch>`)
- **Requires**: `git-worktree` skill for all modes except `--local`
- The handoff is a snapshot — it won't update if you continue working here
- Use `/chronicle` if you want persistent cross-session memory instead
- Worktree mode runs setup scripts from `conductor.json` if present
- Terminal mode uses `wt --open` which requires macOS (osascript)
- `--base` defaults to `main` if not specified (same as `wt` default)
