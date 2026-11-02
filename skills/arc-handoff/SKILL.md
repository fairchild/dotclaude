---
name: arc-handoff
description: Hand off an arc of work on its tracking issue, or pick up an arc another session left. Use before a session ends or compacts with work in flight, when an arc's merge order, blockers or running processes change, or when starting on an arc with open PRs.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: "Generalised from a handoff skill in the user's other repositories; no eval yet."
---

# Arc handoff

A handoff is a new comment on the arc's tracking issue telling the next session where it stands.
Memory holds durable lessons; the handoff holds in-flight state. Never edit an earlier handoff —
readers take the newest.

## Write

1. Gather live state, not memory: each open PR's state, head, checks and latest review (read the
   review itself — `reviewDecision` misses a `COMMENT` with a blocker); running watchers, VMs or
   tmux sessions; who or what blocks each next step.
2. Push anything that exists only on this machine — commits, stashes, edits — as a draft PR.
3. Post, stamped with `date -u +%FT%TZ` in the same command:

```markdown
- <ISO-8601 UTC> handoff | <one-line state>

**Goal:** what the arc is for, one sentence.
**PRs:** #N — state, head <sha>, checks, review; in merge order.
**Running:** processes and how to stop them, or none.
**Blocked on:** who or what, per step, or none.
**Next:** the first action for whoever picks this up.
**Not pushed:** none
```

The handoff isn't done until **Not pushed** says `none`. Write one before any compaction while an
arc is in flight.

## Resume

1. Read the newest comment on the tracking issue starting `- <time> handoff |`.
2. Re-check every fact that can change — PR state, checks, heads, processes — before relying on it.
3. Claim the work the way the repo's tracker says.
