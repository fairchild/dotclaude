# dotclaude

Personal Claude Code configuration. Clone to `~/.claude/` for global settings across all projects.

## Philosophy

**High autonomy by default.** Common operations (git, file ops, package managers) are pre-approved. Dangerous operations (push, reset, rm -rf) require confirmation. Secrets are denied by default.

## Directory Structure

```
~/.claude/
├── CLAUDE.md          # Personal context (name, preferences, tool choices)
├── settings.json      # Permissions, hooks, model selection
├── .mcp.json          # MCP server configs
├── statusline.sh      # Custom status bar
├── commands/          # Slash commands (/bootstrap, /status_line)
├── skills/            # Extended capabilities with references
├── agents/            # Specialized autonomous agents
├── hooks/             # Session lifecycle scripts
├── scripts/           # Helper utilities
├── references/        # Reference documentation
├── chronicle/         # Chronicle session memory
├── webui/             # Config Visualizer dashboard
├── docs/              # Architecture documentation
└── [session data]     # Gitignored: history, todos, plans, etc. (see docs/session-data.md)
```

## Quick Reference

### Commands (`/command`)

| Command | Purpose |
|---------|---------|
| `/bootstrap` | Scaffold new projects with structure |
| `/claude-webui` | Launch the Config Visualizer dashboard |
| `/defer` | Capture explored work as todo for later |
| `/opensource-precheck` | Audit repo before making public |
| `/plan_retro` | Append retrospective to current plan |
| `/pr-review` | Address PR feedback toward merge |
| `/project-health` | Review ~/code projects health |
| `/reflect` | Pause to review work with fresh eyes |
| `/reflection-log` | Log feedback to improve reflection prompt |
| `/retro` | Review session trajectory and update todos |
| `/status_line` | Explain current session metrics |
| `/update-dependencies` | Intelligent dependency updates with batching |

### Skills (auto-invoked)

| Skill | When it activates |
|-------|-------------------|
| **ai-coding-usage** | Analyzing AI coding patterns and statistics |
| **brainstorm-to-brief** | Visual design exploration and design briefs |
| **image-gen** | Generating images with AI (OpenAI, Imagen, fal.ai) |
| **canvas-design** | Creating visual art, posters, PDFs |
| **chronicle** | Capturing and curating session memory |
| **frontend-design** | Building web UIs, components, pages |
| **webapp-testing** | Playwright browser automation |
| **mcp-builder** | Creating MCP servers |
| **skill-creator** | Building new skills |
| **release** | Semantic versioned releases from any branch (worktree-aware) |
| **cloudflare-workers-deploy** | Workers deployment setup |
| **git-worktree** | Parallel branch development |
| **web-artifacts-builder** | Complex claude.ai artifacts |
| **playwright-ts** | TypeScript-based Playwright workflows |
| **verify** | Deployment verification and health checks |
| **excalidraw-diagrams** | Creating diagrams via Excalidraw |
| **dotclaude-config** | Editing Claude Code configuration |
| **session-title-eval** | Evaluating session title generation quality |
| **update-dependencies** | Dependency analysis and updates |
| **youtube-content** | Extracting/analyzing YouTube video content |
| **rate-title** | AI-assisted session title rating |

### Agents (background tasks)

| Agent | Use case | Example prompt |
|-------|----------|----------------|
| **research** | Deep codebase exploration | "Research how auth works in this codebase" |
| **verify** | Deployment health checks | "Verify the staging deployment is healthy" |
| **github-notifications-triager** | Prioritize GitHub notifications | "What's important on GitHub today?" |
| **devcontainer-setup** | Configure dev containers | "Set up a devcontainer for this project" |
| **project-handoff-auditor** | Pre-handoff quality audit | "Prepare this project for client handoff" |
| **ai-sdk-agent-architect** | Vercel AI SDK 6 agent implementations | "Implement a search agent with AI SDK" |
| **playwright-test-analyzer** | Visual test analysis | "Run checkout tests and analyze the UI" |
| **chronicle-curator** | Curate Chronicle memory blocks | Auto-invoked for memory management |
| **youtube-content** | Extract YouTube transcripts | "Summarize this video: youtube.com/..." |
| **experiment-creator** | Create UI experiments | Project-specific (JrnlFish) |

### MCP Servers

Configured in [`.mcp.json`](https://code.claude.com/docs/en/mcp) (merges with project-level configs):

| Server | Purpose |
|--------|---------|
| [**perplexity-mcp**](https://github.com/Alcova-AI/perplexity-mcp) | Web search and reasoning via Perplexity API |

## Permissions Model

Defined in `settings.json`:

| Category | Scope | Behavior |
|----------|-------|----------|
| **allow** | Git (non-destructive), GitHub CLI, file ops, package managers, curl | Auto-approved |
| **ask** | `git push`, `git reset`, `git rebase`, `rm -rf` | Requires approval |
| **deny** | `.env*`, `*.pem`, `*.key`, `~/.ssh/`, `~/.aws/`, `*secret*`, `*credential*` | Blocked |

## Installation

```bash
# Fresh install
git clone git@github.com:fairchild/dotclaude.git ~/.claude

# Or backup existing first
mv ~/.claude ~/.claude.backup
git clone git@github.com:fairchild/dotclaude.git ~/.claude
```

## Per-Project Overrides

Project `.claude/` directories override global settings:

```bash
mkdir -p .claude/commands
cp ~/.claude/CLAUDE.md .claude/          # Customize for project
cp ~/.claude/commands/bootstrap.md .claude/commands/
```

---

## MCP Servers

Claude Code loads MCP servers from multiple locations, merged together:

| Location | Scope | Added via |
|----------|-------|-----------|
| `~/.claude.json` → `mcpServers` | User (global) | `claude mcp add <name>` |
| `~/.claude/.mcp.json` | User (global) | This repo |
| `.mcp.json` in project root | Project (shareable) | `claude mcp add -s project` |
| `~/.claude.json` → `projects.*.mcpServers` | Per-project | `claude mcp add` in project dir |

### This Repo's MCP Config

The `.mcp.json` in this repo defines shareable servers with env var references:

```json
{
  "mcpServers": {
    "alcova-perplexity-mcp": {
      "type": "stdio",
      "command": "perplexity-mcp",
      "args": ["--model", "sonar-pro", "--reasoning-model", "sonar-reasoning-pro"],
      "env": { "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY}" }
    }
  }
}
```

### Adding More Servers

```bash
# User scope (stored in ~/.claude.json, available everywhere)
claude mcp add langfuse-docs --type http --url https://langfuse.com/api/mcp

# Project scope (stored in .mcp.json, shareable via git)
claude mcp add my-server -s project --type http --url https://example.com/mcp

# List active servers
claude mcp list
```

### Docs

- [Claude Code MCP Guide](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [MCP Servers Registry](https://github.com/modelcontextprotocol/servers)

---

## Status Line

Custom status bar: `project branch (uncommitted) Model $cost +add -del (tokens) [ratio]`

```
myproject fix/branch (3) Opus 4.5 $0.66 +28 -5 (70+210K+1.6M):7K [1:267]
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

For implementation details, see [docs/statusline-architecture.md](https://github.com/fairchild/dotclaude/blob/main/docs/statusline-architecture.md).

---

## Documentation

| Doc | Topic |
|-----|-------|
| [docs/session-data.md](https://github.com/fairchild/dotclaude/blob/main/docs/session-data.md) | Gitignored session data, multi-machine sync |
| [docs/statusline-architecture.md](https://github.com/fairchild/dotclaude/blob/main/docs/statusline-architecture.md) | Status line implementation |
| [skills/chronicle/docs/chronicle-design.md](https://github.com/fairchild/dotclaude/blob/main/skills/chronicle/docs/chronicle-design.md) | Chronicle memory system design |

---

## Model Reference

| Model | Context | Input | Output |
|-------|---------|-------|--------|
| Opus 4.5 | 200K | $5/M | $25/M |
| Sonnet 4.5 | 200K | $3/M | $15/M |
| Haiku 4.5 | 200K | $1/M | $5/M |

---

## Credits

Skills adapted from [anthropics/skills](https://github.com/anthropics/skills) (Apache 2.0).

## License

Apache 2.0 - See [LICENSE](https://github.com/fairchild/dotclaude/blob/main/LICENSE)
