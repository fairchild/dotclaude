# DevContainer

Development container for Claude Code sessions in GitHub Codespaces.

## Provenance

Based on the official Anthropic reference devcontainer from
[anthropics/claude-code/.devcontainer/](https://github.com/anthropics/claude-code/tree/main/.devcontainer).

Adopted in commit `23f6755` (`feat: adopt Anthropic reference devcontainer with firewall`).

## What's unchanged

**Dockerfile** — byte-for-byte copy of Anthropic's reference. `node:20` base with
zsh/powerlevel10k, git-delta, iptables/ipset, and `@anthropic-ai/claude-code`.

## What we changed

### devcontainer.json

| Aspect | Anthropic reference | Ours | Why |
|--------|-------------------|------|-----|
| name | `Claude Code Sandbox` | `dotclaude` | Project identity |
| VS Code extensions | eslint, prettier, gitlens, claude-code | `[]` | We use terminal-only Claude Code, not the extension |
| features | — | `sshd` | `gh codespace ssh` needs an sshd listener |
| postCreateCommand | — | `./setup.sh` | Bootstrap mise, uv, bun |
| secrets | — | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Codespaces secret injection |
| mounts | 2 volumes (bash history + .claude config) | 1 volume (bash history) | .claude config lives in the repo itself |
| containerEnv | `CLAUDE_CONFIG_DIR` | omitted | Config dir is the workspace |

### init-firewall.sh

Three changes from the Anthropic reference:

1. **Inbound SSH for Codespaces tunnel.** Anthropic only allows outbound SSH + established
   responses. We add `iptables -A INPUT -p tcp --dport 22 -j ACCEPT` so `gh codespace ssh`
   can connect to the container's sshd.

2. **Domain allowlist tailored to our toolchain.** Anthropic whitelists VS Code marketplace
   domains (`marketplace.visualstudio.com`, `vscode.blob.core.windows.net`,
   `update.code.visualstudio.com`). We replace those with:
   - `mise.jdx.dev` — runtime manager
   - `pypi.org`, `files.pythonhosted.org` — Python packages (uv)
   - `astral.sh` — uv installer
   - `bun.sh` — bun runtime
   - `api.openai.com` — image generation and integrations

   Shared domains kept from upstream: `registry.npmjs.org`, `api.anthropic.com`, `sentry.io`,
   `statsig.anthropic.com`, `statsig.com`, plus GitHub IP ranges via `/meta`.

3. **Duplicate IP tolerance.** `ipset add allowed-domains "$ip" 2>/dev/null || true` prevents
   failure when domains (e.g., pypi.org and files.pythonhosted.org) resolve to overlapping IPs.
   Upstream uses a bare `ipset add` that exits on duplicates.

## Updating from upstream

When Anthropic updates their reference devcontainer:

1. Diff against upstream: `diff <(curl -sL https://raw.githubusercontent.com/anthropics/claude-code/main/.devcontainer/Dockerfile) .devcontainer/Dockerfile`
2. Apply Dockerfile changes directly (we have no modifications)
3. For `devcontainer.json` and `init-firewall.sh`, merge carefully — preserve our customizations listed above
