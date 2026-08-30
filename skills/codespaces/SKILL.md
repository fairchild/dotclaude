---
name: codespaces
license: Apache-2.0
description: Manage GitHub Codespaces lifecycle via gh CLI. Use for "create codespace", "ssh into codespace", "stop codespace", "delete codespace", "codespace secrets", "codespace logs", "list codespaces", "codespace ports", "rebuild codespace", "gh cs", "codespace machine types".
---

# GitHub Codespaces

Manage Codespaces entirely through `gh codespace` commands. Every command uses `-c NAME` to avoid interactive selection prompts.

## Quick Reference

| Operation | Command |
|-----------|---------|
| Create | `gh cs create -r OWNER/REPO -b BRANCH -m MACHINE --devcontainer-path PATH` |
| List | `gh cs list --json name,state,repository,createdAt` |
| View details | `gh cs view -c NAME --json name,state,machineName,lastUsedAt` |
| SSH | `gh cs ssh -c NAME` |
| Run command | `gh cs ssh -c NAME -- COMMAND` |
| Stop | `gh cs stop -c NAME` |
| Delete | `gh cs delete -c NAME` |
| Logs | `gh cs logs -c NAME` |
| Rebuild | `gh cs rebuild -c NAME` |
| List ports | `gh cs ports -c NAME --json label,sourcePort,visibility` |
| Forward port | `gh cs ports forward -c NAME LOCAL:REMOTE` |
| Set secret | `gh secret set KEY --user --app codespaces` |
| List secrets | `gh secret list --user --app codespaces` |

## Machine Types

| Name | Spec |
|------|------|
| `basicLinux32gb` | 2-core, 8 GB RAM, 32 GB disk |
| `standardLinux32gb` | 4-core, 16 GB RAM, 32 GB disk |
| `premiumLinux` | 8-core, 32 GB RAM, 64 GB disk |
| `largePremiumLinux` | 16-core, 64 GB RAM, 128 GB disk |

Check available machines: `gh cs create -r OWNER/REPO --show-status` or `gh api /repos/OWNER/REPO/codespaces/machines --jq '.machines[].name'`

## Codespace States

| State | Meaning |
|-------|---------|
| Queued | Creation requested, waiting for resources |
| Provisioning | Building container |
| Available | Running, ready for SSH |
| ShuttingDown | Stopping in progress |
| Shutdown | Stopped (not billing for compute) |
| Rebuilding | Container rebuild in progress |

## Common Workflows

### Create and connect

```bash
# Create — capture the name from JSON output
NAME=$(gh cs create -r OWNER/REPO -b main -m standardLinux32gb \
  --devcontainer-path .devcontainer/devcontainer.json \
  --json name -q .name)

# Wait for it to become available
while [ "$(gh cs view -c "$NAME" --json state -q .state)" != "Available" ]; do
  sleep 5
done

# Connect
gh cs ssh -c "$NAME"
```

### Create for dotclaude

This repo has a devcontainer with Claude Code, mise, zsh, git-delta, and a network firewall.

```bash
NAME=$(gh cs create -r fairchild/dotclaude -b main -m standardLinux32gb \
  --devcontainer-path .devcontainer/devcontainer.json \
  --json name -q .name)
```

The container runs `setup.sh` post-create which:
- Installs mise runtimes from `.mise.toml`
- Installs Claude Code globally via npm
- Symlinks the workspace as `~/.claude` <!-- portability: allow -->
- Syncs Python dependencies with uv

The firewall (`init-firewall.sh`) restricts outbound traffic to:
- GitHub (API, web, git — via `/meta` CIDR ranges)
- npm registry, PyPI, Bun, mise, astral.sh
- Anthropic API, OpenAI API
- Sentry, Statsig (telemetry)

### Set up secrets (before first create)

Secrets are injected as environment variables during creation.

```bash
# Required — Claude Code authentication
gh secret set ANTHROPIC_API_KEY --user --app codespaces

# Optional — image generation and integrations
gh secret set OPENAI_API_KEY --user --app codespaces
```

### Debug creation failures

```bash
# Stream creation logs
gh cs logs -c NAME

# Common issues:
# - Missing secrets: set ANTHROPIC_API_KEY before creating
# - Firewall failures: init-firewall.sh needs NET_ADMIN capability
# - mise install hangs: check network access to mise.jdx.dev
```

### Cost management

Codespaces bill for compute (running) and storage (existing). Minimize both.

```bash
# Stop when not in use
gh cs stop -c NAME

# Set idle timeout on create (default 30min)
gh cs create ... --idle-timeout 15m

# Set retention period (auto-delete after inactivity)
gh cs create ... --retention-period 72h

# Clean up old codespaces
gh cs list --json name,state,lastUsedAt | jq '.[] | select(.state == "Shutdown")'
gh cs delete -c NAME
```

## Tips

- Always use `--json` + `-q` (jq filter) for machine-parseable output
- Capture the codespace name from `create` output — all subsequent commands need it
- `gh cs ssh -c NAME -- claude` to launch Claude Code directly
- Stop codespaces when done — compute billing stops, storage continues
- Delete codespaces you won't reuse — eliminates storage billing too
- Use `--force` with delete to skip confirmation
