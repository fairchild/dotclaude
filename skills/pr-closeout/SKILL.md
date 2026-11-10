---
name: pr-closeout
description: Own a pull request you opened from draft to ready to merge — CI green, every review finding given a disposition, fixed threads resolved, state verified on the current head. Use after opening or pushing to a PR, when review comments arrive on your PR, and before reporting a PR ready.
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
Open as a draft, and keep it a draft until an independent review has been worked through on the
head: another model's pass, or a fresh session running `/review-pr <PR url>`, never the author
(`review-pr`, Rounds). A review of a draft gives its verdict as a comment, not an approval; where
the repo needs an approval, it comes from a pass on the head after the PR is marked ready.

## Follow through

Watch every check, not only required ones, to completion; a passing check sends no notification,
so poll until done. Read conversation comments, reviews, inline threads, and check output and annotations —
a bot can leave findings only there. From the PR's repo, `bun <this skill>/scripts/pr-status.ts [PR]`
gathers threads, checks and comment IDs in one read (`--help`). Fix failures at the cause; rerun only on evidence of a
transient failure. Count unresolved threads even when outdated.

## Dispositions

Read all findings before touching code; they interact. Every blocking or deferrable finding gets a
disposition, as a reply in its thread:

- **Fixed now:** the change, the pushed commit, the verification and its result.
- **Follow-up:** why it belongs elsewhere, and the issue that tracks it.
- **Declined:** why, with code or test evidence.

Give each round its dispositions before asking for the next: a re-check of the delta when the same
reviewer carries its findings, a fresh round otherwise (`review-pr`, Re-checks and Rounds). A
review with no threads, such as a local pass by another model, gets one PR comment per round:

```text
Round 2 at <head sha>: 1 fixed in <sha>; 2 follow-up #<n>; 3 declined — <reason>
```

When the same class of finding comes back, change the shape that produces it rather than patching
the new instance.

Resolve a thread once its fix is pushed; leave Follow-up and Declined threads open with the reply,
unless the repo requires every conversation resolved before merge — then resolve them after the
reply.
Never bulk-resolve. A nit needs no push: fix it if small and agreed, otherwise reply in a line.
Findings with no thread (a summary, check output) get a conversation reply naming each. Resolve
base conflicts the way the repo merges.

Post replies from a file (`gh api repos/<o>/<r>/pulls/<n>/comments -F in_reply_to=<comment id> -F body=@file`;
the numeric ID, not the thread node ID), then resolve with GraphQL `resolveReviewThread` or MCP
`resolve_review_thread`.

## Ready

Make the final body edit while still a draft — an edit can restart review bots. Mark ready once
the independent review is worked through on the head, every check is green there, and every
finding has a disposition. After that, every push repeats the follow-through.

Before reporting, capture head and base SHAs, read checks, reviews and threads, then re-read the
PR. If either SHA moved, start over. Report one of:

- **ready to merge:** green checks on that head, required approvals, and no unresolved threads
  but Follow-up and Declined ones that carry their reply.
- **ready for review:** only a human's approval and merge remain. Out of draft.
- **blocked:** the last verified head, what remains, why, the next action and its owner.

Unavailable state is unknown, not success. Claim continued watching only when a watcher exists.

## Merge

Don't merge unless the repo's instructions or the user say to. When you merge, merge only the
verified head (`gh pr merge --match-head-commit <sha>`) and watch what the merge starts.
