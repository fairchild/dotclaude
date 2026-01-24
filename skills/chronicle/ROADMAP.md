# Chronicle Roadmap

Chronicle evolves from a passive memory system to an active continuity assistant.

## Vision

```
Today                    MVP                     Future
─────────────────────────────────────────────────────────────
Memory blocks    →    /catchup command    →    Ambient intelligence
(you query)          (you ask, it briefs)     (it notices & suggests)
```

**Core insight**: Sessions are ephemeral but work is continuous. Chronicle bridges that gap.

## Current State (v1)

| Capability | Status |
|------------|--------|
| Memory blocks | ✅ Auto-extracted at session end |
| Dashboard | ✅ Newspaper-style UI with worktree sidebar |
| Summaries | ✅ AI-generated (Sonnet daily, Opus weekly) |
| Digests | ✅ Markdown publish (daily/weekly/monthly) |
| Search | ✅ Full-text across blocks |
| Insights | ✅ Agent-based code exploration |
| Curator | ✅ Interactive memory organization |

## Roadmap

### Phase 1: Catchup ✅

**Goal**: Instant context restoration when returning to a project.

| Feature | Status |
|---------|--------|
| `/chronicle catchup` command | ✅ Implemented |
| Project/worktree detection | ✅ Working |
| Pending aggregation with age | ✅ Working |
| Pattern detection | ✅ Basic |

**Metrics**: <5 seconds to understand last session's state.

---

### Phase 2: Stale Detection

**Goal**: Never forget pending work.

| Feature | Status |
|---------|--------|
| Pending item age tracking | 🔲 Planned |
| Staleness alerts (>14 days) | 🔲 Planned |
| Resolution detection | 🔲 Planned |
| Git commit → resolve pending | 🔲 Planned |

**Resolution signals**:
- Git commit message matches pending item → auto-resolve
- Accomplished item matches pending → link & resolve
- Explicit `/chronicle resolve <item>` command

**Metrics**: Zero pending items older than 14 days without conscious decision.

---

### Phase 3: Smart Suggestions

**Goal**: Relevant context surfaces automatically.

| Feature | Status |
|---------|--------|
| Session-start hook injection | 🔲 Planned |
| "You worked on this before" hints | 🔲 Planned |
| Semantic similarity matching | 🔲 Planned |
| Proactive briefing for returning users | 🔲 Planned |

**Trigger patterns**:
- Time since last session > 24h → auto-brief
- File being edited matches previous session → surface context
- Error message matches past debugging session → recall solution

**Metrics**: Context appears without asking 50%+ of the time.

---

### Phase 4: Cross-Project Intelligence

**Goal**: Knowledge transfers between projects.

| Feature | Status |
|---------|--------|
| Pattern recognition across projects | 🔲 Exploratory |
| "Similar problem in project X" suggestions | 🔲 Exploratory |
| Tech debt aggregation | 🔲 Exploratory |
| Reusable solution linking | 🔲 Exploratory |

**Examples**:
- "You solved a similar auth issue in project-a, here's what worked"
- "This pattern appears in 3 projects, consider extracting a library"
- "Your TODOs about testing are accumulating across projects"

**Metrics**: Reuse insights from one project in another.

---

## Non-Goals

| Not doing | Why |
|-----------|-----|
| Replace git history | Chronicle is semantic, git is structural |
| Auto-complete work | Chronicle informs, doesn't act |
| Perfect recall | Good-enough context beats exhaustive history |
| Require manual curation | Auto-extraction should be sufficient for most use |

## Design Principles

1. **Explicit > Magic** - `/catchup` before ambient suggestions
2. **Project-scoped by default** - Most context is local
3. **Centralized storage** - YOUR memory, not per-worktree
4. **Graceful degradation** - Works without optional integrations
5. **YAGNI** - Ship simple, evolve based on real usage

## File Structure

```
~/.claude/chronicle/
├── blocks/          # Session memory blocks (JSON)
├── summaries/       # AI-generated summaries
│   ├── global/      # Cross-project summaries
│   └── repos/       # Per-repo summaries
├── digests/         # Markdown digests
└── insights/        # Agent-generated insights
```

## Contributing

See `backlog/` directory in the dotclaude repo for planned features and ideas.
