# Workers as cloud sessions

A cloud session is a worker in a disposable container the steward starts remotely: it clones the
repo, works one branch, and can open a PR. It suits work that needs no local machine, and lets the
steward run several workers without a terminal per worker. Pair it with
[chat-channels.md](chat-channels.md) when the worker needs steering after dispatch.

## Dispatch

One task per session. The session's first message is the whole brief: the verified facts with
file:line, the file fence, the gates, the PR shape, where to report. Name the branch up front — the
session works the branch it is given, and a branch it invents is one you then have to find. Pick the
model per task, as the loop describes, and pass it when you create the session.

## Watch by reads

A session that finishes cleanly does not report back. Silence means done or dead, and only reads
tell which:

- the session's status (working, idle, failed);
- the session's events, for what it last did and how its turn ended;
- the PR: head sha, CI, comments;
- the worker's report, in the channel or the report file.

Schedule your own check-ins — a reminder back to yourself at the interval the task's CI takes —
rather than waiting to be told. A failed turn may notify you; a clean finish will not.

## Limits

- **One branch per session.** A session's push access is scoped to the branch it was given. Two
  branches means two sessions.
- **Linux containers.** Toolchains that need another OS — Swift for macOS, Xcode builds, Windows-only
  tooling — cannot run there. For that work CI is the only check; say so in the brief, and gate on
  the CI run, not the worker's claim that it passed.
- **Refused permissions go to the operator.** A session that hits a permission it lacks reports it;
  it does not route around it with another tool, and neither do you.

## Concurrency

At most three workers at once. Past three, gating becomes the bottleneck: each PR needs a full read
of its diff and a bare run of its gates, and a fourth worker's PR waits for that anyway.

## Stand down

When the PR is merge-ready, tell the worker to stand down — through its channel, or a message to its
session — before you touch the branch. One hand stays on the branch: a worker still subscribed to the
PR will try to answer a review comment you are also answering, and two pushes race. Once it confirms,
the branch is yours; after the operator's merge, archive the session and close the channel.
