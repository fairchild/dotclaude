# Backlog Skill — Background & Inspiration

A maildir-style task tracker. Each task is a markdown file; its location (`todo/`, `doing/`, `done/`) is its state. Claiming is `git mv`, which doubles as the lock — two agents racing the same task collide at merge instead of silently double-working.

## Philosophy

- **Location is status.** No status field to keep in sync, no parser to write. `ls doing/` is in-flight work.
- **Comprehensive content.** Each task carries enough context for a fresh session to execute without the original conversation.
- **Append-only log.** Frontmatter and description are author-set at creation; the bullet log below the `---` divider grows by `echo >> file && git commit`. The log *is* the state — no separate mutable claim fields to drift out of sync.
- **Single writer.** Between take and complete, only the claiming agent appends. The maildir mv is the actual lock; the `started` block is documentation.
- **Graph-native deps.** `dependencies:` is a map of slugs; each task declares its own preconditions. Parallel by default; ordering encoded in the chain itself, not in any single task.
- **No scripts.** Every verb is a small bash recipe the agent runs inline (`git mv` + heredoc append). The skill *is* the spec; no codepath drift between docs and behaviour.

## Minimal snippets

Two prompts designed to drop straight into a Claude Code session in any repo, with no prep. The agent figures out missing directories, exact bash, commit hygiene.

### Add a task (paste, fill in, send)

```
Add tasks to our backlog by adding a markdown file describing the task in `backlog/todo/{slug}.md` ending with a trailing `---` with blank lines around it.
```

### Work the backlog (paste once, then drive)

```
You're a worker on a maildir-style backlog at
`backlog/{todo,doing,done,failed}/`. Each task is a markdown file;
its directory is its state. Below a `---` divider, the file holds an
append-only bullet log of timestamped events.

Log line format: `- {ISO UTC} {kind} key=value ... [| free prose]`.
One line per event; long-form detail goes in the commit body.

Six verbs — each is an optional `git mv` + an `echo` append + a `git
commit` (create any missing directory as needed):

- **take**: `git mv backlog/todo/X.md backlog/doing/X.md`; append
  `- $ts started claimer=YOU branch=BRANCH`. The mv is your lock.
- **progress**: append `- $ts progress | what just got done` to the
  file in `doing/`. Write semantically so a future claimer can skip
  already-done activities.
- **complete**: `git mv` to `done/`; append
  `- $ts completed PR=URL_IF_ANY`.
- **recover**: pick up a `doing/` task whose claim has exceeded its
  timeout (declared `timeout:` in frontmatter or 7d default). In
  place — no `git mv`. Append `- $ts recovered claimer=YOU
  branch=BRANCH`. Verify staleness first; refuse if the existing
  claim is still active. Then read prior progress notes to skip
  already-done work.
- **release**: give your claim back. `git mv` to `todo/`; append
  `- $ts released | reason`.
- **fail**: dead-letter after retries exhausted. `git mv` to
  `backlog/failed/`; append `- $ts failed | reason`.

Every verb commits after appending. `cat` and `git log --follow` both
tell the file's story; they stay synchronized because every action is
one bullet plus one commit.

Now tell me what to do (e.g. "take the next task", "what's in
doing/?", "complete the auth-migration task with PR https://...").
```

## Related Projects

These projects informed the design and represent alternative approaches:

### [Backlog.md](https://github.com/MrLesk/Backlog.md)

Full-featured markdown-native task manager with Kanban visualization. Each task is a separate markdown file (`task-<id> - <title>.md`). Includes CLI, TUI board, web interface, dependencies, and MCP server for AI integration.

**What we borrowed**: Per-item file structure and category concept
**What we skipped**: Full Kanban board, dependency graphs, interactive TUI

### [Vibe Kanban](https://github.com/BloopAI/vibe-kanban)

Agent orchestration platform that manages AI coding agents as asynchronous workers. Creates isolated Git worktrees per task for parallel execution without conflicts.

**Interesting pattern**: a `take` recipe could create a worktree + branch automatically as part of the claim
**What we skipped**: Full orchestration layer, Rust complexity

### [todo.ai](https://github.com/fxstein/todo.ai)

Minimal approach: single TODO.md file, AI-first commands, zero dependencies. Optimized for persistence over features.

**Philosophy alignment**: Minimal, Git-native, AI-aware
**Difference**: We prefer comprehensive plans over terse task lists

### [AI Dev Tasks](https://github.com/snarktank/ai-dev-tasks)

PRD-driven workflow: write a Product Requirements Document, AI breaks it into granular tasks, then implements each.

**Pattern worth exploring**: High-level goal → decomposed backlog items

## HN Discussion Insights

From [the Backlog.md discussion](https://news.ycombinator.com/item?id=44483530) (254 points):

1. **Task sizing matters** - "PR-sized tasks" is vague. Smaller atomic tasks yield higher AI success rates (95%+ reported with structured CLI)

2. **The iteration loop** - High-level spec → AI generates tasks → AI implements → human reviews. The author reports 50% success with just README + CLAUDE.md, 95%+ with CLI integration

3. **Agent instruction files** (CLAUDE.md, AGENTS.md, GEMINI.md) are table stakes for AI collaboration

4. **Criticism**: Requests for end-to-end video demos; subjective task sizing guidance

## Future Possibilities

Ideas explored but not yet implemented:

- **MCP server** exposing `list_backlog`, `get_item`, `update_status` tools
- **"Pick next" intelligence** recommending what to work on
- **Scoring/retro workflow** prompting for retrospective when completing items
- **Branch auto-linking** detecting when working on a backlog item
