---
name: fork
description: Fork the current session into a new worktree with context carried over. Use when you want to spin off work into a separate branch/worktree while preserving session context.
license: Apache-2.0
---

# Fork Session to Worktree

Fork the current session into a new git worktree, carrying context for continuity.

## Usage

```
/fork <branch-name>
```

## What It Does

1. **Summarizes current session** - captures what we're working on, decisions made, next steps
2. **Creates a handoff file** - writes context to a temp file
3. **Creates worktree** - runs `wt <branch> --context <file>`
4. **Opens editor** - new session starts with `.context/handoff.md` available

## Instructions

### Step 1: Get Branch Name

If the user didn't provide a branch name, ask:

> What should we name the new branch?

Use kebab-case, keep it descriptive but short (e.g., `fix-auth-bug`, `add-dark-mode`).

### Step 2: Generate Context Summary

Create a handoff document summarizing:

1. **Current Task** - what we're working on
2. **Progress** - what's been done so far
3. **Key Decisions** - important choices made
4. **Next Steps** - what the new session should tackle
5. **Relevant Files** - files we've been working with
6. **Open Questions** - unresolved issues

Use this template:

```markdown
# Session Handoff

## Current Task
{Brief description of what we're working on}

## Progress
- {What's been completed}
- {What's in progress}

## Key Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| {topic} | {choice} | {rationale} |

## Next Steps
1. {Immediate next action}
2. {Following action}

## Relevant Files
- `path/to/file.ts` - {why it matters}

## Open Questions
- {Unresolved question or blocker}

---
*Forked from session on {date}*
```

### Step 3: Create Worktree with Context

```bash
# Write handoff to temp file
HANDOFF=$(mktemp)
cat > "$HANDOFF" << 'EOF'
{generated handoff content}
EOF

# Create worktree with context
wt <branch> --context "$HANDOFF"
```

### Step 4: Confirm

Tell the user:

> Forked to worktree `<branch>`. The new session has context in `.context/handoff.md`.
>
> In the new session, start by reading the handoff:
> ```bash
> cat .context/handoff.md
> ```

## Example

```
User: /fork feature-dark-mode

Claude: I'll fork this session to a new worktree for the dark mode feature.

[Generates handoff summary of current work]
[Creates worktree with context]

Forked to worktree `feature-dark-mode` at:
  ~/.worktrees/myapp/feature-dark-mode

The new session has context in `.context/handoff.md`. When you start working
there, read it to pick up where we left off.
```

## Notes

- The handoff is a snapshot - it won't update if you continue working here
- Use `/chronicle` if you want persistent cross-session memory instead
- The new worktree runs setup scripts from `conductor.json` if present
