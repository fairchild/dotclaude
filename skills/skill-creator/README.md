# Skill Creator

A guide for creating effective Claude Code skills with built-in validation.

## Origin

This skill is based on the official `skill-creator` skill from [Anthropic's agent skills repository](https://github.com/anthropics/anthropic-agent-skills).

## What It Does

The skill-creator provides step-by-step guidance for creating high-quality Claude Code skills, including:

- Understanding skill structure (SKILL.md, scripts/, references/, assets/)
- Planning reusable skill contents
- Writing effective frontmatter with comprehensive descriptions
- Organizing content using progressive disclosure patterns
- Avoiding common pitfalls (extraneous docs, context bloat)
- Packaging skills for distribution

## Our Modifications

### Added Specialized Self-Validation (v2.1.0 Hooks)

We've enhanced this skill with **scoped hooks** to automatically validate SKILL.md files as they're created:

```yaml
hooks:
  PostToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: uv run $CLAUDE_PROJECT_DIR/.claude/hooks/validators/skill_frontmatter_validator.py
```

**What gets validated:**
- ✅ Required frontmatter fields (`name`, `description`)
- ✅ Description length (50+ chars for comprehensive triggering)
- ✅ Forbidden files (README.md, INSTALLATION.md, etc. should not exist in skill directories)
- ✅ Valid YAML structure

This implements the "specialized self-validating agents" pattern from Claude Code v2.1.0, where validators run automatically after Write operations and provide immediate feedback for auto-correction.

### Philosophy: Agents Plus Code

This modification embodies the principle that **"agents plus code beats agents"** - deterministic validation transforms unreliable workflows into trustworthy systems. The skill-creator now catches structural errors immediately rather than at packaging time.

## Usage

```bash
/skill-creator
```

Claude will guide you through the skill creation process and automatically validate the output structure.

## Related

- **Backlog Plan**: See `backlog/hooks-validation-system-plan.md` for the full validation roadmap
- **Validator**: See `hooks/validators/skill_frontmatter_validator.py` for implementation
- **Hooks Reference**: See `references/hooks-reference.md` for hooks documentation

## Note on This README

This README exists for human readers browsing the repository on GitHub. Per the skill-creator's own guidelines, skills distributed to AI agents should NOT include extraneous documentation files like READMEs. This file is an exception because it documents the meta-level (the skill about creating skills) for repository contributors.
