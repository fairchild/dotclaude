# Development

`~/.claude` and `~/code/dotclaude` are two independent clones of the same repo, both on `main`. Development happens in one; Claude Code reads the other, which only ever fast-forwards to `origin/main`. No worktrees, no branch syncing, no cherry-picks.

| Path | Branch | Role |
|------|--------|------|
| `~/code/dotclaude` | `main` + feature branches | Development — branches, PRs |
| `~/.claude` | `main` | Deploy target — Claude Code reads this |

## Setup

From a clone at `~/code/dotclaude`:

```bash
mise run bootstrap   # create or reconcile the ~/.claude clone
mise run doctor      # read-only check of the result
```

`bootstrap` clones `origin` into `~/.claude` on `main` and seeds `settings.json` from `settings.example.json`. When `~/.claude` is already an independent clone it fast-forwards it instead. Anything else at that path (a plain directory, a symlink) is moved to `~/.local/share/dotclaude/migration-backups/` first, and its runtime data (sessions, memory, `settings.json`) stays there until you copy it back. It refuses to touch a git worktree; see [Rollback and recovery](#rollback-and-recovery). `bash setup.sh` runs the same bootstrap after installing mise, the runtimes, and Claude Code.

`doctor` checks that `~/.claude` is an independent clone on `main` with no tracked drift, matches the last fetched `origin/main`, has a valid `settings.json`, and has the skill links `dotagents.toml` declares. `mise run sync` is the strict fast-forward: it refuses on any tracked or unignored drift, where `deploy.sh` warns and tries anyway.

Close every Claude Code session before moving `~/.claude`; a running one may recreate it.

## Auto-Deploy

A `SessionStart` hook, listed first in `settings.example.json` so later hooks see current code, runs `hooks/dotclaude-deploy.sh`, which delegates to `scripts/deploy.sh`. On every session start it:

1. Removes dev symlinks — those under `~/.claude/skills/` whose target is in `~/code/dotclaude`
2. Installs a `pre-commit` hook in `~/.claude` that refuses commits (skipped when `core.hooksPath` is set, since that directory may be shared), and warns about local commits or tracked files edited in place
3. Fetches and fast-forwards `~/.claude` to `origin/main`
4. Reports new commits, and lists skills present on disk but neither tracked nor ignored

It is silent when nothing changed. Offline, or when local changes block the fast-forward, it prints git's reason and exits 0, so session start never waits on it. Output is appended to `~/.claude/deploy.log`, rotated at 100 KB. Run `~/.claude/scripts/deploy.sh` by hand after merging if you don't want to wait for the next session.

## Developing a Skill

A skill is live only at `~/.claude/skills/<name>`, so during development a symlink there points at the checkout that holds the branch.

New skill:

```bash
git -C ~/code/dotclaude checkout -b feat/my-skill main
mkdir -p ~/code/dotclaude/skills/my-skill
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# develop, test, commit, push, PR, merge
~/.claude/scripts/deploy.sh   # removes the symlink, pulls the merged skill
```

Existing skill — the symlink replaces the tracked copy, so put it back afterwards:

```bash
git -C ~/code/dotclaude checkout -b feat/improve-my-skill main
rm -rf ~/.claude/skills/my-skill
ln -s ~/code/dotclaude/skills/my-skill ~/.claude/skills/my-skill

# develop, test, commit, push, PR, merge
~/.claude/scripts/deploy.sh
git -C ~/.claude restore skills/my-skill
```

The fast-forward rewrites only files the merge changed; `restore` brings back the rest. Until then a symlink at `~/.claude/skills/foo` shadows the tracked `skills/foo` in every session.

The symlink can point at any checkout of the branch — the dev clone, a worktree under `~/.worktrees/dotclaude/<branch>/`, or a Conductor/Orca session root. `deploy.sh` only removes links into `~/code/dotclaude`, so remove the others yourself with `rm ~/.claude/skills/<name>`.

Deleting a skill is an ordinary PR that deletes its directory; the next deploy pulls the deletion.

## Skill Sources

Three origins coexist in `~/.claude/skills/`:

| Source | Tracked | Example |
|--------|---------|---------|
| **Git-tracked** | Yes | `chronicle/`, `release/`, `dotclaude-config/` |
| **Ecosystem-installed** | No | Symlinks into `~/.agents/skills/` from `npx skills add` |
| **Dev symlinks** | No | Temporary, cleaned by deploy script |

Ecosystem-installed skills not listed in `skills/.gitignore` show up as untracked in `git status` and in `deploy.sh`'s untracked-skills line — this is expected.

## Runtime Config Changes

`settings.json` is **not tracked**. It is the live runtime file: Claude Code writes to it
(`/model`, `/config`), other apps rewrite their own hooks in it, and it is the only place an
`autoMode.environment` description of this machine's infrastructure can live — the classifier
reads `autoMode` from user or managed settings, never from a repository. Keeping that out of a
public repo is why the file is gitignored, and it also means app drift never dirties the tree,
so `deploy.sh` can fast-forward.

`settings.example.json` is the shareable shape: this repo's own hooks, permissions, plugins,
and defaults, with machine-specific forwarders and the environment block removed. Change it
when the shape changes, through a PR like any other file.

Never `cp ~/.claude/settings.json` into this repo. To seed a new machine by hand, copy the
example the other way and fill it in (`bootstrap` does this when `settings.json` is missing):

```bash
cp ~/code/dotclaude/settings.example.json ~/.claude/settings.json
```

Everything else (new skills, workflow changes, doc updates) goes through feature branches and
PRs in `~/code/dotclaude` the same way.

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

## Hook Boundaries

Passive event forwarders may observe lifecycle events, but they must not own
active lifecycle hooks. In particular, `WorktreeCreate` and `WorktreeRemove`
replace Claude Code's built-in worktree behavior; handlers for those events must
perform the worktree action and emit the expected result. Do not register the
WorkSpaces `event-forwarder.sh` on those events.

## Pre-commit Hooks

`prek.toml` configures [prek](https://prek.j178.dev) for the dev clone: `no-commit-to-branch` blocks commits to `main`, `check-json`/`check-yaml`/`check-toml` validate syntax, and `backlog-dep-validation` rejects backlog tasks whose `dependencies:` don't resolve. Neither mise nor `setup.sh` installs it:

```bash
brew install prek    # or: cargo install prek, uv tool install prek
prek install         # in ~/code/dotclaude
prek run --all-files
```

A commit made on `main` before the hooks were installed moves to a branch with `git branch feat/my-work && git reset --hard origin/main && git checkout feat/my-work`.

## Gitignore

The runtime generates thousands of ephemeral files: session history, debug logs, Chronicle
blocks, caches, `deploy.log`, and the server-managed `remote-settings.json` cache. `.gitignore`
covers them; when a new runtime artifact appears, add a pattern so `git -C ~/.claude status`
stays clean.

## Rollback and Recovery

A bad merge rolls back like any other change: revert it with a PR, and the next session start deploys the revert.

A broken `~/.claude` clone gets replaced, keeping the gitignored runtime data (sessions, memory, `settings.json`) that a fresh clone lacks:

```bash
mv ~/.claude ~/.claude-backup
git clone https://github.com/fairchild/dotclaude.git ~/.claude
rsync -a --ignore-existing --exclude=.git ~/.claude-backup/ ~/.claude/
```

The same three steps convert an old install where `~/.claude` is a git worktree of the dev clone, followed by `git -C ~/code/dotclaude worktree prune` to drop the stale registration. Move the directory rather than running `git worktree remove`, which deletes it along with that data.
