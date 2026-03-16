---
priority: 2
description: Trim and organize skills for coherence — naming, status labels, SKILL.md sizing
---

# Skill Coherence Cleanup

## Problem Statement

28 tracked skills have accumulated organic inconsistencies: one naming outlier, experimental labels on production-ready skills, oversized SKILL.md files, and no cross-references between related memory skills. None of these are broken, but they erode trust in the system (if chronicle is "experimental" with 540 lines, what does experimental mean?).

## Tasks

### 1. Rename `swiftui-expert-skill` → `swiftui-expert`

The `-skill` suffix is redundant — every other skill is named for what it does.

**Files to modify:**
- `skills/swiftui-expert-skill/` → `skills/swiftui-expert/` (rename directory)
- Any references in README.md skill tables

**Acceptance criteria:**
- [ ] Directory renamed
- [ ] No broken references
- [ ] Skill loads correctly in new session

### 2. Promote Experimental Skills

Audit and promote skills whose experimental label no longer reflects reality:

| Skill | Action | Rationale |
|-------|--------|-----------|
| **chronicle** | Promote | Most actively used skill, 540-line SKILL.md, full test suite |
| **skill-building** | Promote | ~160 lines, consolidated with evaluator, used regularly |
| **skills-manager** | Promote | Well-structured, mature tooling |
| **persona-memory** | Evaluate | Has README, tests, references — may be ready |
| **cloudflare-workers-deploy** | Evaluate | Unclear why experimental |
| **skill-seeker** | Keep experimental | Genuinely experimental (generation quality varies) |
| **vocal** | Keep experimental | External provider dependencies (ElevenLabs) |

**Files to modify:**
- Each promoted skill's `SKILL.md` — remove `status: experimental` from frontmatter

**Acceptance criteria:**
- [ ] Promoted skills no longer show "(Experimental)" in skill list
- [ ] Remaining experimental skills have clear rationale (add one-line comment in frontmatter)

### 3. Slim Oversized SKILL.md Files

Two skills exceed 300 lines. Move reference content out of SKILL.md into `references/`:

**chronicle (540 lines):**
- SKILL.md should be the trigger/dispatch layer (~150-200 lines)
- Move command reference details, curation workflows, and examples to `references/`
- Keep: frontmatter, description, command summary table, key workflows

**skill-building (~160 lines, already consolidated):**
- Move detailed guidance (output patterns, testing methodology) to `references/`
- Keep: frontmatter, description, creation workflow, quality checklist

**Acceptance criteria:**
- [ ] Both SKILL.md files under 250 lines
- [ ] No functionality lost (content moved to references/, not deleted)
- [ ] Skills still trigger correctly with shorter SKILL.md

### 4. Cross-Reference Memory Skills

Four skills in overlapping territory need "see also" guidance:

| Skill | Domain | Add reference to |
|-------|--------|-----------------|
| **chronicle** | Session journaling (what happened) | team-memory, session-titles |
| **team-memory** | Persistent teammate behavior | chronicle, persona-memory |
| **persona-memory** | Identity/personality framework | team-memory |
| **session-titles** | Session naming | chronicle |

**Add to each SKILL.md** (one line, near the top):

```markdown
> **Related:** For session journaling see [chronicle](../chronicle/SKILL.md). For persistent personality see [persona-memory](../persona-memory/SKILL.md).
```

**Acceptance criteria:**
- [ ] Each memory skill has a one-line "Related" note
- [ ] A user encountering any one of them can find the others

## Verification Commands

```bash
# Verify no broken skill loading after changes
ls ~/.claude/skills/swiftui-expert/SKILL.md

# Check SKILL.md line counts
wc -l ~/.claude/skills/chronicle/SKILL.md ~/.claude/skills/skill-building/SKILL.md

# Verify experimental status
grep -l "status: experimental" ~/.claude/skills/*/SKILL.md
```

## Rollback Plan

All changes are to tracked skill files — `git revert` the commit.

## References

- Skills audit from session (28 skills analyzed)
- `.claude/CLAUDE.md` — skill status convention table
- `skills/dotclaude-config/SKILL.md` — configuration guidance
