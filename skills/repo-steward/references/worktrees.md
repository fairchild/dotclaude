# Plain git worktrees

The fallback when the operator hasn't named a workspace tool: any terminal, driven by `git worktree`
directly.

## Create a checkout per issue

```bash
git fetch origin
git worktree add -b workspace/<issue>-<slug> ../worktrees/<repo>/<issue>-<slug> origin/main
```

One worktree per issue, always branched from the current `origin/main` at creation time, not from
whatever the base checkout happens to have locally.

## Start the worker

Open a terminal or tmux pane in that worktree's directory and start the agent there directly — there
is no app-managed tile to send into, so the terminal you open is the channel both for starting the
worker and for reading its output. A brief file at a durable path in the worktree, and a report file
the worker writes back to when it's done, are the channel for anything the terminal scrollback won't
preserve across a compaction or a pane getting closed.

## Gate and tear down

Gate exactly as the loop describes: read the diff, `git fetch origin` and rebase onto the current
`origin/main`, run every gate bare, read mergeability after the last push. After the merge:

```bash
git worktree remove ../worktrees/<repo>/<issue>-<slug>
git branch -d workspace/<issue>-<slug>
git push origin --delete workspace/<issue>-<slug>   # skip if the host already deletes merged branches
```
