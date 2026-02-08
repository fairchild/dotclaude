---
status: done
category: plan
pr: null
branch: chore/rationalize-playwright-skills
score: 4
retro_summary: Merged 3 Playwright components into 1 unified skill, went further than plan by also eliminating the agent (following PR #77 skill-backed subagent pattern).
completed: 2026-02-07
---

# Rationalize Playwright Skills

## Problem Statement

Three separate Playwright-related components exist with overlapping scope:

| Component | Type | Language | Origin | Scope |
|-----------|------|----------|--------|-------|
| **webapp-testing** | skill | Python | Anthropic | General web app testing with `with_server.py` helper |
| **playwright-ts** | skill | TypeScript | Ours | CF Workers E2E patterns, screenshot capture, debugging |
| **playwright-test-analyzer** | agent | n/a | Ours | Subagent for running tests + visual/UX analysis of screenshots |

A user asking "help me test my app" could reasonably trigger any of these. The distinction between them isn't obvious from names or README descriptions. This creates confusion for both the skill matching system and anyone browsing the repo.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Keep or merge? | Merge webapp-testing + playwright-ts into one skill | They solve the same problem (Playwright testing) split by language |
| Keep the agent? | Yes, keep playwright-test-analyzer | Agents serve a different purpose (subagent dispatch) — the overlap is naming, not function |
| Which language wins? | TypeScript-primary, Python as fallback | Our projects use bun/TS; Anthropic's Python helper is still useful for Python projects |
| Naming | `webapp-testing` (keep Anthropic's name) | Broader name, already established, covers both languages |

## Architecture

```
Before:                          After:
webapp-testing (Python)     →    webapp-testing (unified)
playwright-ts (TypeScript)  →      ├── Python patterns (from Anthropic)
playwright-test-analyzer    →      └── TypeScript patterns (from playwright-ts)
                                 playwright-test-analyzer (agent, unchanged)
```

## Implementation Phases

### Phase 1: Merge playwright-ts into webapp-testing

**Files to modify:**
- `skills/webapp-testing/SKILL.md` — Add TypeScript section from playwright-ts (CF Workers dev server, headed mode, screenshot patterns, package manager detection)

**Files to delete:**
- `skills/playwright-ts/SKILL.md` — Absorbed into webapp-testing
- `skills/playwright-ts/` directory

**Acceptance criteria:**
- [ ] `webapp-testing` SKILL.md covers both Python and TypeScript Playwright patterns
- [ ] Decision tree updated: language detection based on project (pyproject.toml → Python, package.json → TypeScript)
- [ ] `bun webui/scan.ts` still passes
- [ ] No references to `playwright-ts` remain in README or other files

### Phase 2: Update README

**Files to modify:**
- `README.md` — Remove playwright-ts row from skills table, update webapp-testing description to mention both languages

**Acceptance criteria:**
- [ ] Skills table has one Playwright entry, not two
- [ ] Description mentions "Python and TypeScript"

### Phase 3: Clarify agent vs skill boundary

**Files to modify:**
- `agents/playwright-test-analyzer.md` — Add a note that this agent is for *dispatched visual analysis*, not general test writing
- `README.md` — Ensure agents table description distinguishes from the skill

**Acceptance criteria:**
- [ ] A reader can understand when to use the skill (writing/running tests) vs agent (visual analysis of screenshots in a subagent)

## Verification Commands

```bash
# Skill count should decrease by 1
bun webui/scan.ts | grep Skills

# No orphan references
grep -r "playwright-ts" ~/.claude/README.md ~/.claude/skills/ ~/.claude/agents/

# Frontmatter valid
grep -A5 "^---" ~/.claude/skills/webapp-testing/SKILL.md
```

## Rollback Plan

`git revert` the merge commit. The playwright-ts skill is small (~100 lines) so recreating it from git history is trivial.

## References

- `skills/webapp-testing/SKILL.md` — Anthropic's Python-based testing skill
- `skills/playwright-ts/SKILL.md` — Our TypeScript patterns for CF Workers
- `agents/playwright-test-analyzer.md` — Visual analysis subagent
- Quality review identified this as overlap issue (3 Playwright components)
