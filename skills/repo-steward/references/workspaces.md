# WorkSpaces.app

Mechanics for running the repo-steward loop through WorkSpaces.app: tiles over tmux, one workspace
per issue, a sidebar row the operator can click into. Use this reference once a workspace tool is
confirmed to be WorkSpaces.app; it does not apply to a plain terminal or worktree setup.

## Preflight (once per session)

```bash
workspaces automation health                  # experiments must include automationAPI,automationOperator
workspaces automation workspace list --json   # repoIDs and workspaceIDs
workspaces automation window list --json      # windowIDs, needed later for the snapshot command
workspaces ws list                            # app-visible vs CLI-local workspaces
find ~ -name ws-op.py 2>/dev/null             # locate the app's own operator script
```

Confirm that `find` returns exactly one path before trusting it — the same hazard as killing by
pattern instead of PID: a stray second match (an old install, another clone of the app's source) would
get executed for every automation call below. Set `export WSOP=<the one confirmed path>` by hand; if
`find` returns nothing, the app's own docs name where it ships the script. An operator credential file
next to the automation socket enables operator scope; its absence means that scope is off and needs
enabling before automation calls will work. Never launch a second app instance — a second instance and
this session's automation calls will collide over the same socket.

## Create a workspace per issue

Create through the automation route, not the bare CLI create command: the route accepts `fromRef` and
`select:false`, so the workspace branches from `origin/main` and doesn't steal the operator's tile
selection. The bare CLI form branches from the base clone's local HEAD instead, which is not what a
fresh-from-main worker checkout needs.

```bash
uv run --script $WSOP POST /v1/workspace/create \
  '{"repoID":"<repoID>","name":"claude-<issue>-<slug>","providerID":"local","select":false,"fromRef":"origin/main"}'
```

The response carries the workspace ID, its checkout path, and the ID of the surface (tile) already
attached to it. Prefix workspace names with the coordinator's own tag (`claude-<issue>-<slug>`) so
two coordinators running concurrently never collide on a name.

## Launch a worker into it

Creating via the route already attaches a terminal — a tmux session under the app's own socket. The
plain "launch" command refuses on an attached tile because the session name is already taken; send
into the existing session instead of trying to launch a new one. The `<handle>` the commands below
take is that tmux session's name, not the surface ID the create response returned — read it back with
`workspaces ws list` once the workspace exists; the new workspace's row names its handle.

```bash
workspaces ws read <handle> --lines 5           # confirm a bare shell prompt
workspaces ws send <handle> --text "<agent start command>" --enter
workspaces ws read <handle> --lines 12          # confirm the agent is live
workspaces ws send <handle> --text "Read <brief path> and carry it out. Do not ask questions; decide and record deviations." --enter
workspaces ws read <handle> --lines 12          # confirm the brief is being read
```

`ws send` is the cross-tile write, usable from outside the tile it targets; a command run from inside
the caller's own tile only writes there. `ws launch <repo>/<name> --cmd ...` is for a workspace with
no terminal already attached.

## Monitor

Read a tile's text directly, or use a typed wait for a prompt to return or for the tile's text to
match a pattern (a PR number, a `status: done` marker). Wait outcomes are typed — satisfied,
timed out, not applicable — never a bare boolean, so branch on the type rather than truthiness. Set
the row note at each stage of the loop (queued, running, gated) so the sidebar stays current without
asking the operator to read a tile. A window snapshot gives a composited, focus-safe screenshot for
pixel evidence.

```bash
workspaces ws read <handle|repo/name> --lines 40
workspaces automation wait --for prompt_ready --surface-id <surfaceID> --timeout-ms 5000 --json
workspaces automation wait --for surface_text_matches --surface-id <surfaceID> \
  --pattern 'PR #[0-9]+|status: (done|blocked)' --timeout-ms 60000 --json
workspaces automation workspace note <workspaceID> --text "gate: tests green, flipping ready"
uv run --script $WSOP POST /v1/window/snapshot '{"windowID":"<windowID>"}' --png out.png
```

`<windowID>` comes from the `workspaces automation window list --json` run in preflight; re-run it if
the workspace's window wasn't open yet at that point.

Durable state — git, PRs, report files — survives an app restart or a coordinator compaction; a
coordinator's own memory of what's running in a tile does not. Resume from those, not from what you
last remember sending.

Also run a second, standing monitor on `origin/main` itself: it can move while a worker's gate is
still running, and the mergeability read has to happen after that push, not before it.

## Gate, ship, tear down

Read the full diff in the worker's checkout; `git fetch origin` and rebase the branch onto the
current `origin/main` at review time, not just at spawn — the workspace's own `fromRef` fetch is
already stale by then if the worker ran for any real time. The rebase can surface a transient
`index.lock` from the worker's own shell hooks mid-rebase, which clears on retry. Re-run every gate
bare in the worktree and read the output directly; don't trust a worker's own claim that a gate
passed, since a worker can misread its own tool output or write a test that passes for the wrong
reason. Post the gate result as a short PR comment, not folded into the body — a gate section inside
the body is what makes bodies long. Then:

```bash
# exit the agent first (send "/exit"), then end the tmux session, then archive
tmux -L workspaces kill-session -t <handle>
workspaces automation workspace archive <workspaceID> --teardown --json
```

Teardown refuses while any process — the bare shell included — is still alive in the tile, because
the app's own close-confirmation dialog can't be answered headlessly; ending the tmux session first
clears that. If a fleet-wide monitor is also watching for the tile going quiet, stop that monitor
before sending `/exit` — otherwise the intentional exit reads as the failure the monitor was built to
catch. The archived workspace keeps its branch and worktree under the app's own archive location, so
leave the base repo's own worktree list and local branches alone; the app owns that lifecycle, and a
merged remote branch is already gone once the operator merges.
