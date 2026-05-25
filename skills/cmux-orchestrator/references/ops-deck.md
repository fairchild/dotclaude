# Ops Deck

An Ops Deck is a multi-agent monitoring layout for parallel work:

```
Orchestrator workspace:
  Sidebar: title, progress bar, agent status per spawned workspace

Agent workspace 1 ("tests"):
  Sidebar: status, progress, logs
  Inbox: repo-shared .agents/inbox/test-runner/

Agent workspace 2 ("lint"):
  Sidebar: status, progress, logs
  Inbox: repo-shared .agents/inbox/linter/

All connected via agent-inbox protocol.
```

## Build Flow

1. Orient:
   ```bash
   cmux tree --all
   cmux identify
   ```

2. Set up inboxes:
   ```bash
   . ~/.claude/skills/agent-inbox/scripts/lib.sh
   inbox_root="$(agent_inbox_root)"
   mkdir -p "$inbox_root/orchestrator"/{new,tmp,archive}
   mkdir -p "$inbox_root/test-runner"/{new,tmp,archive}
   mkdir -p "$inbox_root/linter"/{new,tmp,archive}
   ```

3. Set initial sidebar state:
   ```bash
   cmux rename-workspace "[project] ops deck"
   cmux set-progress 0.0 --label "Spawning agents..."
   cmux set-status "test-runner" "spawning" --icon "hourglass" --color "#FFB800"
   cmux set-status "linter" "spawning" --icon "hourglass" --color "#FFB800"
   ```

4. Write prompts to each child inbox. Example:
   ```bash
   TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)
   cat > "$inbox_root/test-runner/tmp/${TIMESTAMP}-task.md" <<'EOF'
   ---
   from: orchestrator
   to: test-runner
   reply_to: ../orchestrator/tmp/
   timestamp: 2026-03-21T18:00:00Z
   thread: ops-deck
   ---

   Run the test suite. Include pass/fail counts and any failure details in your reply.
   EOF
   mv "$inbox_root/test-runner/tmp/${TIMESTAMP}-task.md" "$inbox_root/test-runner/new/"
   ```

5. Spawn agent workspaces:
   ```bash
   cmux new-workspace --cwd ~/code/myproject \
     --command "claude --dangerously-skip-permissions -n test-runner --add-dir '$inbox_root' 'Check your inbox at $inbox_root/test-runner/new/ and execute the task. Reply to $inbox_root/orchestrator/ when done.'"

   cmux new-workspace --cwd ~/code/myproject \
     --command "claude --dangerously-skip-permissions -n linter --add-dir '$inbox_root' 'Check your inbox at $inbox_root/linter/new/ and execute the task. Reply to $inbox_root/orchestrator/ when done.'"
   ```

6. Name workspaces and tabs:
   ```bash
   cmux rename-workspace --workspace <ref1> "tests"
   cmux rename-workspace --workspace <ref2> "lint"
   cmux rename-tab --surface <surface1> "test-runner"
   cmux rename-tab --surface <surface2> "linter"
   ```

7. Verify each workspace started:
   ```bash
   cmux read-screen --surface <agent-surface> --lines 15
   ```
   Fix wrong cwd, missing deps, or command errors before proceeding.

8. Update progress as agents come online:
   ```bash
   cmux set-progress 0.33 --label "Agents running..."
   cmux set-status "test-runner" "running" --icon "bolt.fill" --color "#00BFFF"
   cmux set-status "linter" "running" --icon "bolt.fill" --color "#00BFFF"
   ```

9. Monitor through both channels:
   - Screen state: `cmux read-screen --surface <agent-surface> --lines 20`
   - Structured results: `ls "$inbox_root/orchestrator/new/"`

10. Read and archive replies:
    ```bash
    cat "$inbox_root/orchestrator/new/<message>.md"
    mv "$inbox_root/orchestrator/new/<message>.md" "$inbox_root/orchestrator/archive/"
    ```

11. Update final sidebar state:
    ```bash
    cmux set-progress 1.0 --label "All agents complete"
    cmux set-status "test-runner" "42 passed" --icon "checkmark.circle" --color "#00FF00"
    cmux set-status "linter" "clean" --icon "checkmark.circle" --color "#00FF00"
    cmux notify --title "Ops Deck Complete" --body "Tests: 42 passed, Lint: clean"
    ```

## Scaling

- More agents: add inbox directories and workspace spawns.
- Bidirectional communication: every inbox message includes `reply_to`.
- Auto-notification: configure the agent-inbox stop hook so agents see unread mail automatically.
