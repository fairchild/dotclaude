#!/usr/bin/env bash
# Codespaces dotfiles entry point.
# Also works as a general bootstrap for any new machine.
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
