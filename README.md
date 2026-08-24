# dotclaude

My working `~/.claude/` configuration for Claude Code. Published for reference — not designed as a drop-in clone.

## What I'm Exploring

Sessions are ephemeral but work is not. Much of this config is dedicated to an ongoing experiment: what happens when you treat each session as worth remembering?

**Chronicle** keeps a persistent journal of each session. A hook extracts a memory block at session end (what was accomplished, what's pending, key decisions). At session start, another hook injects relevant context: recent work in this project, pending items, stale threads. Over time: `/chronicle curate` to organize, `/chronicle insights` for cross-session patterns, `/chronicle publish` for digests.

Supporting pieces: a stop hook names each session from its content; analyze-usage runs DuckDB across Claude Code and Cursor logs; recall/remember agents persist memory across sessions; `/fork` carries context into a new worktree or session.

Much of this config observes work rather than does it. The memory system is where the config is still evolving.

## Drawing from This

This config is personal — `CLAUDE.md` has my name, hooks call my Chronicle scripts, the MCP server needs my API key. To draw from it, cherry-pick rather than clone.

**Copy directly** (self-contained):
- `settings.json` permissions pattern (allow/ask/deny tiers)
- Individual commands or skills (each is a standalone directory)

**Customize first:**
- `CLAUDE.md` — personal identity and tool preferences
- `settings.json` hooks — these call Chronicle scripts; remove or replace with your own session lifecycle
- `.mcp.json` — requires `PERPLEXITY_API_KEY` environment variable

**Prerequisites for the full config:**
- `bun` — hooks and scripts are TypeScript
- `jq` — statusline payload parsing
- `git` — core operations
- Optional: `uv` (Python), `mise` (runtimes), Perplexity API key

Project-level `.claude/` directories override global settings. See Claude Code docs for the merge behavior.

## Directory Structure

```
~/.claude/
├── CLAUDE.md          # Personal context (name, preferences, tool choices)
├── settings.json      # Permissions, hooks, model selection
├── skills/            # Skills — tiered stable / experimental / local (see below)
├── commands/          # Slash commands (/bootstrap, /code-review)
├── agents/            # Specialized autonomous agents
├── hooks/             # Session lifecycle scripts
├── scripts/           # Runtime contract (bootstrap, sync, doctor) and catalog
├── dotagents.toml     # Manifest of ecosystem skills linked from ~/.agents
├── backlog/           # Markdown issue tracker (todo/doing/done) + ROADMAP.md
├── chronicle/         # Chronicle session memory
├── managed-agents/    # Self-hosted execution environments for managed agents
├── webui/             # Config Visualizer dashboard
├── docs/              # Agent-skill config and development notes
├── blog/              # Writing about this config
└── [session data]     # Gitignored: history, todos, plans, caches, etc.
```

## Quick Reference

Every first-party skill sits in one of three tiers, declared in its `SKILL.md` frontmatter and rendered here by `mise run catalog` (CI fails when this block drifts from the frontmatter):

| Tier | Declared by | Meaning |
|------|-------------|---------|
| stable | no `metadata.status` | Has an eval or sustained use; safe to auto-invoke |
| experimental | `metadata.status: experimental` + `experimental_reason` | Usable, with a stated reason it hasn't graduated |
| local | listed in `skills/.gitignore` | Lives in `~/.claude` only; never published |

Ecosystem skills (installed by `npx skills` from other repos) are symlinked in from `~/.agents/skills/` per [`dotagents.toml`](dotagents.toml) and aren't listed here.

<!-- catalog:start -->
### Skills — stable, auto-invoked

Claude loads these when the task matches the description.

| Skill | Domain |
|---|---|
| `agent-inbox` | File-based messaging between agents across any harness. |
| `analyze-usage` | Analyze local AI coding-assistant activity across Claude Code, Codex, Cursor, and Pi. |
| `backlog` | Markdown task backlog and project roadmap (backlog/{todo,doing,done,failed}/, backlog/ROADMAP.md) for adding,… |
| `chronicle` | Session continuity for coding work. |
| `cmux-orchestrator` | Orchestrate the cmux terminal — named layouts (workshop, ops-deck), sidebar dashboarding (status, progress, logs),… |
| `codespaces` | Manage GitHub Codespaces lifecycle via gh CLI. |
| `dotclaude-config` | Work with Claude Code configuration at global (~/.claude) or project (.claude/) level. |
| `fable-session` | Hand off long-arc work to a fable session — Fable orchestrates and verifies while delegating the implementation. |
| `frontend-design` | Create distinctive, production-grade frontend interfaces with high design quality. |
| `gh-apps` | Create, authenticate, and manage GitHub Apps. |
| `git-worktree` | Manage Git worktrees for concurrent local development. |
| `image-gen` | Generate images from prompts using AI APIs (OpenAI GPT Image, Google Gemini/Nano Banana, Google Imagen, fal.ai Flux). |
| `project-scripts` | Standardize project lifecycle scripts (setup, run, stop, archive) in scripts/ so agents can manage workspaces through a… |
| `session-titles` | Session title generation, evaluation, and optimization. |
| `signoz-log` | Send structured logs to SigNoz observability platform. |
| `skills-manager` | Use when the user wants to list, search, install, remove, inspect, validate, audit, or update skills. |
| `swiftui-expert` | Write, review, or improve SwiftUI code. |
| `team-memory` | Persistent AI teammate memory framework. |
| `update-dependencies` | Smart dependency updates across ecosystems (npm/bun/pnpm, uv/poetry, cargo). |
| `webapp-testing` | Interact with and test web applications using Playwright. |

### Skills — stable, invoked by slash command

`disable-model-invocation: true` — run as `/name`; Claude will not load them on its own.

| Skill | Domain |
|---|---|
| `/brainstorm-to-brief` | Wide→Narrow design workflow taking UI/UX concepts from exploration to polished design brief. |
| `/canon-printer` | Check status, ink levels, job queue, cancel stuck jobs, print files and rendered documents, track loaded paper, and… |
| `/excalidraw-diagrams` | Create diagrams and visual artifacts using Excalidraw with real-time canvas preview. |
| `/fork` | Fork the current session with context carried over. |
| `/release` | Create semantic versioned releases with AI-generated changelogs, for repos that do not already have a release pipeline… |
| `/skill-building` | Guide for creating, editing, and evaluating skills. |
| `/tart-gui-automation` | Run deterministic GUI workflows in isolated Tart macOS VMs. |
| `/tidyup` | Proof-based sweep of a repo's accumulated worktrees, stale local branches, and in-flight PRs — reduces open threads to… |
| `/web-artifacts-builder` | Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologies… |
| `/youtube-content` | Extract and analyze YouTube video content (transcripts + metadata). |

### Skills — experimental

`metadata.status: experimental` in frontmatter. Usable, and the reason each one hasn't graduated is stated in `metadata.experimental_reason`.

| Skill | Domain | Why experimental |
|---|---|---|
| `ascii-art-fix` | Fix misaligned right borders in ASCII art diagrams | Prompt-only repair is useful but still has edge cases around nested diagrams, tables, and mixed markdown content. |
| `cloudflare-workers-deploy` | Set up Cloudflare Workers deployment for web applications with GitHub Actions CI/CD. | Deployment patterns are useful but not yet validated across enough project shapes and Cloudflare account setups. |
| `ios-simulator` | Automate iOS Simulator tasks — capture screenshots, interact with apps, generate screen flow galleries. | Simulator automation remains sensitive to local device state, timing, window focus, and Xcode version differences. |
| `persona-memory` | Build and operate a persistent persona and memory framework for Claude Code. | Healthy framework, intentionally experimental until background memory agents and full interactive-session CI coverage exist. |
| `skill-seeker` | Generate Claude Code skills from docs sites, GitHub repos, or local codebases using Skill Seekers. | Generated skill quality varies by source corpus and still requires explicit human review before installation. |
| `vocal` | Speak text aloud (TTS) and transcribe speech (STT). | Voice workflows depend on local audio devices and optional ElevenLabs credentials, so reliability is environment-sensitive. |

### Commands

| Command | Purpose |
|---|---|
| `/bootstrap` | Bootstrap a new project with interactive brainstorming and structure generation |
| `/code-review` | Review recent work against plan and project standards |
| `/codex-review` | Run code review via Codex CLI with non-Claude models (GPT-5, o3, Ollama) |
| `/opensource-precheck` | Audit a private repo before making it public |
| `/plan_retro` | Append a retrospective section to the current plan file |
| `/project-health` | Review health of ~/code projects (git status, tests, remote sync) |
| `/reflect` | Pause to review work with fresh eyes for bugs, missed cases, or simplifications |
| `/respond-to-pr-review` | Respond to review feedback on our PR and advance toward mergeable state |
| `/retro` | Review session trajectory and update todo file with lessons learned |
| `/review-pr` | Review a pull request someone else wrote |

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

### MCP Servers

Configured in [`.mcp.json`](https://code.claude.com/docs/en/mcp) (merges with project-level configs):

| Server | Purpose |
|--------|---------|
| [perplexity-mcp](https://github.com/Alcova-AI/perplexity-mcp) | Web search and reasoning via Perplexity API |

## Install via Skills

```bash
# Install all skills
npx skills add fairchild/dotclaude

# Install a single skill
npx skills add fairchild/dotclaude --skill <skill-name>

# Check for updates and apply them
npx skills check && npx skills update
```

## Development

`~/.claude` is an independent git clone on `main`. A `SessionStart` hook runs `scripts/deploy.sh` to sync from `origin/main` on every session start, so merged PRs are live immediately. Development happens in `~/code/dotclaude` on feature branches. See [skills/dotclaude-config/references/development-workflow.md](skills/dotclaude-config/references/development-workflow.md) for the full architecture, sync workflow, and skill development process.

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

Skill installation and symlinking is driven by [`dotagents.toml`](dotagents.toml) — a manifest declaring which ecosystem skills live in `~/.agents/skills/` and how they're linked into `~/.claude/skills/`. Canonical first-party shared sources now live in [fairchild/dotfiles](https://github.com/fairchild/dotfiles/tree/master/agents/shared/first-party-skills), so dotclaude no longer declares reverse links into `~/.agents`. [`scripts/sync-dotagents.py`](scripts/sync-dotagents.py) remains the reconciler: `audit` reports drift, `sync` reconciles, and `status` is a one-liner for hooks. A SessionStart hook runs `status` each session so drift surfaces without blocking.

## Permissions Model

Defined in `settings.json`:

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

Everything but the branch and the dirty count arrives on stdin: the payload
carries `context_window.used_percentage`, `workspace.git_worktree`, and `cost`
directly. One `jq` call, at most two `git` calls, no cache, no background job,
and no read of the session transcript.

The branch stays hidden while it agrees with the worktree name, so a surprising
checkout is the thing that shows up:

```
statline (2) Opus 5 $7.24 18%                 on fairchild/statline
dotclaude fairchild/statline (2) Opus 5 ...   same branch, different worktree
```

This replaced a 224-line renderer (`skills/status-line-live/`) whose token
formula, background cache, and session-title lookup were reimplementing fields
the harness now supplies — and which forked a subshell every five seconds to
`jq -s` the whole session JSONL. It was also the only writer of
`~/.claude/session-titles/<project>/<id>.tokens`, so that file is no longer
produced; session titles themselves still come from the `Stop` hook.

The payload carries more than this line uses — `rate_limits.five_hour` and
`.seven_day` percentages, `session_name`, `effort.level`, `exceeds_200k_tokens`.
Capture one with a probe at the fallback path to see the current shape.

---

## Documentation

| Doc | Topic |
|-----|-------|
| [docs/development.md](docs/development.md) | Worktree architecture, auto-sync, skill development |
| [skills/chronicle/docs/chronicle-design.md](skills/chronicle/docs/chronicle-design.md) | Chronicle memory system design |

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
