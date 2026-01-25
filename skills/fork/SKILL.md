---
name: fork
description: Fork the current session with context carried over. Use `/fork <branch>` for a new worktree or `/fork --local` for a new session in the current directory.
license: Apache-2.0
requires:
  - git-worktree  # uses `wt --context` for worktree creation (when not --local)
---

# Fork Session

Fork the current session, carrying context for continuity.

## Usage

```
/fork <branch>   # Fork to new worktree (requires git-worktree skill)
/fork --local    # Fork to new session in current directory
```

## Modes

### Worktree Mode (default)

`/fork <branch>` creates a new git worktree and opens it with context.

1. Generates context summary
2. Creates worktree via `wt <branch> --context <file>`
3. New session has `.context/handoff.md`

### Local Mode

`/fork --local` writes context to current directory for a parallel session.

1. Generates context summary
2. Writes to `.context/handoff.md` in current directory
3. User opens new terminal and runs `claude`

## Instructions

### Step 1: Determine Mode

Check the user's input:
- `/fork --local` → local mode (no worktree)
- `/fork <branch>` → worktree mode
- `/fork` (no args) → ask: "Branch name for new worktree, or `--local` for same directory?"

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

### Step 3: Write Handoff

**Worktree mode:**
```bash
HANDOFF=$(mktemp)
cat > "$HANDOFF" << 'EOF'
{generated handoff content}
EOF

wt <branch> --context "$HANDOFF"
```

**Local mode:**
```bash
mkdir -p .context
cat > .context/handoff.md << 'EOF'
{generated handoff content}
EOF
```

### Step 4: Confirm

**Worktree mode:**
> Forked to worktree `<branch>` at `~/.worktrees/repo/<branch>`.
> The new session has context in `.context/handoff.md`.

**Local mode:**
> Context written to `.context/handoff.md`.
> Open a new terminal in this directory and run `claude` to start a fresh session.
> The new session can read the handoff with: `cat .context/handoff.md`

## Examples

### Worktree Fork
```
User: /fork feature-dark-mode

Claude: I'll fork this session to a new worktree.

[Generates handoff summary]
[Runs: wt feature-dark-mode --context /tmp/handoff.md]

Forked to worktree `feature-dark-mode` at:
  ~/.worktrees/myapp/feature-dark-mode

The new session has context in `.context/handoff.md`.
```

### Local Fork
```
User: /fork --local

Claude: I'll prepare a handoff for a new session in this directory.

[Generates handoff summary]
[Writes to .context/handoff.md]

Context written to `.context/handoff.md`.

Open a new terminal here and run `claude`. The new session can pick up
context with: cat .context/handoff.md
```

## Notes

- **Requires**: `git-worktree` skill for worktree mode (not needed for `--local`)
- The handoff is a snapshot - it won't update if you continue working here
- Use `/chronicle` if you want persistent cross-session memory instead
- Worktree mode runs setup scripts from `conductor.json` if present
