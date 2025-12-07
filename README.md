# dotclaude

Claude Code CLI configuration.

## Tracked Files

- `.mcp.json` - MCP server configurations
- `settings.json` - Permissions, hooks, and environment settings
- `CLAUDE.md` - Context and development preferences
- `agents/` - Specialized agent definitions
- `commands/` - Reusable commands (bootstrap, etc.)
- `hooks/` - Session lifecycle hooks
- `statusline.sh` - Status line display script
- `scripts/` - Helper scripts (token counting, etc.)
- `.gitignore` - Excludes personal and generated data

## Excluded Files

- Chat history
- Session state and environment
- Plans and todos
- Debug logs and shell snapshots
- Project-specific data
- Personal scripts
- Session titles
- Analytics data

## Usage

### Global Configuration

Clone as `~/.claude/` to restore settings:

```bash
mv ~/.claude ~/.claude.backup  # backup existing if needed
git clone git@github.com:fairchild/dotclaude.git ~/.claude
```

### Project Configuration

Claude Code reads `.claude/` directories in projects.
Copy files as needed:

```bash
mkdir -p .claude/commands
cp ~/.claude/CLAUDE.md .claude/
cp ~/.claude/commands/bootstrap.md .claude/commands/
```

Project settings override global settings.

---

## Status Line

Custom status line showing project, git, cost, and token metrics.

### Format

```
planventura fix/branch (3) Opus 4.5 $0.66 +28 -5 (70+210K+1.6M):7K [1:267]
│           │          │   │       │     │    │                   │
│           │          │   │       │     │    │                   └── Input:Output ratio
│           │          │   │       │     │    └── Token formula
│           │          │   │       │     └── Lines changed
│           │          │   │       └── Session cost
│           │          │   └── Model
│           │          └── Uncommitted files
│           └── Git branch
└── Project name
```

### Token Formula: `(in+cw+cr):out [1:N]`

| Symbol | Name | Description | Opus 4.5 Price |
|--------|------|-------------|----------------|
| `in` | input | New uncached input tokens | $5.00/MTok |
| `cw` | cache_write | Tokens written to prompt cache | $6.25/MTok (1.25×) |
| `cr` | cache_read | Tokens read from cache (cyan) | $0.50/MTok (0.1×) |
| `out` | output | Claude's response tokens | $25.00/MTok |
| `[1:N]` | ratio | Input tokens per output token | — |

### Example

```
(70+210K+1.6M):7K [1:267]
```

- `70` — 70 new uncached input tokens
- `210K` — 210K tokens written to cache
- `1.6M` — 1.6M tokens read from cache (cumulative)
- `7K` — 7K output tokens
- `[1:267]` — 267 input tokens per output token

### Understanding Cache Tokens

The `cache_read` (cr) is **cumulative across all turns**, not the context size:

| Turn | Context | Cache Status |
|------|---------|--------------|
| 1 | 50K | Miss → write 50K |
| 2 | 60K | Hit 50K + write 10K |
| 3 | 75K | Hit 60K + write 15K |
| **Sum** | — | **cr = 110K accumulated** |

Each turn stays under 200K context limit, but cache reads sum up.

### Cost Efficiency

Caching provides ~90% savings on repeated context:

```
Without cache: 1.6M × $5.00/MTok = $8.00
With cache:    1.6M × $0.50/MTok = $0.80
```

### Ratio Interpretation

| Ratio | Meaning |
|-------|---------|
| `[1:10]` | Light context, verbose output |
| `[1:50]` | Typical conversation |
| `[1:200]` | Heavy context, concise output |
| `[1:500+]` | Very heavy (many file reads) |

---

## Model Reference

| Model | Context | Max Output | Input | Output |
|-------|---------|------------|-------|--------|
| Opus 4.5 | 200K | 64K | $5/M | $25/M |
| Sonnet 4.5 | 200K / 1M* | 64K | $3/M | $15/M |
| Haiku 4.5 | 200K | 64K | $1/M | $5/M |

*1M context in beta with special header

Source: [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)

---

## Sources

- [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
