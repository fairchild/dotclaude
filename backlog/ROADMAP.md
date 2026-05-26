# ROADMAP

## Intent

A ~/.claude/ configuration that makes Claude Code both more capable and more personalized to me — compounding with use. The more I work through it, the better it gets at matching how I work and what I care about. Memory, skills, commands, hooks, and agents are mechanisms in a feedback loop from use back into preference and process.

## Principles

1. **Every session should sharpen the next one.** Use leaves traces (chronicle, memory, backlog); reflection turns traces into refinements; refinements show up as better skills, commands, hooks. If a workflow only produces output for me and nothing for the repo, the loop missed.
2. **Adventure.** Try things, throw things away. New ideas get a skill, a command, a prototype. Iteration is how things get good; planning past first encounter is most accurate after first encounter. Half-finished is fine if the experiment taught you something.
3. **Code can be poetry.** Dense token value.
4. **Minimal, stdlib-preferred.** External packages must earn their place by complexity hidden.
5. **Inspectable in place.** `ls`, `cat`, and `git log` should tell the story.
6. **Single source of truth per concept.** Symlinks over duplication; one canonical file, derivative views.
7. **Published as reference, not service.** Cherry-pick what you like; no drop-in clone expectations, no support contract.

## Current Focus

The backlog+roadmap layer has passed its first dogfood loop. The repo used the layer to normalize backlog metadata, route new ideas through `inbox/`, share in-flight state across worktrees, add dependency validation, ship GitHub Issues and Jira backends, and feed observed friction back into the backlog skill itself.

Current focus is now stabilization: keep `inbox/` for triage, keep `todo/` ready-for-agent, and keep each active task tied to an arc unless there is a deliberate exception. The skill-catalog health pass has closed the biggest remaining dogfood gap: no known stale status labels, no known duplicate command wrappers, and no oversized first-load docs in the dotclaude-authored skill catalog. Dogfooding is claimable when this stays true in normal use: backlog status is boring, stale ideas live in `inbox/`, `done/`, or `failed/`, and a fresh worker can choose useful work without rediscovering schema or process questions.

## Priorities

1. **backlog-roadmap-dogfood** — Stabilize the dogfooded backlog loop now that it has real usage behind it: triage through `inbox/`, ready work in `todo/`, dependency validation, arc hygiene, and worker-friendly tasks. Keep this first until those invariants are boring in day-to-day use.
2. **memory-loop-quality** — Chronicle Haiku diagnosis/fix and fallback surfacing have shipped; current work is explaining the remaining SessionEnd fallback ratio before blessing a new extract-bench baseline, then continuing ai-coding-usage memory imports and token parsing pressure work. Strengthens Principle #1 from aspirational to load-bearing.
3. **backlog-pluggable-backends** — GitHub Issues and Jira backends have shipped. Remaining work is remote-backend hardening, especially offline adapter tests, side-effect-safe smoke guidance, and tracker-specific semantics. Dotclaude itself stays on `maildir-shared` (Principles #5, #6); this arc adds optionality for other projects, not a migration here.
4. **prototype-surface** — Vocal loop integration, image-gen protocol, video-gen skill, voxcode-swift, ship command. The adventure arc — keep the surface alive but don't let it crowd #1–#3.
5. **skill-catalog-grooming** — Current health pass is complete. Keep this as a maintenance arc for future catalog drift, stale experimental labels, duplicate command wrappers, or first-load docs that grow past progressive-disclosure size.

## Non-goals

1. **Packaging dotclaude as a drop-in distribution.** Published as reference for cherry-picking — skills are written for inspection and pickup, not for installation with promised compatibility. No backwards-compat shims for forks that lag on schema changes; that's a merge, not a contract.
2. **Real-time multi-user collaboration.** Personal config. Collaborators cherry-pick; they don't co-edit.
3. **Polishing every experiment to production grade.** Experimental skills (`status: experimental`) are first-class — half-finished is allowed by Principle #2, and forcing polish would close down the adventure surface.
