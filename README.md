# dotclaude

My working `~/.claude/` configuration for Claude Code. Published for reference — not designed as a drop-in clone.

## What I'm Exploring

Sessions are ephemeral but work is not. Most of this config is dedicated to an ongoing experiment: what happens when you treat each session as worth remembering?

**Chronicle** keeps a persistent journal of each session. A hook extracts a memory block at session end (what was accomplished, what's pending, key decisions). At session start, another hook injects relevant context: recent work in this project, pending items, stale threads. Over time: `/chronicle curate` to organize, `/chronicle insights` for cross-session patterns, `/chronicle publish` for digests.

Supporting pieces: a stop hook names each session from its content; analyze-usage runs DuckDB across Claude Code and Cursor logs; recall/remember agents persist memory across sessions; `/fork` carries context into a new worktree or session.

Much of this config observes work rather than does it. The memory system is where the config is still evolving.

## Drawing from This

This config is personal — `CLAUDE.md` has my name, hooks call my Chronicle scripts, the MCP server needs my API key. To draw from it, cherry-pick rather than clone.

**Copy directly** (self-contained):
- `settings.json` permissions pattern (allow/ask/deny tiers)
- `skills/status-line-live/` (needs jq + bc)
- Individual commands or skills (each is a standalone directory)

**Customize first:**
- `CLAUDE.md` — personal identity and tool preferences
- `settings.json` hooks — these call Chronicle scripts; remove or replace with your own session lifecycle
- `.mcp.json` — requires `PERPLEXITY_API_KEY` environment variable

**Prerequisites for the full config:**
- `bun` — hooks and scripts are TypeScript
- `jq`, `bc` — statusline calculations
- `git` — core operations
- Optional: `uv` (Python), `mise` (runtimes), Perplexity API key

Project-level `.claude/` directories override global settings. See Claude Code docs for the merge behavior.

## Directory Structure

```
~/.claude/
├── CLAUDE.md          # Personal context (name, preferences, tool choices)
├── settings.json      # Permissions, hooks, model selection
├── .mcp.json          # MCP server configs
├── commands/          # Slash commands (/bootstrap, /status_line)
├── skills/            # Extended capabilities with references
├── agents/            # Specialized autonomous agents
├── hooks/             # Session lifecycle scripts
├── scripts/           # Helper utilities
├── references/        # Reference documentation
├── chronicle/         # Chronicle session memory
├── webui/             # Config Visualizer dashboard
├── docs/              # Architecture documentation
└── [session data]     # Gitignored: history, todos, plans, caches, etc.
```

## Quick Reference

### Commands (`/command`)

| Command | Purpose |
|---------|---------|
| `/bootstrap` | Scaffold new projects with structure |
| `/claude-webui` | Launch the web dashboard for this dotclaude repo |
| `/opensource-precheck` | Audit repo before making public |
| `/plan_retro` | Append retrospective to current plan |
| `/pr-review` | Address PR feedback toward merge |
| `/project-health` | Review ~/code projects health |
| `/reflect` | Pause to review work with fresh eyes |
| `/reflection-log` | Log feedback to improve reflection prompt |
| `/retro` | Review session trajectory and update todos |
| `/chronicle wrapup` | Deliberate session close-out — curator + conditional backlog update |
| `/chronicle recap` | Multi-session narrative recap for a project |
| `/status_line` | Explain current session metrics |
| `/update-dependencies` | Intelligent dependency updates with batching |
| `/code-review` | Review recent work against plan and standards |
| `/codex-review` | Code review via non-Claude models |

### Skills (auto-invoked)

| Skill | Domain |
|-------|--------|
| analyze-usage | Analyzing AI coding patterns and statistics |
| brainstorm-to-brief | Visual design exploration and design briefs |
| image-gen | Generating images with AI (OpenAI, Imagen, fal.ai) |
| backlog | Capturing explored work for later |
| chronicle | Capturing and curating session memory |
| clone-explore | Cloning and inspecting external git repos |
| frontend-design | Building web UIs, components, pages |
| webapp-testing | Playwright testing (Python and TypeScript) |
| skill-creator | Building new skills |
| release | Semantic versioned releases from any branch (worktree-aware) |
| cloudflare-workers-deploy | Workers deployment setup |
| git-worktree | Parallel branch development |
| web-artifacts-builder | Complex claude.ai artifacts |
| verify | Deployment verification and health checks |
| excalidraw-diagrams | Creating diagrams via Excalidraw |
| fork | Fork session to new worktree or local session |
| dotclaude-config | Editing Claude Code configuration |
| status-line-live | Customizing or troubleshooting the live status line |
| update-dependencies | Dependency analysis and updates |
| youtube-content | Extracting/analyzing YouTube video content |

### Skills (Experimental)

Experimental skills have `status: experimental` in frontmatter. Usable but incomplete.

| Skill | Purpose |
|-------|---------|
| rate-title | AI-assisted session title rating with human calibration |
| session-title-eval | Batch evaluation of session title generation quality |

### Agents (background tasks)

| Agent | Use case | Example prompt |
|-------|----------|----------------|
| research | Deep codebase exploration | "Research how auth works in this codebase" |
| github-notifications-triager | Prioritize GitHub notifications | "What's important on GitHub today?" |
| devcontainer-setup | Configure dev containers | "Set up a devcontainer for this project" |
| project-handoff-auditor | Pre-handoff quality audit | "Prepare this project for client handoff" |
| ai-sdk-agent-architect | Vercel AI SDK 6 agent implementations | "Implement a search agent with AI SDK" |
| chronicle-curator | Curate Chronicle memory blocks | Auto-invoked for memory management |
| chronicle-insights | Deep memory and worktree exploration | "What patterns emerge across my sessions?" |
| recall | Search memory for information | "What do I know about deployment?" |
| remember | Persist items to memory blocks | Auto-invoked for memory management |

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

## Permissions Model

Defined in `settings.json`:

| Category | Scope | Behavior |
|----------|-------|----------|
| **allow** | Git (non-destructive), GitHub CLI, file ops, package managers, curl | Auto-approved |
| **ask** | `git push`, `git reset`, `git rebase`, `rm -rf` | Requires approval |
| **deny** | `.env*`, `*.pem`, `*.key`, `~/.ssh/`, `~/.aws/`, `*secret*`, `*credential*` | Blocked |

---

## Status Line

Custom status line: `project branch (uncommitted) Model $cost +add -del (tokens) [ratio]`

```
myproject fix/branch (3) Opus 4.6 $0.66 +28 -5 (70+210K+1.6M):7K [1:267]
│           │          │   │       │     │    │                   │
│           │          │   │       │     │    │                   └── Input:Output ratio
│           │          │   │       │     │    └── Token breakdown
│           │          │   │       │     └── Lines changed
│           │          │   │       └── Session cost
│           │          │   └── Model
│           │          └── Uncommitted files
│           └── Git branch
└── Project name
```

### Token Formula: `(in+cw+cr):out`

| Symbol | Meaning | Price (Opus) |
|--------|---------|--------------|
| `in` | Uncached input | $5.00/MTok |
| `cw` | Cache write | $6.25/MTok |
| `cr` | Cache read | $0.50/MTok |
| `out` | Output | $25.00/MTok |

Cache reads are cumulative across turns (not context size).

For implementation details, see [skills/status-line-live/docs/architecture.md](skills/status-line-live/docs/architecture.md).

---

## Documentation

| Doc | Topic |
|-----|-------|
| [docs/development.md](docs/development.md) | Worktree architecture, auto-sync, skill development |
| [skills/status-line-live/docs/architecture.md](skills/status-line-live/docs/architecture.md) | Status line implementation |
| [skills/chronicle/docs/chronicle-design.md](skills/chronicle/docs/chronicle-design.md) | Chronicle memory system design |

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
