#!/usr/bin/env bash
# Bootstrap a Claude Code development environment.
# Auto-detected by GitHub Codespaces (dotfiles) and devcontainer postCreateCommand.
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- mise: runtimes and tools ---
if ! command -v mise &>/dev/null; then
  curl -fsSL https://mise.run | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
mise trust --all "$DOTFILES_DIR"
mise install -C "$DOTFILES_DIR"
eval "$(mise activate bash)"

# Persist mise activation for interactive shells
for rc in ~/.bashrc ~/.zshrc; do
  if [[ -f "$rc" ]] && ! grep -q 'mise activate' "$rc"; then
    echo 'eval "$(mise activate bash)"' >> "$rc"
  fi
done

# --- Claude Code ---
if ! command -v claude &>/dev/null; then
  npm install -g @anthropic-ai/claude-code
fi

# --- Link this repo as ~/.claude ---
if [[ "$(readlink ~/.claude 2>/dev/null)" != "$DOTFILES_DIR" ]]; then
  [[ -e ~/.claude ]] && rm -rf ~/.claude
  ln -sfn "$DOTFILES_DIR" ~/.claude
fi

# --- Python deps (core only, optional groups are lazy) ---
uv sync --project "$DOTFILES_DIR" --no-dev 2>/dev/null || true

echo "dotclaude ready at ~/.claude"
echo "Run 'claude' to start. Authenticate with ANTHROPIC_API_KEY or 'claude login'."
