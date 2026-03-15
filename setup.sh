#!/usr/bin/env bash
#MISE description="Bootstrap Claude Code development environment"
# Auto-detected by GitHub Codespaces (dotfiles) and devcontainer postCreateCommand.
# Also available as: mise run setup, conductor setup, bash setup.sh
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Conductor secrets ---
[[ -n "${CONDUCTOR_ROOT_PATH:-}" && -f "$CONDUCTOR_ROOT_PATH/.env" ]] && cp "$CONDUCTOR_ROOT_PATH/.env" "$DOTFILES_DIR/.env"

# --- mise: runtimes and tools ---
if ! command -v mise &>/dev/null; then
  curl -fsSL https://mise.run | sh
fi
export PATH="$HOME/.local/bin:$PATH"
mise trust --all "$DOTFILES_DIR"
mise install -C "$DOTFILES_DIR"
eval "$(mise activate bash)"

# Persist mise activation for interactive shells
SHELL_NAME=$(basename "${SHELL:-bash}")
for rc in ~/.bashrc ~/.zshrc; do
  if [[ -f "$rc" ]] && ! grep -q 'mise activate' "$rc"; then
    echo "eval \"\$(mise activate $SHELL_NAME)\"" >> "$rc"
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
