# skill-seeker

> **Status: Experimental** — Not yet used enough to have confidence in the pipeline. Use explicitly when you want to try it.

Turn any documentation source into an installable Claude Code skill.

## What it does

This skill wraps [Skill Seekers](https://pypi.org/project/skill-seekers/) — a PyPI-published tool that scrapes documentation websites, GitHub repos, local codebases, and PDFs into structured markdown. On its own, Skill Seekers produces raw documentation compilations. This skill adds an orchestration layer that:

1. **Generates** raw documentation via Skill Seekers (with AI enhancement disabled)
2. **Reviews** the output against our skill-building quality standards
3. **Refines** — Claude rewrites the raw output into a proper Claude Code skill (frontmatter, progressive disclosure, token budget)
4. **Suggests an eval set** — domain-specific test prompts for regression testing
5. **Installs** the finished skill to `~/.claude/skills/` <!-- portability: allow -->

## Why not just use Skill Seekers directly?

Skill Seekers has a built-in AI enhancer, but it's keyword-based. By disabling it (`--enhance-level 0`) and letting Claude do the review, we get:

- Quality judgment against our specific skill standards (skill-building conventions and rubric)
- Proper Claude Code skill formatting (lean body, references for progressive disclosure)
- Context budget awareness (trim to <500 lines, flag heavy skills)
- An eval set you can use to verify the skill works after updates

## How to use

In a Claude Code session, explicitly ask:

```
"Use skill-seeker to create a skill for Hono"
"Use skill-seeker to generate a skill from facebook/react"
"Use skill-seeker to turn ./my-project into a skill"
```

The skill won't auto-trigger — you need to request it by name since it's experimental.

## Scripts

All scripts use [PEP 723 inline metadata](https://peps.python.org/pep-0723/) and run with `uv run` (no pre-installation needed):

| Script | Deps | Purpose |
|--------|------|---------|
| `scripts/create.py` | `skill-seekers` | Runs `skill-seekers create` with enhancement disabled |
| `scripts/review.py` | `pyyaml` | Structural validation, token budget estimation, outputs JSON |
| `scripts/install.py` | *(stdlib)* | Copies skill to `~/.claude/skills/`, verifies installation <!-- portability: allow --> |

## What's next

This skill needs real-world usage to build confidence:

- Does the scraping output need different handling for different source types?
- Is the review/refine step producing good skills, or does it need more guidance?
- Are the eval sets useful in practice?
- Should presets map to different review strictness levels?

Try it, see what works, iterate.
