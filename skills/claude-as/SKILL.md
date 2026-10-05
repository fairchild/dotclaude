---
name: claude-as
description: Run Claude Code under a different account with claude-as profiles. Use to launch a side agent on another account to spread usage, to find out which profile or account a session runs as, or to add, rename, repair or remove a profile. Triggers on claude-as, profile, account, login, CLAUDE_CONFIG_DIR, CLAUDE_AS_PROFILE.
argument-hint: "[profile] <task for a side agent>"
license: Apache-2.0
metadata:
  portability: machine-bound
  status: experimental
  experimental_reason: "New in this form: the profile layering has run on one machine with two accounts; side-agent launches are tested headless only."
---

# claude-as

`claude-as <name>` runs Claude Code signed in to the account of profile `<name>`. Each profile has its own login and usage budget. Skills, settings, hooks, memory and transcripts are shared with every other profile. Arguments after the name go to `claude` unchanged.

Paths below are relative to this skill's base directory.

When invoked with a task, run it as a side agent (see below). Use the named profile, or
`$CLAUDE_AS_PROFILE` when none is named; the first word is a profile only if `claude-as --list`
shows it. Report the result after checking it.

## Setup

Needs `bash`, `jq` and `claude` on PATH. Link the script onto your PATH once, from this skill's base directory:

```bash
ln -sfn "$(pwd)/scripts/claude-as" ~/.local/bin/claude-as
```

Built and used on macOS. Profiles and side agents also run on Linux; the browser mapping is macOS-only.

A new profile needs one interactive sign-in: run `claude-as <name>` in a terminal, then `/login`. An agent can't do this step. Ask the user.

## Which profile is this?

- `echo $CLAUDE_PROFILE` prints the current profile. Empty means plain `claude`.
- `claude-as --list` prints the profiles on this machine. `*` marks the default.

## Launch a side agent on another account

A side agent on another profile spends that account's usage instead of this one's. Launch it headless, in the background, from the directory it should work in:

```bash
claude-as <name> -p "<task>" --allowedTools "Read,Grep,Glob" > side.out 2> side.err
```

- Run it with the Bash tool's `run_in_background`. You are notified when it exits.
- Nobody is there to answer permission prompts. Grant only what the task needs: `--allowedTools` for named tools, or `--permission-mode acceptEdits` for edits. Give an editing agent its own worktree.
- `--output-format json` adds the session id and cost to the result. The output is one object, or a list of messages when the profile has `verbose` on. This reads both shapes:
  `jq 'if type == "array" then .[] | select(.type == "result") else . end | {session_id, total_cost_usd, result}'`
- If the profile isn't signed in, the run fails. Ask the user to sign in (see Setup).
- What the side agent reports is a claim. Check its work before you rely on it.

For an interactive side agent, start `claude-as <name>` instead of `claude` in whatever terminal it gets: a tmux pane, a new tab, or a terminal-managing skill.

## Default profile

With no name, `claude-as` uses `$CLAUDE_AS_PROFILE`. If that variable is unset or empty, it runs plain `claude`. A first argument that starts with `-` means no name was given. Use `--` when the first argument for `claude` isn't a flag:

```bash
claude-as -p "<task>"                    # $CLAUDE_AS_PROFILE, or plain claude
claude-as -- "<task>"                    # same, with a prompt as the first argument
CLAUDE_AS_PROFILE= claude-as -p "<task>" # plain claude, whatever the default is
```

Every launch clears the profile variables it inherited. A side agent started from inside a profile session gets only the profile it was asked for.

Plain `claude` started from inside a profile session inherits `CLAUDE_CONFIG_DIR` and runs as that profile. To reach the plain account from a profile session, use `CLAUDE_AS_PROFILE= claude-as`.

## Manage profiles

`claude-as --help` documents adding, renaming, removing and repairing profiles (`--link-only`). `claude-as --guide` opens the illustrated version. Read one of them before you change a profile folder.

## Where things live

- This skill is the tooling: `scripts/claude-as`, `profile.md` and `guide.html`. It contains nothing specific to one person.
- Each person's layers live in `$CLAUDE_PROFILES` (default `~/.config/claude-profiles/`), outside this repo. That folder holds an optional `profile.md` and a `<name>/` folder per profile with `CLAUDE.md` and `settings.json`.
- `profile.md` reaches Claude two ways, both on purpose. Its browser rules must hold in every profile session, so each profile's built `CLAUDE.md` imports it. This skill loads only when triggered. Keep both routes.
