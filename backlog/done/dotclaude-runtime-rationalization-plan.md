---
topic: dotclaude-runtime
status: done
priority: 1
description: Rationalize ~/.claude, ~/code/dotclaude, and ~/.agents into a single-authority, multi-agent-compatible workflow.
completed: 2026-03-22
pr: "#129, #131, #132, #133"
branch: feat/two-clone-workflow
retro_summary: Replaced worktree+cherry-pick model with two independent clones on main — eliminated entire class of sync bugs.
---

# Dotclaude Runtime Rationalization

## Problem Statement

Configuration ownership is currently split across two git working copies of the same repository: `~/.claude` and `~/code/dotclaude`. This creates drift risk, ambiguous source of truth, and accidental commits from the runtime directory. At the same time, `~/.claude/skills` contains a mixture of real directories and symlinks to multiple sources (`~/.agents`, worktrees, and generated outputs), which makes multi-agent sharing harder to reason about.

The goal is to establish a stable model where `~/code/dotclaude` is the development source, `~/.agents` is canonical for cross-agent shared assets (especially skills), and `~/.claude` is a runtime mount plus ephemeral state only. This enables consistent skill reuse across agents while preserving an ergonomic Claude Code runtime.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Source of truth for versioned Claude config | `~/code/dotclaude` only | Avoid dual-authority drift and conflicting git histories |
| Source of truth for shared multi-agent assets | `~/.agents` | Portable across tools; matches skills package canonical model |
| Runtime role of `~/.claude` | Deployment/runtime state, mostly symlinks + ephemeral data | Keeps agent runtime writable without polluting git |
| Skill linking model | `~/.claude/skills/<name>` symlink to `~/.agents/skills/<name>` by default | Ensures shared skills are consumed consistently across agents |
| Temporary skill development workflow | Override symlink to `~/code/dotclaude/skills/<name>` or worktree path | Fast iteration without breaking default shared baseline |

## Architecture

```text
                 git commits/PRs
      ┌────────────────────────────────┐
      │      ~/code/dotclaude          │
      │  (versioned Claude config)     │
      └───────────────┬────────────────┘
                      │ sync runtime-managed files
                      ▼
      ┌────────────────────────────────┐
      │          ~/.claude             │
      │  (runtime + ephemeral state)   │
      │  settings/hooks/commands live  │
      │  session data local-only       │
      └───────────────┬────────────────┘
                      │ symlinked skills/prompts
                      ▼
      ┌────────────────────────────────┐
      │           ~/.agents            │
      │  canonical shared skills,      │
      │  prompts, references, templates│
      └────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Capture current state and preserve safety

**Files to modify:**
- `backlog/dotclaude-runtime-rationalization_plan.md` - Track plan and evidence

**Files to create:**
- `scripts/sync-runtime.sh` - deterministic sync from `~/code/dotclaude` to `~/.claude` (future)
- `docs/runtime-architecture.md` - ownership and lifecycle rules (future)

**Acceptance criteria:**
- [ ] Snapshot current `~/.claude` git state and uncommitted changes before refactor
- [ ] Confirm both repos currently point to `https://github.com/fairchild/dotclaude.git`
- [ ] Confirm `~/.claude/skills` includes mixed directory/symlink sources

### Phase 2: Remove dual-authority git workflow

**Files to modify:**
- `~/.claude` runtime root (operational change, not repo code)

**Files to create:**
- `docs/migration-runtime-only.md` - one-time migration steps and checks (future)

**Acceptance criteria:**
- [ ] Preserve any desired local runtime changes from `~/.claude`
- [ ] Remove git coupling from `~/.claude` (treat as non-repo runtime)
- [ ] Confirm all future commits are made from `~/code/dotclaude` only

### Phase 3: Normalize skill and prompt linking

**Files to modify:**
- `~/.claude/skills/*` - convert to symlinks to canonical shared source where appropriate

**Files to create:**
- `scripts/link-shared-assets.sh` - idempotent linker for `skills/` and optionally `prompts/`

**Acceptance criteria:**
- [ ] Default skills in `~/.claude/skills` point to `~/.agents/skills`
- [ ] Dev override workflow documented (`~/.claude/skills/<name> -> ~/code/dotclaude/skills/<name>`)
- [ ] Broken symlinks are detected and reported

### Phase 4: Operationalize and enforce

**Files to modify:**
- `CLAUDE.md` - update strategy language to reflect runtime/development separation
- `README.md` - clarify `~/.agents` role in multi-agent ecosystem
- `.gitignore` - ensure runtime-only files are never tracked

**Files to create:**
- `scripts/check-runtime-health.sh` - validates expected symlink and ownership topology

**Acceptance criteria:**
- [ ] One-command sync + link workflow exists
- [ ] Health script verifies topology and exits non-zero on drift
- [ ] Documentation defines “single authority per asset type” rule

## Verification Commands

```bash
# 1) Confirm current dual-repo state (today's observed risk)
git -C ~/.claude rev-parse --is-inside-work-tree
git -C ~/.claude remote -v
git -C ~/code/dotclaude remote -v

# 2) Inspect mixed skills topology
find ~/.claude/skills -maxdepth 1 -mindepth 1 -print0 \
  | xargs -0 -I{} stat -f '%N -> %Y (%HT)' '{}' \
  | head -n 80

# 3) Verify shared canonical layer exists
ls -la ~/.agents
find ~/.agents -maxdepth 2 -type d | head -n 60

# 4) After migration, verify runtime no longer a git repo
git -C ~/.claude rev-parse --is-inside-work-tree || echo "~/.claude is runtime-only"

# 5) Verify all commits come from dev clone
git -C ~/code/dotclaude status --short -b
```

## Rollback Plan

1. Restore `~/.claude` from backup (`~/.claude-backup-*` or `~/.claude.zip`) if runtime migration breaks behavior.
2. Recreate previous skill directories/symlinks from backup snapshot.
3. If needed, temporarily re-enable `~/.claude` as a git working copy by recloning `fairchild/dotclaude` into `~/.claude`.
4. Re-run verification commands and compare against pre-migration snapshot.

## Research Artifacts

Observed during exploration:

- `~/.claude` and `~/code/dotclaude` both have `origin` set to `https://github.com/fairchild/dotclaude.git`.
- `~/.claude` currently has uncommitted changes and divergent skill state (`M`, `D`, and untracked paths).
- `~/.claude/skills` is heterogeneous:
  - symlinks to `../../.agents/skills/*` for several skills
  - local directories for many skills
  - symlinks to other development paths (e.g., worktree and generated output)
- Canonical shared asset layer exists at `~/.agents` with:
  - `skills/`, `prompts/`, `references/`, `templates/`
  - intent documented in `~/.agents/README.md`

## References

- `CLAUDE.md` (dotclaude development workflow, symlink guidance)
- `README.md` (install/update and skill architecture context)
- `~/.agents/README.md` (canonical cross-agent assets statement)
- https://skills.sh/
