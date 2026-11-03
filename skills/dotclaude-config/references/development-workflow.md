# Two-Clone Development Workflow

Keep the global config dir in git without developing in it. Two independent clones of the same remote, both on `main`:

| Clone | Branch | Role |
|-------|--------|------|
| `~/code/<repo>` | `main` + feature branches | Development: branches, commits, PRs |
| `~/.claude` | `main` only | Deploy target: Claude Code reads it, it only fast-forwards <!-- portability: allow --> |

Every session reads the deploy clone, so a half-finished branch there would reach all of them. Splitting the clones keeps unmerged work out of the runtime, and makes deploying one operation: fast-forward the deploy clone to `origin/main`. A `SessionStart` hook that does this, and never blocks when offline or diverged, makes merged PRs live at the next session.

Three things make it hold up:

- **Gitignore the runtime.** Session history, caches, logs and `settings.json` stay untracked, so the fast-forward never meets local drift. Track a `settings.example.json` for the shareable shape.
- **Symlink skills under development.** Point `~/.claude/skills/<name>` at the dev checkout to test a branch live, and have the deploy step remove those links. <!-- portability: allow -->
- **Guard the deploy clone.** A `pre-commit` hook there that refuses commits keeps it fast-forward-only.

One working implementation, with setup, the deploy script, the skill symlink flow and recovery: [docs/development.md](https://github.com/fairchild/dotclaude/blob/main/docs/development.md) in fairchild/dotclaude.
