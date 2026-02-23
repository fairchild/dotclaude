---
title: "Team-Memory Cascade Bug Retrospective"
date: 2026-02-15
description: Recursive SessionEnd triggering caused repeated sleep-pipeline runs and high token burn. Short retrospective on impact, root cause, and fix.
tags:
  - claude-code
  - memory
  - debugging
---

# Team-Memory Cascade Bug Retrospective

![A data ouroboros — a glowing serpent of code eating its own tail in an infinite loop, with stats: 233 runs, 24M tokens burned, 0 new information](images/cascade-bug.jpg)

## Summary

A SessionEnd hook in `team-memory` recursively triggered the sleep pipeline. The child Claude process inherited `AI_MEMORY_PERSONA`, so each automated sleep session looked like a new eligible session and triggered another run.

## Impact

- ~233 cascade runs for Smoky and 8 for Scout over ~2 days
- ~24M tokens consumed with little or no new information
- Memory artifacts polluted by repetitive self-processing
- Relationship/session metadata drifted from real human activity

## Root Cause

SessionEnd hook logic checked `AI_MEMORY_PERSONA` and launched sleep compute. Because environment variables were inherited by child sessions, the same condition remained true at child session end, causing repeated re-entry.

## Fix

Implemented defense in depth:

1. **Environment isolation**
   - Capture persona, then unset `AI_MEMORY_PERSONA` when launching sleep compute.
2. **Automated-transcript guardrails**
   - `sleep-extract` and `sleep-reflect` detect automated "Run sleep-time compute" sessions and skip processing.
3. **Cost containment**
   - Run orchestrator and subagents on Haiku to reduce cost if recurrence happens.

## Cleanup Completed

- Deleted 242 junk recall files
- Compressed relationship logs to remove cascade noise
- Corrected inflated session counters
- Removed stale/pruned artifacts
- Consolidated shared knowledge learned redundantly by personas

## Current Status

- Cascade reproduction no longer observed after fixes
- Sleep pipeline runs once per real session
- Memory system returns to intended behavior: capture useful cross-session context without recursive self-triggering

## Follow-up

- Keep regression checks for SessionEnd contract
- Monitor recall/session volume for recurrence signals
- Continue context-cost optimization work in parallel
