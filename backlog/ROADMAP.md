# ROADMAP

## Intent

A ~/.claude/ configuration that makes Claude Code both more capable and more personalized to me — compounding with use. The more I work through it, the better it gets at matching how I work and what I care about. Memory, skills, commands, hooks, and agents are mechanisms in a single feedback loop from use back into preference and process.

## Principles

1. **Every session should sharpen the next one.** Use leaves traces (chronicle, memory, backlog); reflection turns traces into refinements; refinements show up as better skills, commands, hooks. If a workflow only produces output for me and nothing for the repo, the loop missed.
2. **Adventure.** Try things, throw things away. New ideas get a skill, a command, a prototype. Iteration is how things get good; planning past first encounter is most accurate after first encounter. Half-finished is fine if the experiment taught you something.
3. **Code can be poetry.** Density of value per token in every artifact.
4. **Minimal, stdlib-preferred.** External packages earn their place by clear value.
5. **Inspectable in place.** `ls`, `cat`, and `git log` should tell the story.
6. **Single source of truth per concept.** Symlinks over duplication; one canonical file, derivative views.
7. **Published as reference, not service.** Cherry-pick what you like; no drop-in clone expectations, no support contract.

## Current Focus

The active arc starts with this session: populating ROADMAP.md is the *first encounter* with the new backlog+roadmap layer (#161, #166), and writing it is the trace half of the first loop iteration on the repo itself. The next turns happen as future sessions read this roadmap, reflect against it, and let it shape decisions about which skill plans to take, which to cancel, which to merge.

From bootstrap on, the work is exercising the system. Adding to the backlog as ideas surface; reflecting against the roadmap when items pile up; letting the lens groom the skill catalog (several overlapping cleanup plans are queued in `todo/`) instead of doing ad-hoc passes. The loop closes on the next commit to update the backlog skill itself based on friction surfaced through its use — that's when refinement reaches the mechanism, not just its outputs. Done with this arc: a month of real decisions has passed through, the verbs feel natural, the catalog has been reduced rather than grown, and the backlog skill has been updated at least once from lived friction.

## Priorities

1. **backlog-roadmap-dogfood** — Exercise the new maildir backlog and ROADMAP through real decisions this month. Lets the lens surface what matters and what's noise; everything downstream depends on a working reflection loop.
2. **skill-catalog-grooming** — Several overlapping cleanup plans (skill-coherence, skill-context-optimization, dotclaude-runtime-rationalization) are queued in `todo/`. They should merge or be sequenced under the lens of #1, not done ad-hoc.
3. **memory-loop-quality** — Chronicle auto-extractor quality, ai-coding-usage memory imports, token-jsonl pressure. Strengthens Principle #1 from aspirational to load-bearing.
4. **prototype-surface** — Vocal tuning console, image-gen protocol, video-gen skill, voxcode-swift, ship command. The adventure arc — keep the surface alive but don't let it crowd #1–#3.

## Non-goals

1. **Packaging dotclaude as a drop-in distribution.** Published as reference for cherry-picking — skills are written for inspection and pickup, not for installation with promised compatibility. No backwards-compat shims for forks that lag on schema changes; that's a merge, not a contract we owe.
2. **Real-time multi-user collaboration.** Personal config. Collaborators cherry-pick; they don't co-edit.
3. **Polishing every experiment to production grade.** Experimental skills (`status: experimental`) are first-class — half-finished is allowed by Principle #2, and forcing polish would close down the adventure surface.
