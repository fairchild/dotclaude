# Chronicle Roadmap

Chronicle evolves from a passive memory system to an active continuity assistant.

## Vision

```
Today                    MVP                     Future
─────────────────────────────────────────────────────────────
Memory blocks    →    /catchup command    →    Ambient intelligence
(you query)          (you ask, it briefs)     (it notices & suggests)
```

**Core insight**: sessions are ephemeral but work is continuous.

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

### Phase 2: Stale Detection ✅

**Goal**: Never forget pending work.

| Feature | Status |
|---------|--------|
| Pending item age tracking | ✅ `getPendingWithAge()` in queries.ts |
| Staleness alerts (>14 days) | ✅ `/chronicle stale` + catchup warnings |
| Resolution detection | ✅ Auto-detect via LLM matching |
| Explicit resolution | ✅ `/chronicle resolve "text"` command |
| Git commit → resolve pending | 🔲 Future enhancement |

**Resolution signals**:
- Accomplished item matches pending → auto-resolve on `/chronicle catchup`
- Explicit `/chronicle resolve <item>` command
- (Future) Git commit message matches pending item

**Storage**: Resolutions stored in `~/.claude/chronicle/resolved.json` overlay file (blocks stay immutable).  <!-- portability: allow -->

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
~/.claude/chronicle/  # portability: allow
├── blocks/          # Session memory blocks (JSON)
├── resolved.json    # Resolution overlay (pending→accomplished links)
├── summaries/       # AI-generated summaries
│   ├── global/      # Cross-project summaries
│   └── repos/       # Per-repo summaries
├── digests/         # Markdown digests
└── insights/        # Agent-generated insights
```

## Contributing

See `backlog/` directory in the dotclaude repo for planned features and ideas.
