# Persona Memory: Technical Spec (v1)

## Scope

Implement Option A from the implementation options document:
- distributable Claude skill
- custom launcher for personality + memory context injection
- file-backed memory in `~/.ai-memory`
- session lifecycle consolidation hooks

## Primary Constraints

1. Keep v1 local-first and script-based.
2. Guarantee personality loading when using the launcher.
3. Fail open: memory failures must not block normal coding sessions.
4. Keep schema human-readable and easy to edit.

## Runtime Paths

### Skill Path (installed)

`<skill-dir>/skills/persona-memory/` or equivalent install location.

### Memory Path (runtime data)

`~/.ai-memory`

## Skill File Tree

```text
skills/persona-memory/
├── SKILL.md
├── scripts/
│   ├── bootstrap.ts
│   ├── launch-claude.sh
│   ├── memory-lib.ts
│   ├── remember.ts
│   ├── recall.ts
│   ├── consolidate.ts
│   ├── session-start.ts
│   └── session-end.ts
└── references/
    ├── personality-contract.md
    ├── memory-schema.md
    ├── scoring-and-promotion.md
    └── hook-setup.md
```

## Memory Layout

```text
~/.ai-memory/
├── profiles/
│   └── default/personality.md
├── blocks/
│   ├── user-profile.md
│   ├── preferences.md
│   ├── decisions.md
│   ├── active-threads.md
│   ├── relationships.md
│   └── projects/<project-key>.md
├── events/
│   └── memory-events.jsonl
├── index/
│   └── memory-index.json
├── runtime/
│   └── session-start/
└── snapshots/
```

## Script Contracts

## `bootstrap.ts`

Purpose:
- initialize `~/.ai-memory`
- create default profile + block files
- optionally install launcher symlink/copy into `~/.local/bin/claude-persona`

CLI:
- `bun bootstrap.ts`
- `bun bootstrap.ts --profile default`
- `bun bootstrap.ts --install-launcher`
- `bun bootstrap.ts --install-launcher --force`

Output:
- human-readable summary
- exits `0` on success, non-zero on fatal error

## `launch-claude.sh`

Purpose:
- run Claude with:
  - `--append-system-prompt` from `personality.md` + recall context
  - `--add-dir ~/.ai-memory`

Inputs:
- env:
  - `AI_MEMORY_HOME` (default `~/.ai-memory`)
  - `AI_MEMORY_PROFILE` (default `default`)
  - `AI_MEMORY_MAX_CONTEXT` (default `2200`)
  - `CLAUDE_BIN` (default `claude`)
- passthrough CLI args to Claude

Failure behavior:
- if recall generation fails, still launch Claude with personality
- if personality missing, launch Claude with warning

## `remember.ts`

Purpose:
- append candidate memory events to JSONL log

CLI:
- `bun remember.ts --type decision --content "..." --confidence confirmed`
- `echo '{"type":"decision","content":"..."}' | bun remember.ts`

Input fields:
- `type`: `fact | preference | decision | thread | relationship`
- `content`: string
- `confidence`: `confirmed | observed | inferred` (default `observed`)
- `source`: optional string
- `project_key`: optional string

Output:
- JSON summary of appended event

## `recall.ts`

Purpose:
- retrieve concise memory context from blocks

CLI:
- `bun recall.ts --cwd "$PWD" --format prompt`
- `bun recall.ts --query "oauth token refresh" --format json`

Options:
- `--cwd <path>`
- `--query <text>`
- `--format prompt|text|json` (default `text`)
- `--max-chars <n>` (default `2200`)

Output:
- formatted context or JSON payload

## `consolidate.ts`

Purpose:
- promote unprocessed memory events into block files
- dedupe and mark processed events

CLI:
- `bun consolidate.ts`
- `bun consolidate.ts --dry-run`
- `bun consolidate.ts --json`

Output:
- summary counts (`processed`, `promoted`, `duplicates`, `skipped`)

## `session-start.ts`

Purpose:
- hook helper: generate startup memory context and store runtime snapshot

Input:
- Claude hook JSON on stdin

Output:
- non-blocking hook result JSON (`continue: true`)

Side effect:
- write snapshot file to `~/.ai-memory/runtime/session-start/<session-id>.md`

## `session-end.ts`

Purpose:
- hook helper: run consolidation as sleep-time compute

Input:
- Claude hook JSON on stdin

Output:
- non-blocking hook result JSON (`continue: true`)

## Hook Integration

Global hook example:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ~/.claude/skills/persona-memory/scripts/session-start.ts"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ~/.claude/skills/persona-memory/scripts/session-end.ts"
          }
        ]
      }
    ]
  }
}
```

Behavior contract:
- hooks must never block session continuation for memory-only failures
- hooks should return quickly and degrade gracefully

## Personality Contract

Personality file:
- path: `~/.ai-memory/profiles/<profile>/personality.md`
- required sections:
  - name/role
  - goals
  - collaboration style
  - assertiveness policy (`low|medium|high`)
  - decision and escalation policy

Launcher behavior:
- personality contents always included in appended system prompt
- memory context appended after personality

## Error Handling

1. Missing memory directory: bootstrap/create automatically.
2. Corrupt JSONL line: skip line, continue processing.
3. Missing profile file: warn and continue.
4. Recall/consolidation failure: do not block Claude launch/session.

## Packaging and Distribution

Validation:
- `bun ~/.claude/skills/skills-manager/scripts/manage.ts validate ~/.claude/skills/persona-memory`

Package:
- `python ~/.claude/skills/skill-builder/scripts/package_skill.py ~/.claude/skills/persona-memory`

Install (repo mode):
- `npx skills add <owner>/<repo> --skill persona-memory`

## Milestones

1. M1: Spec + skeleton + bootstrap + launcher.
2. M2: working remember/recall/consolidate path.
3. M3: hook integration and persona profile examples.
4. M4: validation and distributable package artifact.
