# Changelog

## [Unreleased]

### Added

- **Image generation comparison workflow**: Added `skills/image-gen/scripts/run_examples.py` for dry-run or paid comparison runs across current OpenAI, Gemini/Nano Banana, Imagen, and fal FLUX presets.
- **Image generation review UI**: Added `skills/image-gen/scripts/review_gallery.py` and a reusable review gallery template for image-first ranking, hover/focus-only card chrome outside the image, hidden-by-default generator details, keyboard focus with left/right arrows, promotion/demotion with up/down arrows, `S` to save, `R` to reveal or hide details, saved/unsaved visual state, invisible left/right side-click candidate nudging, drag-and-drop sorting, optional comments, and one/all candidate regeneration.
- **Image generation gallery evaluation**: Added `skills/image-gen/scripts/evaluate_review_gallery.py` for Playwright screenshots and checks across default, interaction, and mobile gallery states so agents can inspect rendered comparison results before handing them back.
- **Image generation history**: Added local, gitignored `skills/image-gen/data/generations.jsonl` logging for successful generations, including prompt, prompt hash, provider, model, output path, dimensions, file size, and non-secret parameters.
- **Stable image output storage**: Added gitignored `skills/image-gen/outputs/` for generated images, manifests, galleries, and test-run artifacts.
- **Image-gen maintenance docs**: Added `references/current-models.md` and `references/maintenance-workflow.md` to guide future model/API refreshes and comparison updates.
- **Image-gen assets guidance**: Added `skills/image-gen/assets/README.md` to distinguish reusable tracked inputs from generated outputs and local history.

### Changed

- **Image-gen provider scripts**: Updated OpenAI, Gemini, Imagen, and fal scripts with shared `.env` loading, stable output directory handling, output extension correction, parent directory creation, and local history logging.
- **Image-gen defaults**: Refreshed model defaults and comparison presets for current OpenAI GPT Image, Gemini/Nano Banana, Imagen 4, and fal FLUX.2 models.
- **Image-gen review regeneration**: Regeneration now uses stable candidate identities and normalizes stale saved paths so regenerating one image continues to target that image after prior regenerations.
- **Image-gen comparison ranking**: Implemented click-to-rank so the first distinct image clicked becomes rank 1, the next becomes rank 2, and later repeated clicks can restart the ranking pass before save.
- **Image-gen review chrome**: The review page now opens image-only, toggles prompt/actions/comment when the user taps or clicks outside image cards and controls, keeps cards stable when chrome appears, and lets `R` reveal only provider/model details.
- **Image-gen skill guide**: Streamlined `SKILL.md` into an operating guide that points detailed CLI usage to each script's `--help`.
- **Image-gen tests**: Expanded static tests to cover the new comparison runner, shared helpers, and local history logging without requiring paid API calls.

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
