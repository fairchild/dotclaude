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
- **Coder and caller share one inbox tree.** The `agent-inbox` skill resolves `.agents/inbox/` via `git rev-parse --git-common-dir`, so worktrees of the same repo see the same inbox. Create the coder's mailbox at the shared root:
  ```bash
  SHARED_INBOX="$(cd "$WORKTREE_PATH" && dirname "$(git rev-parse --git-common-dir)")/.agents/inbox"
  mkdir -p "$SHARED_INBOX/coder"/{new,tmp,archive}
  mkdir -p "$SHARED_INBOX/<caller-name>"/{new,tmp,archive}
  ```
  `reply_to` in the coder's task message uses the standard sibling form:
  ```yaml
  reply_to: ../<caller-name>/tmp/
  ```
  Cross-repo callers (different clone) still need explicit `--add-dir` — see Dispatching below.
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

Same-repo callers share the inbox tree via git-common-dir, so a single `--add-dir` on the shared inbox is enough:

```bash
SHARED_INBOX="$(cd "$WORKTREE_PATH" && dirname "$(git rev-parse --git-common-dir)")/.agents/inbox"
claude --dangerously-skip-permissions -n coder \
  --add-dir "$SHARED_INBOX" \
  "Check your inbox at $SHARED_INBOX/coder/new/ and execute the task. Reply to the reply_to path in the inbox message."
```

Cross-repo callers (orchestrator in a different clone) still need a second `--add-dir` to the caller's inbox — the git-common-dir resolution only spans one repo's worktrees.

### Gotchas discovered during live testing

**1. Pass the message as a positional argument.**
Interactive mode with a positional message gives the agent full tool access. It reads files, runs commands, and iterates autonomously until done.

**2. `-n <name>` can resume a prior session.**
If a session named `coder` already exists in this project, `-n coder` resumes it instead of starting fresh. The agent may work on a stale task. If this happens, interrupt (Escape) and redirect.

**3. Brace expansion breaks when braces are inside quotes.**
`mkdir -p "$VAR/{a,b,c}"` creates a literal `{a,b,c}` directory. Keep braces outside the quoted portion: `mkdir -p "$VAR"/{a,b,c}` or spell out each path.

## Adapting the worktree workshop

All Workshop adaptations apply here. Additionally:

- **Cross-repo orchestration?** Use `--repo` to target any repo from your current workspace. The orchestrator stays in its own workspace while the workshop runs in the worktree.
- **Session fork?** Write a handoff file before setup: `mkdir -p $WORKTREE_PATH/.context && cp handoff.md $WORKTREE_PATH/.context/handoff.md`
- **When done?** See Cleanup above.
