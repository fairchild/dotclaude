---
name: retrospective
description: Run a retrospective on a session, PR or milestone — find the mistakes that repeated, fix each at the strongest layer that holds it, and prove each new check catches the real past mistake. Run as /retrospective after a PR merges or is abandoned, after a failed verification, or at the end of an arc.
license: Apache-2.0
disable-model-invocation: true
inspired-by: https://github.com/cursor/plugins
metadata:
  status: experimental
  experimental_reason: "Replaces the session-scoring retro command; no eval yet."
---

# Retrospective

Make the next agent unable to repeat this mistake. Assume it sees only the files it opens, copies
the nearest example and takes the shortest path that compiles.

## 1. Gather

The goal, the path taken and the outcome: the transcript, PRs and their review threads, reverts,
CI failures, corrections from the user.

## 2. Find classes

Group corrections into classes. A class counts once it happened twice, or once if it escaped review.
For each: why it happened and what would have caught it earlier.

## 3. Fix at the strongest layer

1. **Architecture:** one owner per piece of state, one way per task; delete the old way an agent
   would copy.
2. **Types and constraints:** make the bad state unwritable.
3. **A lint rule or check** whose message names the fix.
4. **A test** that fails on the behavior, not the internals.
5. **Docs, prompts, skills** last — only for judgment calls, since nothing fails when skipped.

Prove each new check fails on the real past mistake, recreated in a scratch file. Never loosen a gate.

## 4. Record

Propose the fixes; apply them in a PR once agreed. Lessons with no code home go where the repo keeps them (the
backlog item, a decision record, CLAUDE.md) or in the session's plan file if it ran from one;
cross-session ones go to memory.

**Reply:** each class, its evidence, the layer chosen and why a stronger one didn't work.
