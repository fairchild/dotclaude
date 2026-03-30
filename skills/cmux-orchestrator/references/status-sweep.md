# Status Sweep

A reconnaissance pass across all open workspaces to summarize what's in flight. Triggered by **"what do I have in flight"**, **"status sweep"**, or **"summarize my sessions"**.

## Steps

1. Get the full hierarchy — workspace names, surface types, and URLs:
   ```bash
   cmux tree --all
   ```
2. Read each workspace's screen to understand what agents/processes are doing:
   ```bash
   for ws in $(cmux list-workspaces 2>/dev/null | awk '{print $1}'); do
     echo "=== $ws ==="
     cmux read-screen --workspace "$ws" --lines 30
   done
   ```
   For workspaces with no recent output, try `--scrollback` to see earlier activity.
3. Synthesize a per-workspace summary.

## What to report

- **Workspace name and branch** (if visible)
- **Agent state**: working, idle/waiting for input, completed, errored
- **Open browser tabs**: PR numbers, dashboards, docs — these reveal intent
- **Actionable items**: sessions waiting for a decision, PRs ready for next steps

Keep it scannable — one short paragraph per workspace, lead with the most important.
