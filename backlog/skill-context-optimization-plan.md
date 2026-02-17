---
status: pending
category: plan
pr: null
branch: skill-context-optimization
score: null
retro_summary: null
completed: null
---

# Skill & Command Context Optimization

## Problem Statement

With 63 catalog entries (31 skills + 15 commands + 16 superpowers + 1 duplicate),
~3k tokens are injected per system-reminder throughout each session. Commands that
duplicate skill functionality add unnecessary weight. Several skills are only invoked
explicitly but still occupy proactive catalog space. Known Claude Code bugs mean user
skills may load full SKILL.md content (~41k tokens) instead of frontmatter-only.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Optimization approach | Audit + prune + frontmatter flags | Least disruptive, no code changes |
| Commands vs skills | Remove commands that duplicate skills | Commands can't use disable-model-invocation |
| Heavy skills | Add `disable-model-invocation: true` | Keeps them invocable via `/name` |
| Plugin conversion | Defer unless bug persists | Workaround for #16616, adds complexity |

## Research Findings

Session on 2026-02-16 discovered:
- Skill catalog repeated in every system-reminder injection (~3k tokens each)
- `disable-model-invocation: true` removes skill from catalog entirely
- `SLASH_COMMAND_TOOL_CHAR_BUDGET` env var caps catalog size (default 2% of window)
- `context: fork` runs skills in isolated subagent (keeps execution out of main ctx)
- Bug #16616: user skills load full content, not just frontmatter
- Bug #13919: skills lost entirely after autocompaction

## Implementation Phases

### Phase 1: Remove Duplicate Commands

Commands in `commands/` that are already covered by skills:

- `voice.md` — covered by `skills/voice/`
- `update-dependencies.md` — covered by `skills/update-dependencies/`
- `code-review.md` — covered by superpowers:requesting-code-review
- `bootstrap.md` — covered by superpowers:brainstorming

Audit each command to confirm the skill fully covers it before removing.

**Files to modify:**
- `commands/*.md` — remove duplicates

**Acceptance criteria:**
- [ ] No commands remain that duplicate an existing skill
- [ ] Removed commands are still accessible via their skill equivalent
- [ ] Catalog entry count reduced by number of removed commands

### Phase 2: Add `disable-model-invocation: true` to Explicit-Only Skills

Skills that are always user-initiated and never need proactive triggering:

| Skill | Reason |
|-------|--------|
| release | Always explicit (`/release`) |
| fork | Always explicit (`/fork`) |
| skill-builder | Always explicit |
| skill-evaluator | Always explicit |
| slidev | Always explicit |
| code-council | Always explicit |
| excalidraw-diagrams | Always explicit |
| web-artifacts-builder | Always explicit |
| cloudflare-workers-deploy | Always explicit |
| brainstorm-to-brief | Superseded by superpowers:brainstorming |
| persona-memory | Superseded by team-memory |
| skill-seekers | Rarely used |
| web-design-guidelines | Rarely used |
| better-auth-best-practices | Project-specific |

**Files to modify:**
- Each skill's `SKILL.md` — add `disable-model-invocation: true` to frontmatter

**Acceptance criteria:**
- [ ] Flagged skills no longer appear in system-reminder catalog
- [ ] All flagged skills still work when invoked via `/skill-name`
- [ ] `/context` shows reduced Skills token count

### Phase 3: Evaluate `SLASH_COMMAND_TOOL_CHAR_BUDGET`

Test setting a lower budget to cap catalog size:

```bash
export SLASH_COMMAND_TOOL_CHAR_BUDGET=8000
```

**Acceptance criteria:**
- [ ] Catalog stays under budget
- [ ] No critical skills excluded
- [ ] Document optimal value in `~/.ai-memory/shared/platform.md`

### Phase 4: Consider Plugin Conversion (Conditional)

Only pursue if bug #16616 persists. Convert heaviest user skills to plugin format:

- `skill-builder` (20KB SKILL.md)
- `chronicle` (15KB SKILL.md)
- `webapp-testing` (9KB SKILL.md)
- `dotclaude-config` (9KB SKILL.md)

**Acceptance criteria:**
- [ ] Converted skills load frontmatter-only at startup
- [ ] Full content loads only when invoked
- [ ] `/context` confirms reduced Skills token count

## Verification Commands

```bash
# Before: measure baseline
# Run /context in a fresh session and record Skills token count

# After Phase 1: verify commands removed
ls ~/.claude/commands/ | wc -l  # should be fewer

# After Phase 2: verify catalog reduction
# Run /context — Skills should show fewer tokens

# Check specific skill still works after disable-model-invocation
# Type /release in a session — should still load
```

## Rollback Plan

- Commands: `git restore commands/` to bring back removed files
- Frontmatter: `git restore skills/*/SKILL.md` to remove flags
- Env var: unset `SLASH_COMMAND_TOOL_CHAR_BUDGET`

## References

### Internal
- `~/.ai-memory/shared/platform.md` — Platform facts including catalog cost analysis
- `skills/team-memory/references/design.md` — Key Insight section on system prompt
- Session 2026-02-16: context analysis and subagent experiments

### GitHub Issues (Claude Code)
- [#16616](https://github.com/anthropics/claude-code/issues/16616) — User skills load full SKILL.md content instead of frontmatter-only (OPEN, key bug)
- [#14882](https://github.com/anthropics/claude-code/issues/14882) — Skills consume full token count at startup instead of progressive disclosure (OPEN, stale)
- [#13919](https://github.com/anthropics/claude-code/issues/13919) — Skills context lost entirely after autocompaction (OPEN)
- [#4464](https://github.com/anthropics/claude-code/issues/4464) — System-reminder injection consuming excessive tokens, not user-controllable (OPEN, acknowledged by Anthropic)
- [#17601](https://github.com/anthropics/claude-code/issues/17601) — Hidden system-reminder injections: 10k+ over 32 days, ~1.3M tokens (OPEN)
- [#18840](https://github.com/anthropics/claude-code/issues/18840) — Skill-as-Agent execution mode to prevent context bloat (OPEN, partially addressed by context:fork)
- [#24243](https://github.com/anthropics/claude-code/issues/24243) — Regression: ~2k extra tokens per turn, 31k baseline before any work (OPEN)
- [#17283](https://github.com/anthropics/claude-code/issues/17283) — Skill tool should honor context:fork and agent: frontmatter (CLOSED/COMPLETED)
- [#19141](https://github.com/anthropics/claude-code/issues/19141) — Docs: clarify distinction between user-invocable and disable-model-invocation

### External
- [Claude Code Skills Docs](https://code.claude.com/docs/en/skills) — Official skills reference
- [Claude Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/) — First-principles analysis of skill architecture
- [Skills Solve the Context Window Problem](https://tylerfolkman.substack.com/p/the-complete-guide-to-claude-skills) — Skills vs MCP token comparison
- [MCP Context Bloat 46.9% Reduction](https://medium.com/@joe.njenga/claude-code-just-cut-mcp-context-bloat-by-46-9-51k-tokens-down-to-8-5k-with-new-tool-search-ddf9e905f734) — Tool Search feature analysis
- [cchistory](https://mariozechner.at/posts/2025-08-03-cchistory/) — Tracking Claude Code system prompt changes over time
- [Piebald-AI system prompts](https://github.com/Piebald-AI/claude-code-system-prompts) — Extracted system prompts showing ~40 system-reminder types
- [Superpowers Plugin](https://github.com/obra/superpowers) — Plugin-format skills with progressive disclosure
- [Optimizing MCP Context Usage](https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code) — Practical MCP optimization guide
