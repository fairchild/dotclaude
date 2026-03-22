# Roadmap

## Direction

**Current focus**: Agent orchestration patterns and developer workflow tooling

### Active
- cmux-orchestrator conventions (workshop, ops deck) — live testing and refinement
- prek pre-commit standardization (PR #130)

### Planned
- Chronicle Phase 4: Cross-project intelligence
- Native sync popup (see backlog/native-sync-popup.md)
- prek adoption across ~/code/ portfolio

### Deferred
- Hooks validation system
- Video generation skill
- Skill description optimization for cmux-orchestrator trigger accuracy

## Learnings

### 2026-03-22 — cmux-orchestrator skill (#127) + prek pre-commit (#130)
- Named conventions (workshop, ops deck) are the skill's unique value — commands are discoverable from `--help`, but orchestration patterns aren't
- Prompt-via-inbox pattern works end-to-end: agent read inbox, updated cmux sidebar, sent results back to orchestrator inbox
- `cmux send` with complex shell quoting is fragile — launcher scripts with stdin pipe (`echo "prompt" | claude -p`) are reliable
- `--add-dir .agents/inbox` is required for sandbox access; `--dangerously-skip-permissions` works for trusted agent panes
- Eval viewer helped iterate but the real signal came from live testing — the evals couldn't catch quoting and sandbox issues
- Committing to main instead of feature branch caused a messy reconciliation — prek's `no-commit-to-branch` hook prevents this mechanically
- Skill-creator's workspace convention is `<name>-workspace/` as a sibling, not inside the skill directory

### 2026-02-08 — Token Cache Enrichment (#88)
- Detailed backlog plans with exact line numbers and code snippets make implementation trivial — this was a single-edit session
- Atomic writes (mktemp + mv) should be default for any background job writing to shared files
- /reflect caught a pre-existing concern (jq -s memory pressure) that wouldn't have been filed otherwise — validates doing reflection even on small changes
- `${var:-0}` defaults for `--argjson` and `//= 0` in jq are complementary defenses — shell prevents jq parse errors, jq prevents null propagation

### 2026-02-08 — Config Inventory Consolidation (#82)
- Well-scoped backlog plans with verification commands make execution trivial
- Skill overlap detection immediately surfaced a real shadow (bread-builder/release)
- `git mv` preserves rename tracking — verify with `git grep` for stale refs after moves

### 2026-02-07 — Playwright Skill Rationalization (#78)
- Skill-backed subagent pattern (from PR #77) applies broadly: eliminated agent + merged two skills into one
- `inspired-by` frontmatter field better than `origin` for heavily modified upstream skills
- Over-specified agent personas (86 lines) add no value over concise subagent prompts — Claude already knows UI/UX analysis
- Skills should cover ad-hoc use, not just structured workflows — "take a screenshot" is as valid as "write E2E tests"
- Testability guidelines in the testing skill influence code authoring, not just test writing — dual-purpose content

### 2026-02-07 — ai-coding-usage Incremental Loading (#76)
- File mtime comparison via `stat` + DuckDB CSV join is a simple, effective change detection strategy
- `source_file` column enables file-level delete/reinsert without touching unrelated data
- JSONL record types have top-level fields (not nested in `message`) — must query raw data to verify structure
- /reflect caught a real upgrade path bug (v1.1 DB missing v1.2 tables) and excessive backup creation
- Backup on every incremental run is wrong — active session file always changes, creating unnecessary copies

### 2026-01-31 — Chronicle Thread Identity
- Simple slug-based threads (no separate threads.jsonl) proved sufficient
- `pendingThreads` map is sparse and backward compatible with existing blocks
- Haiku prompt extension for detecting task decomposition works well
- Thread inheritance via lookup keeps logic simple (exact match first)
- Sorting threaded items together in catchup output improves readability

### 2026-01-24 — Chronicle Phase 3: Smart Suggestions (#63)
- SessionStart hook is the right injection point—runs once per session, lightweight
- Shared context.ts module eliminates duplication between catchup.ts and session-start.ts
- Output format must be concise—context window is precious
- Silent failure (output `{}`) is correct for non-Chronicle projects

### 2026-01-24 — Release skill overhaul (analyze-release-skill)
- Worktree-aware releases: ephemeral worktree strategy works cleanly from any branch
- Shell escaping in scripts is treacherous - use temp files for multi-line content passed to CLI tools
- Outcome tracking (JSONL) pattern from update-dependencies skill is worth replicating
- /reflect caught a real shell injection bug before merge
- Skill structure: scripts/ for automation, references/ for troubleshooting, data/ for learning

### 2026-01-24 — Chronicle Sync UX Simplification (#59)
- macOS osascript dialogs are plain text only—rich UI needs native app
- Structured output (JSON) is UI-agnostic—design for any consumer
- Terminal preview + dashboard covers 90% of use cases without native UI
- Feedback loops require click tracking—defer until native UI exists

### 2026-01-24 — Chronicle stale detection (#58)
- Cross-project deduplication was a subtle bug - same text in different projects should be separate items
- Archive script resilience: error suppression is pragmatic for cleanup workflows
- STALE_THRESHOLD_DAYS should be a single exported constant, not duplicated
- /reflect workflow continues to catch bugs before merge

### 2026-01-24 — Chronicle catchup bugfix (#56)
- Worktree filtering is essential for relevant context in multi-worktree workflows
- Design tradeoff: worktree-specific last session, project-wide pending items
- /reflect caught a real bug before merge - validates the workflow
- Centralized storage + worktree metadata is the right architecture

### 2026-01-24 — Chronicle resolution detection (#61)
- Overlay file vs block mutation: blocks are session snapshots, resolutions are cross-session metadata
- Brainstorming skill invaluable for design decisions (storage model, matching strategy)
- Circular imports: extract shared types.ts to break the cycle cleanly
- LLM always decides on match (with matchScore as context) - no magic thresholds
- Lazy evaluation: run resolution check on /catchup, not at session end

### 2026-01-22 — Chronicle catchup command (#56)
- Brainstorm-to-brief workflow effective for going wide then narrowning
- Conductor workspace sandbox requires using Bash for writes outside workspace
- SKILL.md serves as both documentation AND command dispatcher
- Worktree detection reuses patterns from extract-lib.ts
- Pending deduplication by normalizing text (lowercase, trim)
