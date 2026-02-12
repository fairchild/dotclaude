# Backlog Skill - Background & Inspiration

This skill captures **explored-but-deferred work** as comprehensive plan files. Unlike full project management tools, it solves one specific problem: preserving research and context so a future session can execute efficiently without re-discovering what we already learned.

## Philosophy

- **Single-purpose**: Capture deferred work, not manage all tasks
- **Comprehensive output**: Each backlog item is a complete plan, not a stub
- **Lifecycle tracking**: pending → in-progress → done, with retrospective fields
- **Categories**: plan, followup, task-list, ideas

## Related Projects

These projects informed the design and represent alternative approaches:

### [Backlog.md](https://github.com/MrLesk/Backlog.md)

Full-featured markdown-native task manager with Kanban visualization. Each task is a separate markdown file (`task-<id> - <title>.md`). Includes CLI, TUI board, web interface, dependencies, and MCP server for AI integration.

**What we borrowed**: Per-item file structure, YAML frontmatter schema, category concept
**What we skipped**: Full Kanban board, dependency graphs, interactive TUI

### [Vibe Kanban](https://github.com/BloopAI/vibe-kanban)

Agent orchestration platform that manages AI coding agents as asynchronous workers. Creates isolated Git worktrees per task for parallel execution without conflicts.

**Interesting pattern**: `/backlog start <item>` could create worktree + branch automatically
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
