# dotclaude

My working `~/.claude/` configuration for Claude Code. Published for reference — not designed as a drop-in clone.

## What I'm Exploring

Treating each session as worth remembering. [Chronicle](skills/chronicle/) journals every session and brings the relevant context back at the next one; the rest of the memory work is still evolving.

Giving a session the instruments to manage itself. The two [mods](#mods) below run inside the engine: one answers how much of the account's usage is left, the other lets the thread choose when to compact and say what the summary must keep. Both install in one line.

## Drawing from This

This config is personal — `CLAUDE.md` holds my preferences and hooks call my Chronicle scripts. To draw from it, cherry-pick rather than clone.

**Copy directly** (self-contained):
- `settings.example.json` permissions pattern (allow/ask/deny tiers)
- Individual commands or skills (each is a standalone directory)

**Customize first:**
- `CLAUDE.md` — personal identity and tool preferences
- `settings.example.json` hooks — these call Chronicle scripts; remove or replace with your own session lifecycle

**Prerequisites for the full config:**
- `bun` — hooks and scripts are TypeScript
- `jq` — statusline payload parsing
- `git` — core operations
- Optional: `uv` (Python), `mise` (runtimes)

Project-level `.claude/` directories override global settings. See Claude Code docs for the merge behavior.

## Directory Structure

```
~/.claude/
├── CLAUDE.md          # Personal context (name, preferences, tool choices)
├── settings.example.json  # Permissions, hooks, model selection (the live
│                          # settings.json is machine-local and gitignored)
├── skills/            # Skills — tiered stable / experimental / local (see below)
├── commands/          # Slash commands (/bootstrap, /reflect)
├── agents/            # Specialized autonomous agents
├── hooks/             # Session lifecycle scripts
├── scripts/           # Runtime contract (bootstrap, sync, doctor) and catalog
├── dotagents.toml     # Manifest of ecosystem skills linked from ~/.agents
├── backlog/           # Markdown issue tracker (todo/doing/done) + ROADMAP.md
├── chronicle/         # Chronicle session memory
├── mods/              # Claude Code mods (usage-meter, compaction)
├── mcp/               # Skill server: serves these skills over MCP
├── .claude-plugin/    # Marketplace manifest + multi-component plugins (shipyard)
├── webui/             # Config Visualizer dashboard
├── docs/              # Agent-skill config and development notes
├── blog/              # Writing about this config
└── [session data]     # Gitignored: history, todos, plans, caches, etc.
```

## Quick Reference

Every first-party skill sits in one of four tiers, declared in its `SKILL.md` frontmatter and rendered here by `mise run catalog` (CI fails when this block drifts from the frontmatter):

| Tier | Declared by | Meaning |
|------|-------------|---------|
| stable | no `metadata.status` | Has an eval or sustained use; safe to auto-invoke |
| experimental | `metadata.status: experimental` + `experimental_reason` | Usable, with a stated reason it hasn't graduated |
| superseded | `metadata.status: superseded` + `superseded_reason` | Replaced by something else; kept and reachable as `/name` |
| local | listed in `skills/.gitignore` | Lives in `~/.claude` only; never published |

Ecosystem skills (installed by `npx skills` from other repos) are symlinked in from `~/.agents/skills/` per [`dotagents.toml`](dotagents.toml) and aren't listed here.

<!-- catalog:start -->
### Skills — stable, auto-invoked

Claude loads these when the task matches the description.

| Skill | Domain |
|---|---|
| `agent-inbox` | File-based messaging between agents across tools. |
| `analyze-usage` | Analyze local AI coding-assistant activity across Claude Code, Codex, Cursor, and Pi. |
| `backlog` | Markdown task backlog and project roadmap (backlog/{todo,doing,done,failed}/, backlog/ROADMAP.md) for adding,… |
| `chronicle` | Session continuity for coding work. |
| `dotclaude-config` | Work with Claude Code configuration at global (~/.claude) or project (.claude/) level. |
| `dotfiles-checkup` | Check this machine's dotfiles against the public repo and bring them back to clean. |
| `fable-session` | Hand off long-arc work to a fable session — an Opus 5.5 orchestrator at xhigh effort verifies while delegating the… |
| `gh-apps` | Create, authenticate, and manage GitHub Apps. |
| `git-worktree` | Manage Git worktrees for concurrent local development. |
| `image-gen` | Generate images from prompts using AI APIs (OpenAI GPT Image, Google Gemini/Nano Banana, Google Imagen, fal.ai Flux). |
| `project-scripts` | Standardize project lifecycle scripts (setup, run, stop, archive) in scripts/ so agents can manage workspaces through a… |
| `session-titles` | Session title generation, evaluation, and optimization. |
| `signoz-log` | Send structured logs to SigNoz observability platform. |
| `skills-manager` | Use when the user wants to list, search, install, remove, inspect, validate, audit, or update skills. |
| `swiftui-expert` | Write, review, or improve SwiftUI code. |
| `tight-docs` | Use this when a coding agent writes or revises a design doc, a security review, or an ADR (an architecture decision… |
| `update-dependencies` | Smart dependency updates across ecosystems (npm/bun/pnpm, uv/poetry, cargo). |
| `webapp-testing` | Interact with and test web applications using Playwright. |

### Skills — stable, invoked by slash command

`disable-model-invocation: true` — run as `/name`; Claude will not load them on its own.

| Skill | Domain |
|---|---|
| `/brainstorm-to-brief` | Wide→Narrow design workflow taking UI/UX concepts from exploration to polished design brief. |
| `/canon-printer` | Check status, ink levels, job queue, cancel stuck jobs, print files and rendered documents, track loaded paper, and… |
| `/codespaces` | Manage GitHub Codespaces lifecycle via gh CLI. |
| `/excalidraw-diagrams` | Create diagrams and visual artifacts using Excalidraw with real-time canvas preview. |
| `/fork` | Fork the current session with context carried over. |
| `/macos-agent-pressure` | Diagnose live macOS memory, swap, load, and concurrent AI-agent process pressure. |
| `/release` | Create semantic versioned releases with AI-generated changelogs, for repos that do not already have a release pipeline… |
| `/skill-building` | Guide for creating, editing, and evaluating skills. |
| `/team-memory` | Persistent AI teammate memory framework. |
| `/tidyup` | Proof-based sweep of a repo's accumulated worktrees, stale local branches, and in-flight PRs — reduces open threads to… |
| `/web-artifacts-builder` | Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologies… |
| `/youtube-content` | Extract and analyze YouTube video content (transcripts + metadata). |

### Skills — experimental

`metadata.status: experimental` in frontmatter. Usable, and the reason each one hasn't graduated is stated in `metadata.experimental_reason`.

| Skill | Domain | Why experimental |
|---|---|---|
| `arc-handoff` | Hand off an arc of work on its tracking issue, or pick up an arc another session left. | Generalised from a handoff skill in the user's other repositories; no eval yet. |
| `ascii-art-fix` | Fix misaligned right borders in ASCII art diagrams | Prompt-only repair is useful but still has edge cases around nested diagrams, tables, and mixed markdown content. |
| `claude-as` | Run Claude Code under a different account with claude-as profiles. | New in this form: the profile layering has run on one machine with two accounts; side-agent launches are tested headless only. |
| `cloudflare-workers-deploy` | Set up Cloudflare Workers deployment for web applications with GitHub Actions CI/CD. | Deployment patterns are useful but not yet validated across enough project shapes and Cloudflare account setups. |
| `compaction-handoff` | Prepare a long-running session for compaction and pick the work up after it — write durable state before the cut, ask… | Generalised from a handoff practice in the user's other repositories, used across many cuts there; no eval in this repo. |
| `consequential-check` | Route a pull request to its owner when merging it is consequential — hard to undo, weakens security, costs money, makes… | Not yet installed on a repository. The rubric, the per-question lines, and the 0.1 escalation margin are starting values with no tuning data behind them, and the lines were set for a Claude model before Jev decided. |
| `copy-review` | Review or rewrite a README, a docs page or a landing page so it informs a newcomer fast — what it is, how to install… | Written from one review of two repositories' READMEs and docs sites before their public release; no eval yet. |
| `gondolin-ci` | Run one GitHub Actions suite for a pull request inside a disposable gondolin micro-VM on a Mac, and watch the steps… | It has run real suites for one repository on one laptop. Run time still tracks the laptop's load, and tokens reach the guest and the host side is unconfined until the design's Phases 2 and 3 land. |
| `ios-simulator` | Automate iOS Simulator tasks — capture screenshots, interact with apps, generate screen flow galleries. | Simulator automation remains sensitive to local device state, timing, window focus, and Xcode version differences. |
| `persona-memory` | Build and operate a persistent persona and memory framework for Claude Code. | Healthy framework, intentionally experimental until background memory agents and full interactive-session CI coverage exist. |
| `pr-closeout` | Own a pull request you opened from draft to ready to merge — CI green, every review finding given a disposition,… | Replaces the respond-to-pr-review command with closeout practice from the user's other repositories; no eval yet. |
| `repo-steward` | The repo steward role — one long-running session that owns the work in a single repository. | Two real runs so far (two repositories, 2026-09-07 and 09-08) and no eval in this repo. The boot sequence and the loop are an experiment in keeping a long-running session's context in the repo rather than in its head. |
| `retrospective` | Run a retrospective on a session, PR or milestone — find the mistakes that repeated, fix each at the strongest layer… | Replaces the session-scoring retro command; no eval yet. |
| `review-pr` | Review a pull request, yours before opening it or someone else's, then re-check each later push for blockers only, with… | Consolidates the old review-pr and code-review commands with practice from the user's other repositories; no eval yet. |
| `runner-optin` | Run one reviewed commit of one pull request on this laptop while hosted runners are blocked. | No eval and no invocations yet; the machinery it drives has never run against a real pull request. |
| `skill-seeker` | Generate Claude Code skills from docs sites, GitHub repos, or local codebases using Skill Seekers. | Generated skill quality varies by source corpus and still requires explicit human review before installation. |
| `vocal` | Speak text aloud (TTS) and transcribe speech (STT). | Voice workflows depend on local audio devices and optional ElevenLabs credentials, so reliability is environment-sensitive. |

### Skills — superseded

`metadata.status: superseded` in frontmatter. Something else does the job now; these stay on disk and reachable as `/name`, and `metadata.superseded_reason` says what replaced them.

| Skill | Domain | Superseded by |
|---|---|---|
| `/plain-writing` | Plain, direct writing voice — no undefined jargon, no throat-clearing, no showing off — for any prose a person reads… | A local voice skill that loads by default now carries its floor. |

### Commands

| Command | Purpose |
|---|---|
| `/bootstrap` | Bootstrap a new project with interactive brainstorming and structure generation |
| `/codex-review` | Run code review via Codex CLI with non-Claude models (GPT-5, o3, Ollama) |
| `/opensource-precheck` | Audit a private repo before making it public |
| `/project-health` | Review health of ~/code projects (git status, tests, remote sync) |
| `/reflect` | Pause to review work with fresh eyes for bugs, missed cases, or simplifications |

### Agents

| Agent | Use case |
|---|---|
| `ai-sdk-agent-architect` | Implement Vercel AI SDK 6 agents with streaming, tool orchestration, and reasoning visibility. |
| `chronicle-curator` | Curate and organize Chronicle memory blocks. |
| `chronicle-insights` | Deep exploration of Chronicle memory and worktrees to generate meaningful insights. |
| `devcontainer-setup` | Use this agent when you need to set up, configure, or verify a DevContainer environment for a project. |
| `github-notifications-triager` | Check GitHub notifications and provide a prioritized summary of important items. |
| `project-handoff-auditor` | Audit codebase quality, docs, tests, and deployment before client handoff. |
| `research` | Deep codebase exploration to understand a problem and create a research artifact |
| `team-memory-sleep` | Sleep-time compute orchestrator for team-memory skill. |
| `vocal-listener` | Background listener that records speech, transcribes it, and sends transcripts to the main session. |
<!-- catalog:end -->

## Install via Skills

```bash
# Install all skills
npx skills add fairchild/dotclaude

# Install a single skill
npx skills add fairchild/dotclaude --skill <skill-name>

# Check for updates and apply them
npx skills check && npx skills update
```

## Install as a plugin marketplace

This repository is a Claude Code plugin marketplace named `dotclaude` ([`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)). Install a plugin from it in one step, in a session or from a terminal (Claude Code 2.1.275 or later):

```
/plugin install usage-meter --marketplace fairchild/dotclaude
/plugin install compaction --marketplace fairchild/dotclaude
/plugin install brainstorm-to-brief --marketplace fairchild/dotclaude
/plugin install image-gen --marketplace fairchild/dotclaude
/plugin install dotclaude-config --marketplace fairchild/dotclaude
/plugin install release --marketplace fairchild/dotclaude
/plugin install skill-building --marketplace fairchild/dotclaude
/plugin install shipyard --marketplace fairchild/dotclaude
```

From a terminal, the same line starts with `claude plugin install`. The first install adds the marketplace to your user settings, and `/plugin` then lists everything it offers.

| Plugin | What it is |
|--------|------------|
| `usage-meter` | Mod: one tool that reads the five-hour and seven-day usage windows ([mods](mods/README.md)) |
| `compaction` | Mod: lets the main thread ask for `/compact` with instructions ([mods](mods/README.md)) |
| `brainstorm-to-brief`, `image-gen`, `dotclaude-config`, `release`, `skill-building` | The skills of the same name, from `skills/` |
| `shipyard` | The multi-seat development pattern: lead, reviewer and setup seats, plus a compaction hook ([plugins](.claude-plugin/plugins/shipyard/README.md)) |

- `claude plugin marketplace update dotclaude` pulls the latest `main`; `claude plugin marketplace add fairchild/dotclaude@<branch>` tries a branch instead.
- On a machine whose `~/.claude` is this repository, the skills in `skills/` are already there: install the mods and `shipyard`, which are plugins rather than loose skills and do not load from the source tree on their own.
- Mods load from user settings only. Declared in a repository's `.claude/settings.json` (`--scope project`), they don't load.
- A cloud environment gets the mods from the [Cloud sessions](#cloud-sessions) setup line, which installs them from the release bundle before the first session.

## Mods

A mod is a plugin whose hooks module runs inside the engine, so it can answer tools of its own and act between turns. `usage-meter` only observes; `compaction` answers its tools, runs `/compact` when the thread asks, and then submits a prompt to start the next turn. Neither makes a network, process or file-system call of its own. [`mods/`](mods/README.md) has the full rules.

```
/plugin install usage-meter --marketplace fairchild/dotclaude
/plugin install compaction --marketplace fairchild/dotclaude
```

From a terminal, `claude plugin install` instead of `/plugin install`. The first one adds the marketplace; both load in the session that installs them and in every session after.

In a setup script — a cloud agent's, a devcontainer's, any image built before Claude Code is signed in — there is no CLI to call, so write the two mods and the settings keys directly. Needs `curl`, `tar` and `python3`; no root, no authentication:

```bash
root="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; tmp="$(mktemp -d)"
curl -fsSL --retry 2 https://github.com/fairchild/dotclaude/archive/refs/heads/main.tar.gz | tar -xz -C "$tmp"
mkdir -p "$root/mods/.claude-plugin"
cp -R "$tmp"/*/mods/compaction "$tmp"/*/mods/usage-meter "$root/mods/"; rm -rf "$tmp"
printf '%s' '{"name":"dotclaude","owner":{"name":"Michael Fairchild"},"plugins":[{"name":"usage-meter","source":"./usage-meter"},{"name":"compaction","source":"./compaction"}]}' \
  > "$root/mods/.claude-plugin/marketplace.json"
python3 - "$root" <<'EOF'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1], "settings.json")
s = json.loads(p.read_text()) if p.exists() else {}
s.setdefault("extraKnownMarketplaces", {})["dotclaude"] = {
    "source": {"source": "directory", "path": str(pathlib.Path(sys.argv[1], "mods"))}}
s.setdefault("enabledPlugins", {}).update(
    {"usage-meter@dotclaude": True, "compaction@dotclaude": True})
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(s, indent=2) + "\n")
EOF
```

The mods become a directory marketplace named `dotclaude`, so their plugin IDs match a machine that installed them from GitHub, and they load from the first session. It merges into an existing `settings.json` rather than replacing it, and rerunning it changes nothing. For a whole cloud environment rather than the mods alone, [Cloud sessions](#cloud-sessions) is the one line that carries skills and settings too.

| Mod | Tool | What you get |
|-----|------|--------------|
| `usage-meter` | `mcp__usage-meter__reading` | The account's five-hour and seven-day windows: how much is used and when each resets. Ask "how much usage is left?" |
| `compaction` | `mcp__compaction__context` | Where the session sits against its context goal, the request floor and the prepare point. Ask "how's my context?" |
| | `mcp__compaction__request` | Records a `/compact` with instructions for the summary, the reasoning for compacting now, and optionally a `resume` prompt; the mod runs it once the turn ends, then submits the resume prompt (or a generic one) so the session carries on rather than waiting idle. Say "compact when this turn is done, keeping the merge order" |

The point of `request` over plain `/compact`: the engine's automatic compaction takes no instructions, so it decides for itself what survives. A thread that asks gets to say what must not be lost. Each request is kept, reasoning included, so the points can be judged against the moments they were asked for.

**One number to set.** `goalTokens` is the default context target — 300,000 unless you change it; past it, compacting is the thread's judgement. The request floor (half) and the prepare point (the goal less 80,000 of runway, never below the floor) follow from it:

```bash
claude plugin configure compaction   # or /config in a session
```

The engine's own compaction is separate and stays the engine's: it fires at `min((W - 20000) * P / 100, W - 33000)`, with `W` from the `autoCompactWindow` setting. That point is the top end a thread may run into on judgement, and the gap above the goal is room by design: at `W = 700000` the engine compacts at 667k, leaving a thread with a 300k goal about 367k to choose in, while `W = 300000` (267k) makes the goal a hard ceiling. The mod can't move the engine's point; it describes the room when the point sits above the goal, says nothing when it sits between the goal and the goal less 43,000, and flags a setting only below that, where the goal could never be reached. [mods/README.md](mods/README.md#compaction-points) has the derivations.

In a cloud environment the [Cloud sessions](#cloud-sessions) setup line installs both mods and can set the window and the goal, each on its own.

## Development

`~/.claude` is an independent git clone on `main`. A `SessionStart` hook runs `scripts/deploy.sh` to sync from `origin/main` on every session start, so merged PRs are live immediately. Development happens in `~/code/dotclaude` on feature branches. [docs/development.md](docs/development.md) has the full workflow: the two clones, deploy, and developing a skill.

### Source/runtime participant contract

The development checkout is public source; `~/.claude` is the deployed runtime. The runtime remains a standalone clone on `main`—never a symlink or worktree—but it is not expected to be pristine in the ordinary sense. Tracked changes are source drift, ignored paths are allowed generated/private runtime, and unignored unknown paths require attention.

```bash
mise run bootstrap          # create or reconcile the independent runtime clone
mise run sync               # fetch and fast-forward clean tracked source
mise run doctor             # read-only drift, config, and skill-link validation
mise run test:participant   # isolated clone and migration fixtures
```

Bootstrap backs up an ambiguous non-Git runtime before cloning and refuses to move a registered worktree. Sync preserves ignored local state while refusing tracked or unknown drift. Doctor reports aggregate drift counts, parses structured configuration, and validates the links declared by `dotagents.toml` without printing private values.

This is dotclaude's implementation of the [fairchild/dotfiles source/runtime contract](https://github.com/fairchild/dotfiles/blob/master/docs/source-runtime-contract.md); it remains independently operable through the scripts above.

### Cloud sessions

Cloud sessions never see the machine's `~/.claude`, but they do read the one on their VM, so an environment's setup script can carry preferences over. Add this line to the setup script of a personal cloud environment at [claude.ai/code](https://claude.ai/code):

```bash
curl -fsSL https://raw.githubusercontent.com/fairchild/dotclaude/main/scripts/cloud-bootstrap.sh | bash
```

[`scripts/cloud-bootstrap.sh`](scripts/cloud-bootstrap.sh) installs the bundle that [`cloud-bundle.yml`](.github/workflows/cloud-bundle.yml) publishes from `main`: `CLAUDE.md`, agents, commands, every skill not marked `machine-bound`, the [mods](mods/README.md), the [plugins](.claude-plugin/plugins/README.md), and the settings that mean the same on a VM. It leaves out hooks, the status line and `dotagents` links, which assume this machine. Each run records its result in `~/.claude/cloud-bootstrap.status`.

Variables before `bash`, each optional:

| Variable | Effect |
|----------|--------|
| `DOTCLAUDE_SKILLS` | Only these skills, separated by spaces or commas. A name it can't install, misspelled or `machine-bound`, is listed in the status line. |
| `DOTCLAUDE_MODS` | Only these mods; `none` installs none. Unset, both install and load from the first session. |
| `DOTCLAUDE_PLUGINS` | Only these plugins from [`.claude-plugin/plugins/`](.claude-plugin/plugins/README.md); `none` installs none. Unset, `shipyard` installs, so a cloud session can take a seat. A plugin declaring `dependencies` does not load without them, so narrowing a mod away takes a plugin that depends on it too — `DOTCLAUDE_MODS=none` leaves no `shipyard` either, and the status line names the dependency that was missing. |
| `DOTCLAUDE_COMPACT_WINDOW`, `DOTCLAUDE_COMPACT_PCT` | When sessions auto-compact (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`); `300000` and `100` compact at 267k, `700000` and `100` at 667k. Unset, the platform's default stands. |
| `DOTCLAUDE_COMPACT_GOAL` | The compaction mod's `goalTokens`, the default target a thread may run past on judgement up to the engine's point. Unset, the goal follows a window of 300,000 or less, and stays at 300,000 under a wider one, so the gap is room; with no window either, the mod keeps its own 300,000. The status line says when a wide window leaves the goal at 300,000, and when a goal or window that isn't a whole number from 1 to 999,999,999 is not read; leading zeros are dropped. |

```bash
curl -fsSL https://raw.githubusercontent.com/fairchild/dotclaude/main/scripts/cloud-bootstrap.sh | DOTCLAUDE_SKILLS="tight-docs fable-session" DOTCLAUDE_COMPACT_WINDOW=300000 DOTCLAUDE_COMPACT_PCT=100 bash
```

The variables belong in the setup script itself: an environment's variables aren't set yet while setup runs.

A cached environment doesn't rerun its setup script, so sessions get what `main` held when the cache was built, at most about seven days ago. Editing the script rebuilds the cache.

### Ecosystem skills

Skill installation and symlinking is driven by [`dotagents.toml`](dotagents.toml) — a manifest declaring which ecosystem skills live in `~/.agents/skills/` and how they're linked into `~/.claude/skills/`. Canonical first-party shared sources now live in [fairchild/dotfiles](https://github.com/fairchild/dotfiles/tree/master/agents/shared/first-party-skills), so dotclaude no longer declares reverse links into `~/.agents`. [`scripts/sync-dotagents.py`](scripts/sync-dotagents.py) remains the reconciler: `audit` reports drift, `sync` reconciles, and `status` is a one-liner for hooks. A SessionStart hook runs `status` each session so drift surfaces without blocking.

## Permissions Model

Defined in `settings.example.json`:

| Category | Scope | Behavior |
|----------|-------|----------|
| **allow** | Git (non-destructive), GitHub CLI, file ops, package managers, curl | Auto-approved |
| **ask** | `git push`, `git reset`, `git rebase`, `rm -rf` | Requires approval |
| **deny** | `.env*`, `*.pem`, `*.key`, `~/.ssh/`, `~/.aws/`, `*secret*`, `*credential*` | Blocked |

---

## Status Line

`statusLine.command` points at the WorkSpaces forwarder, which chooses a
renderer based on whether a host socket is live. `env` in `settings.json`
redirects its fallback to `scripts/statusline.sh`:

```
statusLine.command → ~/.local/share/workspaces/hook-forwarders/statusline.sh
                       ├── socket live  → POST to the host; the app draws the footer
                       └── socket unset → $WORKSPACES_STATUSLINE_FALLBACK
                                            → ~/.claude/scripts/statusline.sh
```

```
statline (2) Opus 5 $7.24 18%
│        │   │      │     └── context window used — yellow at 60, red at 80
│        │   │      └── session cost
│        │   └── model
│        └── uncommitted files
└── worktree — plus the branch, when the worktree name doesn't imply it
```

Everything but the branch and the dirty count arrives in the stdin payload, so
it costs one `jq` call and at most two `git` calls.

The branch stays hidden while it agrees with the worktree name, so a surprising
checkout is the thing that shows up:

```
statline (2) Opus 5 $7.24 18%                 on fairchild/statline
dotclaude fairchild/statline (2) Opus 5 ...   same branch, different worktree
```

The payload carries more than this line uses — `rate_limits.five_hour` and
`.seven_day` percentages, `session_name`, `effort.level`, `exceeds_200k_tokens`.
Capture one with a probe at the fallback path to see the current shape.

---

## Documentation

| Doc | Topic |
|-----|-------|
| [docs/development.md](docs/development.md) | The two clones, deploy, developing a skill |
| [docs/github-actions.md](docs/github-actions.md) | CI, releases and site deploys |
| [docs/skill-portability.md](docs/skill-portability.md) | How skills stay portable when served over MCP |
| [docs/skill-server-architecture.md](docs/skill-server-architecture.md) | How the `mcp/` skill server is built |
| [docs/agents/](docs/agents/) | How the engineering skills read this repo: backlog, triage roles, domain docs |
| [skills/chronicle/docs/chronicle-design.md](skills/chronicle/docs/chronicle-design.md) | Chronicle memory system design |
| [docs/skill-server-release-plan.md](docs/skill-server-release-plan.md), [docs/skill-server-quality-review.md](docs/skill-server-quality-review.md) | History: snapshots from 2026-09-05 |

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
