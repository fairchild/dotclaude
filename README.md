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
└── statusline.sh      # Custom status bar
├── commands/          # Slash commands (/bootstrap, /status_line)
├── skills/            # Extended capabilities with references
├── agents/            # Specialized autonomous agents
├── hooks/             # Session lifecycle scripts
├── scripts/           # Helper utilities
├── [generated]        # Gitignored: history, todos, plans, debug, etc.
```

## Quick Reference

### Commands (`/command`)

| Command | Purpose |
|---------|---------|
| `/bootstrap` | Scaffold new projects with structure |
| `/status_line` | Explain current session metrics |
| `/opensource-precheck` | Audit repo before making public |
| `/pr-review` | Address PR review feedback and advance toward merge |
| `/update-dependencies` | Intelligent dependency updates with batching |

### Skills (auto-invoked)

| Skill | When it activates |
|-------|-------------------|
| **frontend-design** | Building web UIs, components, pages |
| **canvas-design** | Creating visual art, posters, PDFs |
| **webapp-testing** | Playwright browser automation |
| **mcp-builder** | Creating MCP servers |
| **skill-creator** | Building new skills |
| **release** | Semantic versioning and changelogs |
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

| Agent | Use case |
|-------|----------|
| **research** | Deep codebase exploration |
| **verify** | Deployment health checks |
| **github-notifications-triager** | Prioritize GitHub notifications |
| **devcontainer-setup** | Configure dev containers |
| **project-handoff-auditor** | Pre-handoff quality audit |
| **ai-sdk-agent-architect** | Vercel AI SDK implementations |
| **playwright-test-analyzer** | Visual test analysis |

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
      "command": "perplexity-mcp",
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

Apache 2.0 - See [LICENSE](LICENSE)
