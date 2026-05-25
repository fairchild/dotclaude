---
priority: 2
timeout: 2d
arc: backlog-roadmap-dogfood
---

# Agent Inbox: Shared Cross-Worktree Location

## Problem

The `agent-inbox` skill stores messages under `.agents/inbox/` relative to the current working directory. In a multi-worktree setup (Conductor workspaces, git worktrees), each worktree has its own inbox tree — agents in different worktrees can't reliably reach each other.

Symptom (surfaced 2026-05-24): `austin-v3` agent received a message from `lagos-v2-reflector` only because the reflector wrote into `lagos-v2/.agents/inbox/`. To find it, `austin-v3` had to search likely sibling worktree directories. The reply had to be written back into `lagos-v2/`'s inbox tree because that's where `lagos-v2-reflector`'s `reply_to` pointed. Mailboxes are effectively bound to whichever worktree first created them — no shared discovery, no symmetry.

## Goal

Inbox lives at a per-repo shared filesystem location, reachable from any worktree of the same repository. Existing skill API (write to `tmp/`, atomic mv to `new/`, archive after read) unchanged.

## Design lean

Use `git rev-parse --git-common-dir` to resolve the repository's common git dir, then place the inbox alongside it. For a normal clone, this is `<repo>/.git/`; for a worktree, it points to the main repo's `.git/`. Inbox lives at `<git-common-dir>/../.agents/inbox/`.

Concretely, agents and hooks resolve their inbox root as:

```bash
inbox_root="$(dirname "$(git rev-parse --git-common-dir)")/.agents/inbox"
```

This gives:

- **Cross-worktree visibility within a repo** — all worktrees of the same clone see the same inbox tree.
- **Per-repo isolation** — distinct projects don't share an inbox.
- **No global config** — derived from git state alone.

Alternative considered: `~/.agents/inbox/<project>/`. Rejected because computing a stable project identifier is fragile and global config introduces a discovery problem.

## Phases

1. **Skill update.** Modify `~/.claude/skills/agent-inbox/SKILL.md`:
   - Describe the shared-location convention.
   - Replace `<cwd>/.agents/inbox/` references with the git-common-dir-derived path.
   - Show the resolution snippet so agents and humans can compute the path the same way.
2. **Hook scripts.** Update `scripts/check-inbox-hook.sh`, `scripts/inbox-startup.sh`, and `scripts/wake-parent.sh` to resolve the inbox via the snippet rather than scanning from `cwd`. Verify they still work when invoked from any worktree.
3. **Fallback for non-git contexts.** Skill must still degrade to `<cwd>/.agents/inbox/` when not inside a git repo (the snippet errors). Document the fallback.
4. **Migration.** Move existing inboxes into the new location and document the migration:
   - `~/code/dotclaude/.agents/inbox/` (the main clone's inbox) becomes the canonical home for the dotclaude repo.
   - Move stale lagos-v2 inboxes there: `mv lagos-v2/.agents/inbox/* <git-common-dir>/../.agents/inbox/`.
   - Decide whether to leave per-worktree `.agents/` dirs (as fallback) or delete them.
5. **Cross-reference sweep.** Update any skill that documents the inbox path: `cmux-orchestrator`'s Wake-on-Reply pattern, the `agent-inbox` README, and any test fixtures.

## Acceptance

- An agent in any worktree of the same repo can send a message to a peer agent without needing to know which worktree the peer lives in.
- Both agents see the same `.agents/inbox/` directory listing when scanning.
- Hook scripts find the inbox regardless of which worktree's `cwd` they're invoked from.
- Non-git directories (e.g., a scratch dir) still get a usable per-cwd inbox as fallback.
- Existing message format unchanged — old messages are readable after migration.

## Verification

```bash
# From austin-v3 worktree:
inbox=$(dirname "$(git rev-parse --git-common-dir)")/.agents/inbox
mkdir -p "$inbox/test-recipient/new"
echo "hello from austin-v3" > "$inbox/test-recipient/new/test.md"

# From lagos-v2 worktree (different cwd, same repo):
inbox=$(dirname "$(git rev-parse --git-common-dir)")/.agents/inbox
cat "$inbox/test-recipient/new/test.md"  # → "hello from austin-v3"

# Cleanup
rm "$inbox/test-recipient/new/test.md"
```

## References

- Today's exchange with `lagos-v2-reflector` (thread `backlog-worker-first-run-feedback`) demonstrated the friction.
- `~/.claude/skills/agent-inbox/SKILL.md`
- `~/.claude/skills/agent-inbox/scripts/{check-inbox-hook,inbox-startup,wake-parent}.sh`
- `git-worktree(1)` — `git rev-parse --git-common-dir` semantics.

---

- 2026-05-25T00:10:41Z advanced to=doing claimer=fairchild@blue branch=codex-agent-inbox-shared-root
- 2026-05-25T00:16:14Z progress | implemented repo-shared inbox root resolver, wired hooks, updated docs, and verified linked-worktree + fallback behavior in temp repos

---
- 2026-05-25T00:21:26Z advanced to=done
