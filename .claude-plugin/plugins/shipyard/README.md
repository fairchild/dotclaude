# shipyard

Three long-lived Claude Code sessions that divide the work of a repository between them. A **lead**
holds the queue, writes briefs, dispatches implementers and merges. A **reviewer** owns every fresh
review and re-check. Short-lived **implementers** write the code, each in its own worktree.

Each seat is one session per repository, open for as long as the work lasts, so the same reader
sees every pull request in sequence. No seat judges work it decided on or wrote: the lead cannot
review, and the reviewer cannot merge or push to an author's branch.

A seat is a session a person starts by typing `/shipyard:lead` or `/shipyard:reviewer`. All three
skills set `disable-model-invocation: true`, so a model never enters one mid-task.

## Requirements

- GitHub. The scripts use the GitHub REST API; no other forge is supported.
- `gh`, authenticated with `repo` scope for the repository under review. The lead also needs
  permission to merge there.
- `git` 2.35 or later, for `worktree`, `range-diff` and `--remerge-diff`.
- `python3`, which the compaction hook uses to build its JSON. Absent, the hook says nothing
  instead of failing.
- `bash` 3.2 is enough; `awk`, `sed` and `grep` are the POSIX ones. `jq` is optional and used only
  by `watch.sh --self-test`, which skips those cases without it.

## Install

```
/plugin install shipyard --marketplace fairchild/dotclaude
```

From a terminal, `claude plugin install` instead of `/plugin install`.

The plugin declares `dependencies` on the [`compaction` and `usage-meter`](../../../mods/README.md)
mods and does not vendor them: a seat reads its own context and usage windows through their tools,
and both already exist. A plugin with declared dependencies does not load without them, so an
install that cannot resolve both leaves shipyard unusable rather than degraded.

In a cloud environment the setup line in the main README's
[Cloud sessions](../../../README.md#cloud-sessions) installs all three with the bundle. The reviewer
seat was written with cloud sessions in mind: `gh pr` goes through GraphQL, which answers `403`
there, so [`posting.md`](skills/reviewer/references/posting.md) posts through REST everywhere.

## The reviewer seat

```
/shipyard:reviewer
```

[`scripts/watch.sh`](scripts/watch.sh) polls the repository and prints one line per pull request
that wants attention, in one of three states: `fresh` (no verdict on it at all), `recheck`
(verdicts exist, none for the current head), `retry` (the latest verdict for the current head is
`verification-incomplete`, so that review reached no conclusion). Rechecks and retries come before
freshes, oldest first within each group.

The seat takes them one at a time. For each, it records the base and head SHAs in full, cuts a
scratch worktree at the head, reads the diff against the surrounding code, and probes the claims
the pull request makes — for a testing claim, by mutating the line the test covers and requiring
the test to go red. It runs the repository's gate and tests, waits for CI, then posts findings
marked `blocking`, `deferrable` or `nit` as `file:line — problem and evidence — proposed fix`, with
one verdict line:

```text
VERDICT: approve | changes-needed | verification-incomplete — at <40-char head SHA> — <n> blocking, <n> deferrable, <n> nit
```

The last `VERDICT:` line on a pull request is the effective one, which is what lets a seat replace
a `verification-incomplete` once whatever it could not read becomes readable. A merge tool reads
the last line and the SHA on it.

A re-check covers only the delta since the last reviewed head and looks for blockers alone. The
head of each review is pinned under `refs/shipyard/<number>/head`, so the comparison survives a
force-push.

[`SKILL.md`](skills/reviewer/SKILL.md) is the contract.
[`posting.md`](skills/reviewer/references/posting.md) holds the review body, the checkpoint block
and the REST calls. [`lessons.md`](skills/reviewer/references/lessons.md) is what earlier seats
learned, numbered so a review can cite one.

## The lead seat

```
/shipyard:lead
```

The lead holds one queue in the repository's own tracker, writes a brief per item, cuts a worktree
per implementer and dispatches into it, then applies the review label and says nothing further
about the change — a reviewer given the lead's expectations tends to confirm them. It reads the
verdict, gives every blocking and deferrable finding a disposition, and merges once the verdict is
`approve`, its SHA is the current head, and the required checks are green on that head. The merge
names that head — `gh pr merge --match-head-commit`, or `PUT …/pulls/<n>/merge` with `sha` where
`gh pr` subcommands answer `403` — so a push landing in between stops it.

The lead writes no implementation code, posts no findings, and cannot overrule a verdict. A finding
it disagrees with goes back to the pull request as an argument, and the reviewer re-checks.

Merging is the only thing any seat does that changes a shared branch.
[`brief.md`](skills/lead/references/brief.md) is the brief's shape and four ways one goes wrong.

## Setup

```
/shipyard:setup
```

Once per repository, and again when its tooling changes. It detects the gate and test commands, the
required check names, the review venue and the label by running commands rather than reading them
out of files — a `404` from the branch-protection endpoint means rulesets, a workflow file names
jobs where GitHub reports checks. It writes `.claude/shipyard.md` in the repository under review,
creates the review label if there is none and reuses the existing name if there is one, then checks
the fit by running the seat's own scripts against the result.

It also covers the session wiring a seat needs to survive a compaction, including the
`autoCompactWindow` setting the plugin cannot set for itself.
[`detection.md`](skills/setup/references/detection.md) is each command and what its answer means.
This repository's own [`.claude/shipyard.md`](../../../.claude/shipyard.md) is a filled-in example.

## Configuration

Two values describe the machine a seat runs on and the account it runs as, so they live in the
plugin's `userConfig` (`/config`, or `claude plugin configure shipyard`):

| Value | Default | What it is |
| --- | --- | --- |
| `goal_tokens` | 300000 | the context a seat aims to stay under. Set the `compaction` mod's `goalTokens` and the `autoCompactWindow` setting to the same number; nothing propagates it for you, and the mod's report says when they disagree |
| `scratch_root` | `~/.worktrees/shipyard` | where a seat cuts scratch worktrees and keeps its resume file |

Everything repository-specific lives in one tracked file in the repository under review,
`.claude/shipyard.md`: the venue, the review label, the gate and test commands, the required check
names, the finding classes that are never deferrable, and the model-and-effort table.
[`project-template.md`](skills/reviewer/references/project-template.md) is the blank.

`userConfig` is scoped per user, not per repository, which is why a review label cannot live there.
One user's seats serve several repositories over time, and a repository has no standing to set
where worktrees are cut or how much context a session keeps.

A repository with no config file gets a working reviewer: conversation comments as the venue, no
label (so every open non-draft pull request), gate and test commands discovered from the
repository's own task runner, and required checks read from the head's check runs. Configuration
narrows and corrects that.

## The compaction hook

A seat outlives its context window, so it keeps a resume file: the queue, each open pull request
with the verdict and head SHA it binds to, and what the seat was mid-way through.
[`scripts/seat-resume.sh`](scripts/seat-resume.sh) names that file on `PreCompact`, with when it
was last written, and on `SessionStart`, where it also says the contents need re-checking.

The hook never writes the file; what belongs in one is what the seat knows. It keys off the file's
existence to tell a seat from an ordinary session, which is why both seats write theirs on taking
the seat rather than when they first need it, and why the hook is silent when the file is absent —
installed globally, it runs in every session on the machine. The file is keyed by the repository's
remote rather than the checkout, so a seat that moves to a second worktree keeps its state.

## Limits

- **Experimental, with one consumer.** No eval suite. The verdict grammar and the poll states are
  settled; the loop has not run unattended against a repository with many open pull requests.
- **The lead's merge is the only step that changes a shared branch.** It is gated on an `approve`
  verdict bound to the current head with green required checks, and naming the head stops a merge
  when the head moved — but a seat that merges is a seat with write access.
- **A fork head is reviewed from CI, not locally.** Running a repository's gate on a fork head
  executes a contributor's code on the machine the seat runs on, with its token in the environment.
  The seat records the gate as not run unless the config file opts a named fork in.
- **No forge but GitHub.** Everything goes through REST, which is what works in a cloud session.
  GraphQL is needed only to resolve a review thread, and that degrades to a reply when the token
  cannot do it.

## Skills and tiers

| Skill | Invoked as | Tier | What keeps it from stable |
| --- | --- | --- | --- |
| `lead` | `/shipyard:lead` | experimental | no eval, one consumer; the merge step has not run unattended for long |
| `reviewer` | `/shipyard:reviewer` | experimental | no eval, one consumer; little parses the verdict grammar yet |
| `setup` | `/shipyard:setup` | experimental | no eval, one consumer; the detection rules come from a handful of repositories |

Each tier is declared in its own `SKILL.md` frontmatter, which
`.github/scripts/validate-config.py` checks.

## No version, no `bin/`

`plugin.json` pins no `version`, matching the [mods](../../../mods/README.md): a GitHub install then
resolves to the commit SHA and `claude plugin update` follows `main`. A pinned version is compared
instead of the commit, so a change that kept the same version would reach the marketplace cache and
stop there.

Executables live in [`scripts/`](scripts/) and are reached through `${CLAUDE_PLUGIN_ROOT}`. A
`bin/` directory would make the plugin uninstallable on claude.ai and in Cowork.
