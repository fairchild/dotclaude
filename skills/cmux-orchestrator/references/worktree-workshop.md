# Worktree Workshop — Detailed Flow

A Workshop that starts from a branch name instead of an existing directory. Creates an isolated worktree, then sets up the full Workshop layout inside it.

This flow is self-contained — it uses `git worktree` directly, no external scripts required.

## Entry points

```
# From inside the target repo (common case):
"set up a worktree workshop for feature-auth"

# From anywhere, targeting a specific repo:
"set up a worktree workshop for feature-auth on ~/code/myproject"
```

## How to build it

### Phase 1: Create the worktree

1. **Resolve the repo directory.** If `--repo` was specified, use that path. Otherwise, use the current working directory. Confirm it's a git repo:
   ```bash
   REPO_DIR="<repo-dir>"  # cwd or --repo path
   git -C "$REPO_DIR" rev-parse --git-dir 2>/dev/null || echo "Not a git repo"
   ```

2. **Derive the repo name and worktree path** from the origin remote:
   ```bash
   REPO_NAME=$(basename "$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || basename "$(git -C "$REPO_DIR" rev-parse --show-toplevel)")" .git)
   WORKTREE_PATH="$HOME/.worktrees/$REPO_NAME/<branch>"
   ```

3. **Check if the worktree already exists:**
   ```bash
   if [ -d "$WORKTREE_PATH" ]; then
     # Ask: "Worktree <branch> exists at <path>. Use it, or pick a different name?"
     # If reusing, skip to Phase 2
   fi
   ```

4. **Find the main repo root** (handles being called from inside an existing worktree):
   ```bash
   GIT_DIR=$(git -C "$REPO_DIR" rev-parse --git-dir)
   if [ -f "$GIT_DIR" ]; then
     # Inside a worktree — .git is a file pointing to main repo
     MAIN_REPO=$(cat "$GIT_DIR" | sed 's/^gitdir: //' | sed 's|/\.git/worktrees/.*||')
   else
     MAIN_REPO=$(git -C "$REPO_DIR" rev-parse --show-toplevel)
   fi
   ```

5. **Create the worktree** with `git worktree add`. Handle three cases — existing local branch, remote tracking branch, or new branch:
   ```bash
   mkdir -p "$(dirname "$WORKTREE_PATH")"

   BRANCH="<branch>"
   BASE_BRANCH="main"  # default, or user-specified

   if git -C "$MAIN_REPO" show-ref --verify --quiet "refs/heads/$BRANCH" 2>/dev/null; then
     # Existing local branch
     git -C "$MAIN_REPO" worktree add "$WORKTREE_PATH" "$BRANCH"
   elif git -C "$MAIN_REPO" show-ref --verify --quiet "refs/remotes/origin/$BRANCH" 2>/dev/null; then
     # Remote tracking branch
     git -C "$MAIN_REPO" worktree add "$WORKTREE_PATH" "$BRANCH"
   else
     # New branch from base
     git -C "$MAIN_REPO" worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_BRANCH"
   fi
   ```

6. **Copy environment files** from the main repo (these are typically gitignored):
   ```bash
   for f in .env .env.local .dev.vars; do
     [ -f "$MAIN_REPO/$f" ] && cp "$MAIN_REPO/$f" "$WORKTREE_PATH/$f"
   done
   ```

7. **Run setup if needed.** Check for `conductor.json` first (its `scripts.setup` runs with `CONDUCTOR_ROOT_PATH` pointing at the main repo), then fall back to `scripts/setup` (project-scripts convention):
   ```bash
   if [ -f "$MAIN_REPO/conductor.json" ] && command -v jq &>/dev/null; then
     SETUP_CMD=$(jq -r '.scripts.setup // empty' "$MAIN_REPO/conductor.json")
     if [ -n "$SETUP_CMD" ]; then
       (cd "$WORKTREE_PATH" && CONDUCTOR_ROOT_PATH="$MAIN_REPO" eval "$SETUP_CMD")
     fi
   elif [ -x "$WORKTREE_PATH/scripts/setup" ]; then
     (cd "$WORKTREE_PATH" && scripts/setup)
   fi
   ```

### Phase 2: Launch cmux workspace

8. **Create the workspace** pointing at the worktree:
   ```bash
   cmux new-workspace --cwd "$WORKTREE_PATH"
   ```
   Note the returned ref (e.g., `workspace:6`). **Pass `--workspace <ref>` to all subsequent commands** — your `$CMUX_WORKSPACE_ID` still points to the calling workspace.

9. **Discover the surface ID** — `new-workspace` returns only the workspace ref. Query for the surface:
   ```bash
   cmux list-panes --workspace <ws>
   ```
   Note the pane and surface refs.

10. **Verify the workspace landed in the right directory:**
    ```bash
    cmux send --workspace <ws> --surface <surface> "pwd"
    cmux send-key --workspace <ws> --surface <surface> Enter
    # Wait briefly, then:
    cmux read-screen --workspace <ws> --surface <surface> --lines 5
    ```
    Confirm the output shows `$WORKTREE_PATH`. If not, fix with `cmux send ... "cd $WORKTREE_PATH"`.

11. **Name the workspace** with the `<repo>: <branch>` convention:
    ```bash
    cmux rename-workspace --workspace <ws> "$REPO_NAME: <branch>"
    ```

### Phase 3: Standard Workshop setup

From here, follow the standard Workshop convention (detect commands, build layout, set up sidebar). The only differences:

- **Project root** is `$WORKTREE_PATH`, not `~/code/<project>`
- **Coder inbox** goes inside the worktree (the agent reads from here). **Spell out each path** — brace expansion `{a,b,c}` doesn't work in heredocs or non-interactive shells:
  ```bash
  mkdir -p "$WORKTREE_PATH/.agents/inbox/coder/new" \
           "$WORKTREE_PATH/.agents/inbox/coder/tmp" \
           "$WORKTREE_PATH/.agents/inbox/coder/archive"
  ```
- **Orchestrator inbox** lives in the orchestrator's own directory — not the worktree. The orchestrator session reads from its own cwd, so replies must land there:
  ```bash
  # ORCHESTRATOR_DIR is where the orchestrator session runs (e.g., ~/code/dotclaude, or the current worktree)
  mkdir -p "$ORCHESTRATOR_DIR/.agents/inbox/orchestrator/new" \
           "$ORCHESTRATOR_DIR/.agents/inbox/orchestrator/tmp" \
           "$ORCHESTRATOR_DIR/.agents/inbox/orchestrator/archive"
  ```
  When writing the coder's task to the inbox, set `reply_to` to the **absolute path** of the orchestrator's inbox so the agent knows where to send results:
  ```yaml
  reply_to: /absolute/path/to/orchestrator/.agents/inbox/orchestrator/
  ```
- **Sidebar status** includes the branch context:
  ```bash
  cmux set-status "worktree" "$WORKTREE_PATH" --icon "arrow.triangle.branch" --color "#888888" --workspace <ws>
  cmux log --workspace <ws> "Worktree workshop ready — branch <branch> from $REPO_NAME"
  ```

Refer to the Workshop "How to build it" steps 3–13 for the full layout build (project detection, splits, dev server, tests, browser, agent inbox, sidebar dashboard).

## Handling edge cases

| Situation | Behavior |
|-----------|----------|
| Worktree already exists | Ask: "Worktree `<branch>` exists at `<path>`. Use it, or pick a different name?" |
| Not in a git repo (no `--repo`) | Error: "Not in a git repo. Use `--repo ~/code/<project>` to specify one." |
| No origin remote | Fall back to `basename $(git rev-parse --show-toplevel)` for repo name |
| `conductor.json` ran setup | Skip `scripts/setup` — don't double-run |
| No `scripts/run` or dev server | Skip dev server pane — give agent the full top row (same as Workshop adaptation) |
| No test command detected | Skip test watcher pane |
| Called from inside a worktree | Resolve main repo via `.git` file contents (step 4) |

## Cleanup

When done with the worktree workshop:

```bash
# From inside the worktree — merge back and archive:
cd "$WORKTREE_PATH"
git rebase main
cd "$MAIN_REPO" && git merge --ff-only <branch>
git push  # if desired

# Remove the worktree:
git -C "$MAIN_REPO" worktree remove "$WORKTREE_PATH"
# Or move to archive:
mkdir -p "$HOME/.worktrees/.archive/$REPO_NAME"
mv "$WORKTREE_PATH" "$HOME/.worktrees/.archive/$REPO_NAME/<branch>"
git -C "$MAIN_REPO" worktree prune
```

If `wt` (git-worktree skill) is installed, these shortcuts work:
- `wt apply --push --archive` — rebase, merge, push, and archive in one command
- `wt archive <branch>` — run conductor archive script and move to `.archive/`

## Dispatching an agent into the workshop

Launch agents **interactively** by default — they can prompt for permissions and the human can take over:

```bash
# --add-dir for both the local inbox AND the orchestrator's inbox (which is outside the worktree)
cmux send --workspace <ws> --surface <surface> "claude -n coder --add-dir .agents/inbox --add-dir $ORCHESTRATOR_DIR/.agents/inbox \"Check your inbox at .agents/inbox/coder/new/ and execute the task. When done, send results to the reply_to path specified in the inbox message.\""
cmux send-key --workspace <ws> --surface <surface> Enter
```

The agent needs `--add-dir` for both inboxes:
- `.agents/inbox` — its own inbox in the worktree (relative, in cwd)
- `$ORCHESTRATOR_DIR/.agents/inbox` — the orchestrator's inbox (absolute, outside the worktree)

Without the second `--add-dir`, the agent won't have write access to deliver replies.

### Gotchas discovered during live testing

**1. `--allowedTools` swallows the positional prompt in `-p` mode.**
`claude -p --allowedTools "Bash(cmux:*)" "my prompt"` silently eats the prompt as an `--allowedTools` value. If you need `-p` mode, pipe the prompt via stdin:
```bash
echo "Your task prompt here" | claude -p --allowedTools "Bash(cmux:*)"
```

**2. `-n <name>` can resume a prior session.**
If a session named `coder` already exists in this project, `-n coder` resumes it instead of starting fresh. The agent may start working on a stale task. If this happens, interrupt (Escape) and redirect: "Stop. Read .agents/inbox/coder/new/ and execute THAT task instead."

**3. Brace expansion doesn't work in `mkdir -p` inside heredocs or non-interactive shells.**
`mkdir -p dir/{a,b,c}` creates a literal directory named `{a,b,c}`. Always spell out each path:
```bash
mkdir -p dir/a dir/b dir/c
```

## Adapting the worktree workshop

All Workshop adaptations apply here. Additionally:

- **Cross-repo orchestration?** Use `--repo` to target any repo from your current workspace. The orchestrator stays in its own workspace while the workshop runs in the worktree.
- **Session fork?** Write a handoff file before setup: `mkdir -p $WORKTREE_PATH/.context && cp handoff.md $WORKTREE_PATH/.context/handoff.md`
- **When done?** See Cleanup above.
