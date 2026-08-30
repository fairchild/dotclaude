# Extensibility: Agents, Commands, Skills

Extend Claude Code with custom agents, slash commands, and skills.

## Directory Structure

```
~/.claude/                    # Global config  # portability: allow
├── settings.json
├── CLAUDE.md
├── agents/                   # Subagents
│   └── my-agent.md
├── commands/                 # Slash commands
│   └── my-command.md
├── skills/                   # Auto-triggered skills
│   └── my-skill/
│       ├── SKILL.md
│       ├── references/
│       ├── scripts/
│       └── assets/
└── hooks/
    └── stop.sh
```

Project `.claude/` directories follow the same structure.

## Agents

Subagents handle complex, multi-step tasks autonomously via the Task tool.

### Location

- Global: `~/.claude/agents/` <!-- portability: allow -->
- Project: `.claude/agents/`

### Format

```markdown
---
name: my-agent
description: What the agent does and when to use it
---

# Agent Name

Instructions for the agent...
```

### Key Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Identifier for Task tool's `subagent_type` |
| `description` | Yes | Helps Claude decide when to use this agent |

### When to Use an Agent vs. a Skill Subagent Section

**Don't create an agent file** when a skill already covers the workflow. Instead, add a "Background (Subagent)" section to the skill that spawns a `general-purpose` subagent:

```markdown
## Background Verification (Subagent)

Task(
  subagent_type: "general-purpose",
  prompt: "Use the `verify` skill and follow its workflow.
    Project: {project}, URL: {url}
    Return a concise pass/fail report."
)
```

This avoids duplicating descriptions (agent metadata is always loaded, ~100 tokens each).

**Create an agent file** when:
- The agent has no corresponding skill (e.g., `research`, `recall`)
- The agent needs a distinct persona or specialized behavior beyond the skill
- The agent orchestrates multiple skills or other subagents (e.g., `chronicle-curator`)

### Example (Standalone Agent)

```markdown
---
name: research
description: Deep codebase exploration to understand a problem
---

# Research Agent

[Full instructions here — no skill to reference]
```

### Usage

Claude invokes agents via Task tool:
```
Task(subagent_type="research", prompt="How does auth work in this codebase?")
```

## Slash Commands

Custom commands invoked with `/command-name`.

### Location

- Global: `~/.claude/commands/` <!-- portability: allow -->
- Project: `.claude/commands/`

### Format

```markdown
---
description: What /my-command does
---

The prompt that executes when user types /my-command
```

### Example

```markdown
---
description: Bootstrap a new project with interactive brainstorming
---

You are helping the user bootstrap a new project. Your goal is to:

1. **Understand the context** - Ask clarifying questions...
2. **Present options** - Show architectural approaches...
3. **Execute** - Create the structure...
```

### Usage

User types:
```
/bootstrap
/bootstrap new API with Hono
```

## Skills

Auto-triggered capabilities based on task context.

### Location

- Global: `~/.claude/skills/` <!-- portability: allow -->
- Project: `.claude/skills/`

### Structure

```
my-skill/
├── SKILL.md          # Required: metadata + instructions
├── references/       # Optional: detailed docs loaded on demand
├── scripts/          # Optional: executable code
└── assets/           # Optional: templates, images, etc.
```

### SKILL.md Format

```markdown
---
name: my-skill
description: What the skill does and specific triggers for when to use it
---

# Skill Title

Instructions for using the skill...

## Reference Files

- **Details**: See [references/details.md](references/details.md)
```

### Key Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Skill identifier |
| `description` | Yes | **Primary trigger mechanism** - Claude reads this to decide when to activate |

### Progressive Disclosure

Skills use three loading levels:

1. **Metadata** (~100 tokens) - Always in context, used for triggering
2. **SKILL.md body** (<5k words) - Loaded when skill activates
3. **Bundled resources** - Loaded as needed during execution

### Example Skill

```markdown
---
name: release
description: Create semantic versioned releases with changelog. Use when creating releases, bumping versions, or updating changelogs.
---

# Release Skill

Create releases following semantic versioning...

## Quick Start

1. Analyze commits since last release
2. Determine version bump
3. Generate changelog entry
4. Create git tag and GitHub release

## Reference

- **Changelog format**: See [references/changelog.md](references/changelog.md)
```

### References Directory

Store detailed documentation that's loaded on-demand:

```
references/
├── api.md           # API documentation
├── patterns.md      # Common patterns
└── troubleshooting.md
```

Reference from SKILL.md: `See [references/api.md](references/api.md)`

### Scripts Directory

Executable code for deterministic operations:

```
scripts/
├── validate.py
└── generate.sh
```

Claude can execute these directly without loading into context.

### Assets Directory

Files used in output (not loaded into context):

```
assets/
├── template.html
├── logo.png
└── boilerplate/
```

## Context Cost

Different extension types have different context footprints:

| Type | When Loaded | Approximate Cost |
|------|-------------|-----------------|
| Agent descriptions | Always (metadata only) | ~100 tokens each |
| Skill descriptions | Always (metadata only) | ~100 tokens each |
| Command descriptions | Always (metadata only) | ~50 tokens each |
| SKILL.md body | On skill activation | <5k words |
| Skill references | On explicit read | Varies |
| Agent instructions | On Task invocation | Full file |

Keep descriptions concise — they're always in context. Move detailed instructions to the body or references.

## Agent Teams

Agents can be composed into teams where a lead agent delegates to specialist subagents via the Task tool. Define each agent as a separate file and coordinate through prompts.

## Global vs Project

| Type | Global Location | Project Location | Behavior |
|------|-----------------|------------------|----------|
| Agents | `~/.claude/agents/` | `.claude/agents/` | Both available <!-- portability: allow --> |
| Commands | `~/.claude/commands/` | `.claude/commands/` | Both available <!-- portability: allow --> |
| Skills | `~/.claude/skills/` | `.claude/skills/` | Both available <!-- portability: allow --> |

When an agent, command, or skill with the same name exists at both levels, the project version likely shadows the global one (consistent with standard CLI conventions, though not explicitly documented).

## Creating Effective Descriptions

The `description` field is crucial - it determines when Claude activates an agent or skill.

**Good descriptions:**
- State what it does AND when to use it
- Include specific trigger words
- Mention file types, tools, or contexts

```yaml
description: Create semantic versioned releases with AI-generated changelog. Use when the user wants to create a new release, cut a release, bump version, update changelog, or publish a new version.
```

**Poor descriptions:**
- Too vague: "Helps with releases"
- Missing triggers: "Manages version numbers"
