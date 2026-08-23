---
name: skill-seeker
description: Generate Claude Code skills from docs sites, GitHub repos, or local codebases using Skill Seekers.
license: Apache-2.0
disable-model-invocation: true
metadata:
  status: experimental
  experimental_reason: "Generated skill quality varies by source corpus and still requires explicit human review before installation."
---

# Skill Seeker

Generate, review, and install Claude Code skills from any documentation source.

**Pipeline**: Source → Generate → Review → Summarize → Install

## Phase 1: Source + Options

Gather inputs from the user:

1. **Source** (required): URL, GitHub `owner/repo`, local directory path, or PDF file
2. **Skill name**: Infer from source (e.g., `hono` from `https://hono.dev`) or ask
3. **Preset**: Ask user to choose
   - `quick` — Fast, essential docs only (1-2 min)
   - `standard` — Balanced coverage (5-10 min)
   - `comprehensive` — Deep analysis, all features (20-60 min)

If the user provides a source inline (e.g., "create a skill for Hono"), infer the source URL/repo and default to `standard` preset. Confirm before proceeding.

## Phase 2: Generate

Run the create script. Use a timeout appropriate for the preset — scraping takes real time:
- `quick`: 2 minutes
- `standard`: 10 minutes
- `comprehensive`: 60 minutes

```bash
uv run ~/.claude/skills/skill-seeker/scripts/create.py \
  --source "<source>" \
  --name "<skill-name>" \
  --preset "<preset>" \
  --output-dir "/tmp/skill-seeker/<skill-name>"
```

The script runs `skill-seekers create` with `--enhance-level 0` (Claude handles quality review instead of the keyword-based enhancer). Note the actual output path printed by the script — skill-seekers may nest output in a subdirectory.

On success, read the generated SKILL.md from the path printed by the script. On failure, report the error and suggest trying `quick` preset or a different source.

## Phase 3: Review + Refine

Apply a two-lens review to the generated output.

### Lens 1: Automated Structure Check

Run the review script:

```bash
uv run ~/.claude/skills/skill-seeker/scripts/review.py \
  --path "/tmp/skill-seeker/<skill-name>"
```

Record the JSON output. Flag any warnings.

### Lens 2: Quality Review by Claude

Read `references/quality-checklist.md` for the full rubric, then evaluate:

**Structure**:
- Frontmatter has only `name` and `description`?
- Description includes trigger conditions (when to use)?
- Body under 500 lines? Uses imperative form?
- References organized one level deep from SKILL.md?
- No forbidden files at skill root (README.md, CHANGELOG.md)?

**Security**:
- Any unexpected subprocess calls, network access, or credential reading?
- Scripts do only what they claim?

**Quality** (rate A/B/C/D):
- A: Exemplary — clear workflow, concrete examples, verification steps
- B: Good — covers core use cases, minor gaps
- C: Functional — works but thin on examples or organization
- D: Poor — missing structure, vague instructions

**Context Budget** (from review script output):
- Light (<2K triggered tokens): No concern
- Moderate (2-10K): Acceptable, note the cost
- Heavy (>10K): Must trim — move content to references/

**Value**:
- Does this add knowledge Claude doesn't already have?
- Is it worth the context cost?

### Refine the Skill

Rewrite the generated SKILL.md applying these fixes:

1. **Trim body** to under 500 lines. Move detailed content to `references/` files
2. **Rewrite description** to include specific trigger phrases
3. **Add concrete examples** if missing (realistic code snippets, commands)
4. **Remove forbidden files** (README.md, CHANGELOG.md at skill root)
5. **Ensure progressive disclosure**: lean body, rich references loaded on demand
6. **Add verification steps** after key procedures

Write the refined SKILL.md and any new reference files back to the output directory.

Run review.py again on the refined output to verify improvements (token budget, warnings resolved).

## Phase 4: Summarize + Eval Suggestions

Present to the user before installing:

### Summary

Report these fields:
- **Skill name**: `<name>`
- **Topics covered**: List main areas (APIs, patterns, guides)
- **Token cost**: Metadata tokens + body tokens + reference tokens (from review script)
- **Quality rating**: A/B/C/D with brief justification
- **Recommendation**: Install / Install with caveats / Skip

### Suggested Eval Set

Generate 3-5 test prompts tailored to the skill's content:

```markdown
## Eval Set: <skill-name>

### Should trigger:
- "<prompt that should activate this skill>"
- "<another prompt that should activate this skill>"

### Should NOT trigger:
- "<prompt about a similar but different topic>"
- "<prompt outside this skill's domain>"

### Knowledge test:
- "<prompt that tests the skill's core, non-obvious knowledge>"
```

Base these on the actual content of the generated skill, not generic templates. The eval set helps the user regression-test the skill after updates.

## Phase 5: Install

After user approval:

```bash
uv run ~/.claude/skills/skill-seeker/scripts/install.py \
  --source "/tmp/skill-seeker/<skill-name>" \
  --target "~/.claude/skills/<skill-name>"
```

Confirm installation:
- Verify SKILL.md exists at target
- List installed files
- Tell the user: "Skill `<name>` installed. Start a new conversation to use it."

If the user declines, leave the generated skill in `/tmp/skill-seeker/<skill-name>` and tell them where to find it.
