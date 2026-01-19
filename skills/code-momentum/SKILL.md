---
name: code-momentum
description: |
  Keep ~/code projects moving forward with bulk git operations. Use when projects
  are behind remote, have stale forks, or need batch dependency updates.
  Complements /project-health for discovery.
license: Apache-2.0
---

# Code Momentum

Keep your projects moving forward.

## Usage

```
/code-momentum             # Interactive: check health, offer actions
/code-momentum pull        # Pull all behind repos
/code-momentum deps        # Update deps across selected projects
/code-momentum forks       # Sync forks with upstream
```

## Workflow

### Step 1: Discover

Run the discovery script to get current status:

```bash
~/.claude/skills/code-momentum/scripts/discover.sh
```

### Step 2: Identify Issues

From the output, categorize projects by STATUS:

| Status | Meaning | Can Pull? |
|--------|---------|-----------|
| clean | No changes | Yes |
| untracked | Only untracked files | Yes |
| dirty (N) | N modified/staged files | No - stash first |

And by REMOTE:

| Remote | Action |
|--------|--------|
| N behind | `pull` |
| N ahead | Push when ready |
| N↑ M↓ | Diverged - manual resolution |

### Step 3: Offer Actions

Use AskUserQuestion to let user choose:

```
Based on your projects:
- 3 repos are behind (beads, better-auth, superpowers)
- 2 have uncommitted changes (jrnlfish-v4, planventura)

What would you like to do?
[ ] Pull behind repos (clean ones only)
[ ] Stash dirty repos first, then pull
[ ] Sync forks with upstream
[ ] Update dependencies
```

### Step 4: Execute

For detailed workflows, see [references/actions.md](references/actions.md).

**Pull behind repos:**
```bash
for project in $selected; do
  cd ~/code/$project
  git pull --ff-only
done
```

**Sync forks:**
```bash
for project in $forks; do
  cd ~/code/$project
  git fetch upstream
  git merge upstream/main --ff-only
  git push origin main
done
```

### Step 5: Report

Show summary of what changed AND what's still pending:

```
Pulled 2 repos:
  - beads: 584 commits
  - superpowers: 12 commits

Skipped 2 (dirty):
  - jrnlfish-v4 (1 modified)
  - planventura (1 modified)

Still pending:
  - jrnlfish-v4: dirty, needs stash or commit
  - planventura: dirty, needs stash or commit
```

Always show "Still pending" if any repos need attention after the action.

## Safety Rules

- **Never force push**
- **Skip dirty repos** (modified files) - untracked files are OK
- **Only --ff-only merges** - no merge commits
- **Confirm before bulk ops** - show what will happen first
- **Stop on errors** - don't continue if one repo fails
- **Always show pending** - report what still needs attention

## Quick Commands

| Subcommand | Effect |
|------------|--------|
| (none) | Interactive mode |
| `pull` | Pull all clean repos that are behind |
| `forks` | Sync forks with upstream |
| `deps` | Run /update-dependencies across projects |
| `stash` | Stash all dirty repos |
| `status` | Just show status, no actions |
