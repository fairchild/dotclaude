# Changelog

## [Unreleased]

### Added

- **Image generation comparison workflow**: Added multi-provider example runs, an image-first ranking gallery, and a Playwright evaluator for reviewing generated image sets.
- **Image generation history and storage**: Added documented, gitignored local roots for generated outputs and provenance data.
- **Image-gen maintenance docs**: Added references for refreshing supported provider models, scripts, and comparison examples over time.

### Changed

- **Image-gen provider scripts**: Refreshed model defaults and shared common handling for environment loading, output paths, formats, and history logging.
- **Image-gen skill guide and tests**: Streamlined the skill instructions, documented direct executable UV script usage, and expanded tests around the provider adapter protocol, comparison runs, shared helpers, and local history.

## [0.1.0] - 2026-01-24

Initial release of dotclaude - a personal Claude Code configuration framework.

### Added

- **Skills Framework**: 20+ auto-invoked skills for specialized workflows
  - `chronicle` - Session memory capture and curation
  - `frontend-design` - Production-grade web UI generation
  - `image-gen` - Multi-provider AI image generation (OpenAI, Imagen, fal.ai)
  - `release` - Semantic versioning with AI-generated changelogs
  - `git-worktree` - Parallel branch development via `wt` CLI
  - `mcp-builder` - MCP server creation guidance
  - `youtube-content` - Video transcript extraction and analysis
  - `update-dependencies` - Cross-ecosystem dependency management
  - `verify` - Deployment health checks
  - And more: canvas-design, webapp-testing, skill-creator, dotclaude-config, excalidraw-diagrams

- **Commands**: Slash commands for common workflows
  - `/bootstrap` - Project scaffolding
  - `/opensource-precheck` - Pre-publication audit
  - `/pr-review` - PR feedback workflow
  - `/project-health` - Repository health checks
  - `/chronicle` - Session memory management

- **Agents**: Background task specialists
  - `research` - Deep codebase exploration
  - `verify` - Deployment verification
  - `github-notifications-triager` - Notification prioritization
  - `chronicle-curator` - Memory block management
  - `playwright-test-analyzer` - Visual test analysis

- **Chronicle System**: Persistent session memory with hierarchical summaries
  - Session capture and archival
  - AI-synthesized digests
  - Multi-worktree awareness
  - Stale detection and resilient archiving
  - SessionStart hook for automatic context injection

- **Config Visualizer (webui)**: Dashboard for exploring Claude Code configuration
  - Skills, commands, agents discovery
  - MCP server configuration view
  - Cloudflare Workers deployment

- **Worktree Integration**: Full git worktree support
  - `wt` CLI with create, ls, tree, apply, archive commands
  - Chronicle integration for worktree-aware context

- **GitHub Actions**: CI/CD workflows
  - Claude Code Review with Greptile-style scoring
  - PR validation for config files
  - Cloudflare Workers deployment

- **Permissions Model**: High-autonomy defaults with safety guardrails
  - Pre-approved common operations
  - Confirmation for dangerous operations
  - Secrets denied by default

### Documentation

- Comprehensive README with quick reference
- Architecture documentation in `docs/`
- Session data management guide
