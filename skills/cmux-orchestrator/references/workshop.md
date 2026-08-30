# Workshop Layout

A Workshop is a focused development layout for one project:

```
+---------------------+---------------------+
|                     |                      |
|  Agent / Coding     |  Browser (preview)   |
|  (top-left, tall)   |  (top-right, tall)   |
|                     |                      |
+---------------------+---------------------+
|  Dev Server (compact, full width)          |
+--------------------------------------------+
|  Test Watcher (compact, full width)        |
+--------------------------------------------+

Sidebar:
  Title: "[project] workshop"
  Status: agent: ready, dev-server: running, tests: watching
  Progress: cleared except during setup

Inbox: repo-shared `.agents/inbox/coder/`
```

## Build Flow

1. Orient:
   ```bash
   cmux tree --all
   cmux identify
   ```

2. Create the workspace:
   ```bash
   cmux new-workspace --cwd ~/code/<project>
   ```
   Note the returned ref and pass `--workspace <ref>` to later commands.

3. Detect commands from project files. Prefer repo-native scripts, then lockfile conventions:

   | Check | Setup/dev command | Test command |
   |-------|-------------------|--------------|
   | `scripts/setup` + `scripts/run` | `scripts/setup && scripts/run` | `scripts/test` or fallback |
   | `bun.lock` | `bun install && bun run dev` | `bun run test -- --watch` or `bunx vitest --watch` |
   | `pnpm-lock.yaml` | `pnpm install && pnpm dev` | `pnpm test -- --watch` |
   | `package-lock.json` | `npm install && npm run dev` | `npm test -- --watch` |
   | `uv.lock` | `uv sync && uv run dev` | `uv run pytest --watch` |
   | `Cargo.lock` | `cargo build && cargo run` | `cargo watch -x test` |

   Read package scripts or project docs to confirm. The table is a starting point.

4. Build the layout. Split down twice first, then split the top pane right for the browser:
   ```bash
   cmux new-split down --workspace <ws>
   cmux new-split down --workspace <ws>
   cmux list-panes --workspace <ws>
   ```

5. Resize output rows compactly:
   ```bash
   cmux resize-pane --pane <middle> --workspace <ws> -U --amount 15
   cmux resize-pane --pane <bottom> --workspace <ws> -U --amount 10
   ```

6. Run the dev server in the middle pane, then verify:
   ```bash
   cmux send --workspace <ws> --surface <middle> "<setup-and-run-cmd>"
   cmux send-key --workspace <ws> --surface <middle> Enter
   cmux read-screen --workspace <ws> --surface <middle> --lines 15
   ```

7. Open the browser at the discovered URL:
   ```bash
   cmux new-pane --type browser --direction right --workspace <ws> --url <discovered-url>
   ```

8. Start the test watcher in the bottom pane and verify:
   ```bash
   cmux send --workspace <ws> --surface <bottom> "<test-watch-cmd>"
   cmux send-key --workspace <ws> --surface <bottom> Enter
   cmux read-screen --workspace <ws> --surface <bottom> --lines 15
   ```

9. Set up the repo-shared inbox:
   ```bash
   . <agent-inbox base dir>/scripts/lib.sh
   inbox_root="$(agent_inbox_root)"
   mkdir -p "$inbox_root/coder"/{new,tmp,archive}
   mkdir -p "$inbox_root/orchestrator"/{new,tmp,archive}
   ```

10. Name everything:
    ```bash
    cmux rename-workspace --workspace <ws> "[project] workshop"
    cmux rename-tab --workspace <ws> --surface <top> "agent"
    cmux rename-tab --workspace <ws> --surface <middle> "dev server"
    cmux rename-tab --workspace <ws> --surface <bottom> "tests"
    ```

11. Set sidebar state only after verification:
    ```bash
    cmux set-status "agent" "ready" --icon "person.fill" --color "#888888" --workspace <ws>
    cmux set-status "dev-server" "<discovered-url>" --icon "bolt.fill" --color "#00FF00" --workspace <ws>
    cmux set-status "tests" "watching" --icon "magnifyingglass" --color "#FFB800" --workspace <ws>
    cmux log --workspace <ws> "Workshop ready — agent pane idle, inbox at $inbox_root/coder/"
    ```

## Launching an Agent

Use the prompt-via-inbox pattern:

1. Write the task to `$inbox_root/coder/tmp/`, then atomically move it to `new/`.
2. Launch the child in the agent pane:
   ```bash
   cmux send --workspace <ws> --surface <top> "claude --dangerously-skip-permissions -n coder --add-dir '$inbox_root' 'Check your inbox at $inbox_root/coder/new/ and execute the task. Reply to $inbox_root/orchestrator/ when done.'"
   cmux send-key --workspace <ws> --surface <top> Enter
   ```
3. Update sidebar:
   ```bash
   cmux set-status "agent" "working" --icon "hammer.fill" --color "#FFB800" --workspace <ws>
   ```

The child can read test output with `cmux read-screen`, use browser snapshots/clicks/fills, and report back through agent-inbox. The human can switch to the agent pane at any time.

## Variants

- No browser preview: skip the right split.
- Multiple browsers: add tabs to the browser pane with `cmux new-surface`.
- Docs instead of preview: open docs in the browser pane.
- Human-only mode: leave the agent pane as a normal terminal; keep the inbox ready for later dispatch.
