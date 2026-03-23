# Worktree Workshop — Detailed Flow

A Workshop that starts from a branch name instead of an existing directory. Creates an isolated worktree, then sets up the full Workshop layout inside it.

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
   git -C <repo-dir> rev-parse --git-dir 2>/dev/null
   ```

2. **Create the worktree** using `wt.sh` directly (it's a shell function, not available in Claude Code's Bash tool):
   ```bash
   WT_SCRIPT="$HOME/.claude/skills/git-worktree/scripts/wt.sh"
   cd <repo-dir> && bash "$WT_SCRIPT" <branch> --no-editor
   ```
   `--no-editor` is important — cmux handles the terminal, not the editor.

3. **Capture the worktree path** from the repo's origin remote:
   ```bash
   REPO_NAME=$(basename "$(git -C <repo-dir> remote get-url origin)" .git)
   WORKTREE_PATH="$HOME/.worktrees/$REPO_NAME/<branch>"
   ```

4. **Check if `wt`/conductor already ran setup.** If `conductor.json` exists in the repo, `wt` ran its `scripts.setup` automatically — don't double-run. Only run `scripts/setup` (project-scripts convention) if conductor didn't handle it:
   ```bash
   # conductor.json present → setup already ran via wt
   # No conductor.json but scripts/setup exists → run it
   if [ ! -f "$WORKTREE_PATH/conductor.json" ] && [ -x "$WORKTREE_PATH/scripts/setup" ]; then
     cd "$WORKTREE_PATH" && scripts/setup
   fi
   ```

### Phase 2: Launch cmux workspace

5. **Create the workspace** pointing at the worktree:
   ```bash
   cmux new-workspace --cwd "$WORKTREE_PATH"
   ```
   Note the returned ref (e.g., `workspace:6`). **Pass `--workspace <ref>` to all subsequent commands** — your `$CMUX_WORKSPACE_ID` still points to the calling workspace.

6. **Discover the surface ID** — `new-workspace` returns only the workspace ref. Query for the surface:
   ```bash
   cmux list-panes --workspace <ws>
   ```
   Note the pane and surface refs.

7. **Verify the workspace landed in the right directory:**
   ```bash
   cmux send --workspace <ws> --surface <surface> "pwd"
   cmux send-key --workspace <ws> --surface <surface> Enter
   # Wait briefly, then:
   cmux read-screen --workspace <ws> --surface <surface> --lines 5
   ```
   Confirm the output shows `$WORKTREE_PATH`. If not, fix with `cmux send ... "cd $WORKTREE_PATH"`.

8. **Name the workspace** with the `<repo>: <branch>` convention:
   ```bash
   cmux rename-workspace --workspace <ws> "$REPO_NAME: <branch>"
   ```

### Phase 3: Standard Workshop setup

From here, follow the standard Workshop convention (detect commands, build layout, set up sidebar). The only differences:

- **Project root** is `$WORKTREE_PATH`, not `~/code/<project>`
- **Inbox directories** go inside the worktree:
  ```bash
  mkdir -p "$WORKTREE_PATH/.agents/inbox/coder/{new,tmp,archive}"
  mkdir -p "$WORKTREE_PATH/.agents/inbox/orchestrator/{new,tmp,archive}"
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
| `wt.sh` not installed | Error: "git-worktree skill required. Install with `wt install`." |
| Not in a git repo (no `--repo`) | Error: "Not in a git repo. Use `--repo ~/code/<project>` to specify one." |
| `conductor.json` ran setup | Skip `scripts/setup` — don't double-run |
| No `scripts/run` or dev server | Skip dev server pane — give agent the full top row (same as Workshop adaptation) |
| No test command detected | Skip test watcher pane |

## Adapting the worktree workshop

All Workshop adaptations apply here. Additionally:

- **Cross-repo orchestration?** Use `--repo` to target any repo from your current workspace. The orchestrator stays in its own workspace while the workshop runs in the worktree.
- **Session fork?** Combine with the fork skill: `wt <branch> --context handoff.md` carries session context into the worktree before the workshop sets up around it.
- **When done?** Use `wt apply --push --archive` from the worktree to merge back and clean up, or `wt archive <branch>` from the main repo.
