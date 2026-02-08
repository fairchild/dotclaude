---
status: pending
category: followup
pr: null
branch: null
score: null
retro_summary: null
completed: null
---

# Consolidate Config Inventory into dotclaude-config Skill

## Problem Statement

`scripts/config-inventory.ts` scans `~/code/` for Claude Code project configurations and reports what's set up per project. The dotclaude-config skill already owns the domain of "working with Claude Code configuration" and includes a placement decision guide, audit workflow, and reuse principle. The inventory scanner is a natural tool for that skill — it answers "what do my projects have?" which is the prerequisite for "should I add this globally or per-project?"

Beyond just moving the file, the scanner should be enhanced to detect skill overlap between global (`~/.claude/skills/`) and project (`.claude/skills/`) levels, directly supporting the skill's core concern: avoid duplication.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Destination | `skills/dotclaude-config/scripts/inventory.ts` | Shorter name, skill context makes "config" redundant |
| Enhance scope | Add skill overlap detection | Core value prop: find duplicated/clobbered configs |
| Dependencies | No new deps needed | Script uses only node stdlib (fs, path, os) |
| SKILL.md update | Add "Inventory" section | Reference the script, explain when to use it |

## Implementation

### Phase 1: Move and Rename

```bash
mkdir -p skills/dotclaude-config/scripts
git mv scripts/config-inventory.ts skills/dotclaude-config/scripts/inventory.ts
```

**Update usage comment** in the script header:
```
# Old: bun ~/.claude/scripts/config-inventory.ts [path]
# New: bun ~/.claude/skills/dotclaude-config/scripts/inventory.ts [path]
```

**Update cross-references:**
- `CLAUDE.md` (root) references `bun ~/.claude/scripts/config-inventory.ts`

### Phase 2: Add Skill Overlap Detection

Enhance the scanner to compare project-level skills against global skills:

```typescript
// In scanProject(), after counting skills:
async function getProjectSkillNames(claudeDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(claudeDir, "skills"));
    return entries.filter(e => !e.startsWith("."));
  } catch { return []; }
}

// In report, flag overlaps:
// "webapp has 2 skills that shadow global: frontend-design, webapp-testing"
```

Add to `ProjectConfig`:
```typescript
interface ProjectConfig {
  // ... existing fields
  skillNames: string[];
  overlappingSkills: string[];  // skills that exist both globally and in project
}
```

New report section:
```
## Skill Overlap

| Project | Overlapping Skills | Action |
|---------|-------------------|--------|
| webapp  | frontend-design, webapp-testing | Review if project versions add value |
```

### Phase 3: Update SKILL.md

Add section to dotclaude-config SKILL.md:

```markdown
## Configuration Inventory

Scan projects for Claude Code configuration status and identify overlap:

\`\`\`bash
bun ~/.claude/skills/dotclaude-config/scripts/inventory.ts          # scan ~/code/
bun ~/.claude/skills/dotclaude-config/scripts/inventory.ts ~/work   # custom path
\`\`\`

Reports: configured vs unconfigured projects, skill counts, package managers,
and flags project skills that shadow global skills (candidates for removal
or promotion to global).
```

## Verification Commands

```bash
# Script runs from new location
bun skills/dotclaude-config/scripts/inventory.ts

# No stale references
git grep 'config-inventory' -- ':!backlog/'

# Overlap detection works (if any projects have .claude/skills/)
bun skills/dotclaude-config/scripts/inventory.ts | grep -A5 "Overlap"
```

## Complexity Notes

Very simple move — single file, no imports to update, no tests to move. The overlap detection enhancement is the real value-add but can be done incrementally.

## References

- `scripts/config-inventory.ts` — current location (218 lines)
- `skills/dotclaude-config/SKILL.md` — skill definition (no scripts dir yet)
- `CLAUDE.md` (root) line referencing `config-inventory.ts`
- PR #81: Session titles consolidation (same move pattern)
