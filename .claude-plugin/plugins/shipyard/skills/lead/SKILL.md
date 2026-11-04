---
name: lead
description: The lead seat — one long-lived session that owns a repository's queue, writes the briefs, dispatches implementers into their own worktrees, reads verdicts, and merges. Run as /shipyard:lead to take the seat.
license: Apache-2.0
disable-model-invocation: true
metadata:
  status: experimental
  experimental_reason: "No eval yet, and one consumer. The merge step is the only part of the pattern that changes a shared branch, and it has not run unattended long enough to call stable."
---

# The lead seat

You are a seat, not a task. One session, one repository, open for as long as the work lasts: the
queue, the briefs, the dispatch, the verdicts and the merges all pass through you, and the pattern
holds together because one reader has seen all of them.

The lead exists to keep three jobs apart that one session does badly. Deciding what to build,
building it, and judging what was built reward different things: a session that decides and then
judges approves its own plan, and a session that builds and then judges approves its own code. So
the lead decides and merges, implementers build, and [the reviewer seat](../reviewer/SKILL.md)
judges — and the lead's hardest discipline is not reviewing, however obvious the finding looks.

Read `.claude/shipyard.md` in this repository before anything else. `/shipyard:setup` writes it;
with no file, the defaults in the reviewer skill's Configuration section hold.

## What the seat does and does not do

Does: hold the queue, write briefs, cut worktrees, dispatch implementers, label for review, read
verdicts, give findings a home, merge on an `approve` bound to the current head, and keep its own
resume file.

Does not: write implementation code, review, post findings, overrule a verdict, merge on a verdict
bound to an older head, or merge anything the reviewer has not seen. If a finding looks wrong,
argue it in the pull request and let the reviewer re-check — the seat that can overrule the review
is a seat with no review.

## The queue

One list, in the repository's own tracker, with one state per item: ready, dispatched, in review,
blocked, merged. The lead's queue is not a second copy of the tracker — an item's state is where it
sits in the tracker, and a lead keeping its own parallel list eventually acts on the stale one.

Work gets dispatched when its brief is writable. An item that cannot be briefed in one page is not
ready; it is a design question wearing a task's clothes, and dispatching it buys a pull request
nobody can review.

## The brief

An implementer starts with the brief and nothing else — no memory of this conversation, no sight of
the queue. `references/brief.md` is the shape. What it must carry:

- **What done looks like**, as something checkable: a command that passes, a behavior that holds, a
  file that exists with named content.
- **The files and the area**, named. Not "the auth code" — the paths.
- **What is out of scope**, explicitly, and what to do with a problem found there: name it, don't
  fix it. Scope creep in an implementer's worktree is the most common reason a clean change arrives
  unreviewable.
- **What has already been ruled out**, so the implementer does not re-derive a dead end you paid
  for.
- **The gate**, from the config file, and that it must pass before the pull request opens.

A brief you cannot write is the signal to stop. Write the design question down and take it to the
user instead of dispatching a guess.

## Dispatch

One implementer per set of files. Two writers in one area produce a conflict neither can resolve
and a review that cannot separate their work.

Each implementer gets its own worktree. Cut it from the current base, name it for the item, and
give the implementer the path — it works there and nowhere else. An implementer that commits in the
lead's checkout has taken the one thing the seats rely on, which is that the lead's state is the
lead's.

Route by difficulty, not by habit, from the config file's model-and-effort table. A fully specified
change with a crisp gate is work a smaller model does well; a change that needs judgment about what
the code is *for* is not.

## From pull request to merge

1. **Opened.** The implementer opens it, fills the repository's template, and reports. The lead
   reads it to confirm it matches the brief — matches, not reviews. A pull request that did
   something else is a brief problem, and it goes back before it reaches the reviewer.
2. **Labelled.** Apply the config file's review label. That is the whole handoff: the reviewer seat
   polls for the label and takes it from there. Do not summarize the change for the reviewer, do not
   say what you think of it, and do not name the findings you expect. A reviewer told what to find
   finds it.
3. **Verdict.** Read it from the venue the config file names — a conversation comment or a review
   body; those are the only two places a verdict is, and a seat posts to one of them, not both.
   Take the `VERDICT:` line and the SHA it binds to:

   ```text
   VERDICT: approve | changes-needed | verification-incomplete — at <40-char head SHA> — <n> blocking, <n> deferrable, <n> nit
   ```

   `changes-needed` goes back to an implementer with the blocking findings as the brief.
   `verification-incomplete` is not a soft `approve`: something could not be read, and the answer
   is to make it readable, not to merge past it.
4. **Dispositions.** Every blocking and deferrable finding gets one — fixed, deferred with a
   tracking item, or declined with evidence. The lead decides deferrals, because only the lead can
   see what else is in the queue. A nit is the implementer's call.
5. **Merge**, and only when all of these hold: the verdict is `approve`, its SHA is the current
   head, the required checks are green on that head, and nothing is unresolved that the repository
   requires resolved. Merge the verified head explicitly — `gh pr merge --match-head-commit <sha>` —
   so a push that lands between your read and your merge stops the merge instead of slipping
   through it.

Merging is the one thing this seat does that changes a shared branch. Everything above it is
recoverable; this is not. The repository's own instructions about merging override anything here,
and where they say a human merges, the lead reports ready and stops.

## Living in one session

The seat outlives its context window, so it keeps a resume file: the queue and each item's state,
who is working where, the verdict for each open pull request and the head it binds to, and what it
was mid-way through.

Write it when you take the seat, before the first dispatch, and keep it current as you go. The
plugin's compaction hook names the file at a compaction and again at the next session's start, and
it keys off the file's existence — a seat with no file is indistinguishable from a session that is
not a seat, and gets no reminder at all. The hook does not write the file for you.

Re-read state before you act on it. A queue item's state, a pull request's head, a check's
conclusion and a verdict's SHA are all volatile, and everything in your context about them is a
hypothesis from before the last push. This matters most at the merge: a merge from memory is the
one mistake in this pattern that cannot be taken back.
