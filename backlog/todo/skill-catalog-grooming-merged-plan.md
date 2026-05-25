---
priority: 2
arc: skill-catalog-grooming
supersedes:
  - skill-coherence-cleanup-task-list
  - skill-context-optimization-plan
---

# Skill Catalog Grooming — Merged Plan

Consolidates `skill-coherence-cleanup-task-list` and `skill-context-optimization-plan` under ROADMAP priority #2. The two plans overlap on catalog hygiene but pull in different directions — one is taste-driven (coherence), the other is token-driven (context). Sequencing them under one arc avoids two passes through the same SKILL.md files.

## What already shipped

- **PR #182** (merged 2026-05-25) made `dotagents.toml` the single source of truth, wired a SessionStart drift hook, and removed the superpowers plugin. Dropped ~14 entries from the catalog — partial advance of what skill-context-optimization called "Phase 1: catalog reduction."
- **PR #179** (merged 2026-05-25) executed the full skill-coherence cleanup: renamed `swiftui-expert-skill` → `swiftui-expert`, slimmed `chronicle` (745 → ~100 lines via `references/command-reference.md` extraction), promoted `skill-building` from experimental, added `experimental_reason` to skills kept experimental (ascii-art-fix, cloudflare-workers-deploy, ios-simulator, skill-seeker, vocal), and added cross-references between memory-adjacent skills. The coherence half of this arc is essentially complete — Phase 2 below collapses to leftovers.

## Sequencing rationale

PR #179 shipped the coherence pass in parallel with this merge work; it landed during rebase. That collapses the merged plan to mostly Phase 1, plus a couple of leftover coherence decisions and the conditional follow-on phases.

1. **Phase 1: disable-model-invocation** — biggest per-skill token reduction (entire entry leaves the catalog), reversible by deleting one line, forces an honest audit of which skills actually benefit from proactive triggering.
2. **Phase 2: coherence leftovers** — `persona-memory` and `skills-manager` decisions PR #179 didn't reach.
3. **Phase 3: slim oversized SKILL.md** — only if `/context` after Phase 1 still shows skills as dominant. With chronicle already slimmed (PR #179), only `cmux-orchestrator` remains as a candidate.
4. **Phase 4: plugin conversion** — likely unnecessary now that chronicle is small; only revisit if bug #16616 materially bites.

## Scope notes

- **Ecosystem skills are out of scope for edits.** ~/.agents/skills/* are symlinked in and managed by the skills CLI; editing their frontmatter here would be clobbered on next sync. If we want to suppress an ecosystem skill from the catalog, the right move is `[link-to-claude] foo = false` in `dotagents.toml`, not a frontmatter edit. This plan only touches dotclaude-authored skills under `skills/`.
- **Plan text references stale state.** Verify against the live tree before editing — e.g., the original plans named `code-council`, `skill-evaluator`, `better-auth-best-practices`, none of which are dotclaude-authored skills today.

---

## Phase 1 — disable-model-invocation pass

Skills that are always user-initiated never need to occupy proactive catalog space. Adding `disable-model-invocation: true` to frontmatter keeps the skill invocable via `/name` but removes its entry from the system-reminder.

### Skills to flag (dotclaude-authored only)

| Skill | Why explicit-only |
|-------|-------------------|
| `release` | Always `/release` |
| `fork` | Always `/fork` |
| `skill-building` | Always invoked when creating/reviewing skills |
| `skill-seeker` | Description already says "EXPERIMENTAL — only use when explicitly requested" |
| `brainstorm-to-brief` | Always explicit design workflow |
| `cloudflare-workers-deploy` | Always explicit setup |
| `excalidraw-diagrams` | Always explicit diagram creation |
| `web-artifacts-builder` | Always explicit (specifically claude.ai artifacts) |
| `youtube-content` | Description already says "Does NOT auto-trigger on YouTube URLs" |

The first eight match the original context-optimization plan's explicit-only list (minus ecosystem skills out of scope here and `code-council` which no longer exists). `youtube-content` wasn't in the original list but its description explicitly disclaims auto-trigger — flagging just enforces the description's stated intent.

### Candidates considered and deferred

- `ios-simulator` — model-triggering plausibly useful when working on SwiftUI ("show me this screen"); revisit if it proves noisier than useful
- `tart-gui-automation` — borderline; niche enough to flag, but not in original plans
- `persona-memory` — flag depends on the 2b decision (promote vs. cancel)
- `slidev`, `web-design-guidelines`, `better-auth-best-practices` — ecosystem-installed (under `~/.agents/skills/`); suppress via `dotagents.toml` `[link-to-claude] = false` if wanted, not via frontmatter

### Skills evaluated and kept invokable

- `chronicle` — auto-extract loop relies on proactive triggering
- `backlog`, `team-memory`, `persona-memory` — model-invoked when memory/work-tracking patterns surface
- `dotclaude-config` — model-invoked on settings.json / permission patterns
- `webapp-testing` — model-invoked on Playwright / web testing patterns
- `frontend-design`, `image-gen`, `gh-apps`, `cmux-orchestrator`, `agent-inbox`, `signoz-log`, `vocal`, `git-worktree`, `analyze-usage`, `update-dependencies`, `session-titles`, `status-line-live`, `codespaces`, `project-scripts`, `swiftui-expert(-skill)`, `ascii-art-fix`, `skills-manager` — each has a real trigger surface where catching it proactively earns the catalog cost

### Remove duplicate commands

`commands/` entries that duplicate a skill add catalog weight without adding capability:

- `commands/update-dependencies.md` — pure wrapper; the skill has the full workflow

`commands/vocal.md` was evaluated and kept — it contains the turn-based loop orchestration (vocal-listener background agent, listen/respond cycle) that the vocal skill itself doesn't carry. Folding the loop logic into the skill is a separate followup; until then, the command earns its catalog slot.

### Acceptance

- [ ] Flagged skills no longer appear in the system-reminder catalog
- [ ] All flagged skills still load when invoked via `/name`
- [ ] `/update-dependencies` still works via the skill after command removal
- [ ] `/context` in a fresh session shows reduced Skills token count vs. pre-change baseline

---

## Phase 2 — coherence leftovers

PR #179 shipped the bulk of this phase. Remaining decisions:

### 2a. `persona-memory` — promote or cancel?

Still experimental after PR #179. The original context-optimization plan claimed it's "superseded by team-memory." Either:
- Promote (remove `status: experimental`) if it's a kept-distinct framework worth recommending
- `cancel` (mark as superseded, leave file in place but stop recommending) if team-memory fully covers its surface

Make this call before flagging it in any context-optimization pass.

### 2b. `skills-manager` — promote?

PR #179 didn't touch it. Still `status: experimental`. Description and tooling look mature; if there's no concrete reason for the label, promote it.

### Acceptance

- [ ] `persona-memory` either promoted with reason or marked cancelled with reason
- [ ] `skills-manager` either promoted or has `experimental_reason` added

---

## Phase 3 — slim oversized SKILL.md (conditional)

Run only if `/context` after Phase 1 still flags skills as the top token bucket.

PR #179 already slimmed `chronicle` (745 → ~100 lines). The remaining oversized dotclaude-authored SKILL.md is:

| Skill | Lines | Target |
|-------|-------|--------|
| `cmux-orchestrator` | 572 | ~250 (not in original plans; surfaced during this audit) |

Keep in SKILL.md: frontmatter, description, command summary table, key workflows. Move elsewhere: detailed reference content, examples, troubleshooting.

### Acceptance

- [ ] `cmux-orchestrator` SKILL.md under 300 lines
- [ ] No functionality lost — content moved to `references/`, not deleted
- [ ] Skill still triggers correctly

---

## Phase 4 — plugin conversion (likely unnecessary)

Open this phase only if bug [#16616](https://github.com/anthropics/claude-code/issues/16616) (user skills loading full SKILL.md instead of frontmatter-only) is still active and showing up in `/context` measurements after Phases 1–3. With chronicle slimmed to ~100 lines (PR #179) and Phase 1's catalog reductions, the remaining surface area is small enough that plugin conversion's added complexity likely isn't justified. Don't pre-empt.

---

## Phase 5 — measure `SLASH_COMMAND_TOOL_CHAR_BUDGET` (parallelizable)

Independent of the other phases. Test a lower budget cap (e.g., 8000) in a session, record what gets excluded, document the optimal value in `~/.ai-memory/shared/platform.md` if it earns its place.

---

## Verification

```bash
# Baseline before any phase: /context in fresh session, record Skills tokens
# After Phase 1: same measurement; expect reduction matching # of flagged skills
# After each phase: drift check
~/.claude/scripts/dotagents-status.sh
```

## Rollback

All edits land via single PR. `git revert` the merge commit if Phase 1 over-suppresses something useful.

## References

- Original plans (now in `done/`): `skill-coherence-cleanup-task-list`, `skill-context-optimization-plan`
- PR #182 — `chore(dotagents): reconcile manifest, prune drift, remove superpowers plugin`
- ROADMAP priority #2 — skill-catalog-grooming
- Open Claude Code issues (catalog mechanics): #16616, #14882, #13919, #4464, #17601, #18840, #24243
