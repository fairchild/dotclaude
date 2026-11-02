---
name: pr-closeout
description: Own a pull request you opened from draft to ready to merge — CI green, every review finding given a disposition, threads resolved, state verified on the current head. Use after opening or pushing to a PR, when review comments arrive on your PR, and before reporting a PR ready.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: "Replaces the respond-to-pr-review command with closeout practice from the user's other repositories; no eval yet."
---

# PR closeout

The agent that opens or updates a PR owns it until it merges or is handed off. The repository's
own instructions override anything here, especially on merging.

## Open

Fill the repo's PR template. Put evidence in the body — screenshots for UI, results for behavior —
labelled with the commit and environment it came from. A green build is not a UI or runtime check.
Open as a draft.

## Follow through

Watch every check, not only required ones, to completion; a green result often doesn't wake a
session. Read conversation comments, reviews, inline threads, and check output and annotations —
a bot can leave findings only there. `bun scripts/pr-status.ts [PR]` (relative to this skill)
gathers threads and checks in one read. Fix failures at the cause; rerun only on evidence of a
transient failure. Count unresolved threads even when outdated.

## Dispositions

Every blocking or deferrable finding gets one, as a reply in its thread:

- **Fixed:** the change, the pushed commit, the verification and its result.
- **Deferred:** why it belongs elsewhere and where it is tracked.
- **Declined:** why, with code or test evidence. Leave the thread open for the reviewer.

Then resolve the thread. Never bulk-resolve to clear a gate. A nit needs no reply or push: fix it
if small and agreed, otherwise resolve it. Findings with no thread (a summary, check output) get a
conversation reply naming each.

Post replies from a file (`gh api repos/<o>/<r>/pulls/<n>/comments -F in_reply_to=<id> -F body=@file`),
then resolve with GraphQL `resolveReviewThread` or MCP `resolve_review_thread`.

## Ready

Make the final body edit while still a draft — an edit can restart review bots. Mark ready once
every check is green on the head and every finding has a disposition. After that, every push
repeats the follow-through.

Before reporting, capture head and base SHAs, read checks, reviews and threads, then re-read the
PR. If either SHA moved, start over. Report one of:

- **ready to merge:** green checks on that head, required approvals, no unresolved threads.
- **ready for review:** only a human's approval and merge remain. Out of draft.
- **blocked:** the last verified head, what remains, why, the next action and its owner.

Unavailable state is unknown, not success. Claim continued watching only when a watcher exists.

## Merge

Don't merge unless the repo's instructions or the user say to. Where merging is the default, still
leave it to the user when merging could cause hard-to-undo side effects, cost money, weaken
security or gates, make something private public, or decide product scope. When you merge, merge
only the verified head (`gh pr merge --match-head-commit <sha>`) and watch what the merge starts.
