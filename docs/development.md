# Development

`~/.claude` and `~/code/dotclaude` are two independent clones of the same repo, both on `main`. One is for development, the other is the deploy target.

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` + feature branches | Development — branches, PRs |
| `~/.claude` | `main` | Deploy target — Claude Code reads this |

## Auto-Deploy

A `SessionStart` hook runs `hooks/dotclaude-deploy.sh`, which delegates to `scripts/deploy.sh`. On every session start it:

1. Removes dev symlinks (skills pointing back to `~/code/dotclaude`)
2. Fetches and fast-forwards `~/.claude` to `origin/main`
3. Reports what changed (silent when nothing did)

After merging a PR, the next session start picks it up automatically.

## Hook Boundaries

Passive event forwarders may observe lifecycle events, but they must not own
active lifecycle hooks. In particular, `WorktreeCreate` and `WorktreeRemove`
replace Claude Code's built-in worktree behavior; handlers for those events must
perform the worktree action and emit the expected result. Do not register the
WorkSpaces `event-forwarder.sh` on those events.

## Source Settings Boundaries

`settings.example.json` is the only settings file this repo tracks, and it is read
by people seeding a new machine rather than by Claude Code. It carries no machine-
or session-specific paths such as `.codex/worktrees/<id>/...`, no host-level detail,
and never a serialized `/Users/<name>` or `/home/<name>`. Commands in it stay stable
across machines — `~/.claude/skills/<skill>/scripts/<script>.sh`, or `$HOME` for
optional integrations such as Orca. Machine-local forwarders, such as the WorkSpaces
installer's hooks and status line, belong in the runtime file and are stripped from
the example.

Theme is a user preference. Keep the example's value conservative unless it is a
sensible default across machines.

## Skill Sources

Three origins coexist in `~/.claude/skills/`:

| Source | Tracked | Example |
|--------|---------|---------|
| **Git-tracked** | Yes | `chronicle/`, `release/`, `dotclaude-config/` |
| **Ecosystem-installed** | No | `capture-screens/` (from `npx skills install`) |
| **Dev symlinks** | No | Temporary, cleaned by deploy script |

Ecosystem-installed skills appear as untracked in `git status` — this is expected.

## Developing a Skill

```bash
# 1. Branch in dev clone
git -C ~/code/dotclaude checkout -b feat/my-skill main

# 2. Create skill
mkdir -p ~/code/dotclaude/skills/my-skill

# 3. Symlink for live testing
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# 4. Develop, test, commit in ~/code/dotclaude
# 5. Push, open PR, merge

# 6. Deploy (removes symlink automatically, pulls new code)
~/.claude/scripts/deploy.sh
```

## Runtime Config Changes

`settings.json` is **not tracked**. It is the live runtime file: Claude Code writes to it
(`/model`, `/config`), other apps rewrite their own hooks in it, and it is the only place an
`autoMode.environment` description of this machine's infrastructure can live — the classifier
reads `autoMode` from user or managed settings, never from a repository. Keeping that out of a
public repo is why the file is gitignored, and it also means app drift no longer dirties the
tree, so `deploy.sh` can fast-forward.

`settings.example.json` is the shareable shape: this repo's own hooks, permissions, plugins,
and defaults, with machine-specific forwarders and the environment block removed. Change it
when the shape changes, through a PR like any other file.

Never `cp ~/.claude/settings.json` into this repo. To seed a new machine, copy the example the
other way and fill it in:

```bash
cp ~/code/dotclaude/settings.example.json ~/.claude/settings.json
```

Everything else (new skills, workflow changes, doc updates) goes through feature branches and
PRs in `~/code/dotclaude` the same way.

## Gitignore

The runtime generates ~30k+ ephemeral files (session history, debug logs,
Chronicle blocks, caches, and the server-managed `remote-settings.json` cache).
The `.gitignore` covers all of them. When new runtime artifacts appear, add
patterns so `git -C ~/.claude status` stays clean.

## Rollback

```bash
rm -rf ~/.claude
git clone https://github.com/fairchild/dotclaude.git ~/.claude
```
